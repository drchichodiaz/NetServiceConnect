import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { CallStatus, ChannelAccount } from '@prisma/client';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { EventBusService } from '../events/event-bus.service';
import { ContactIdentityService, displayId } from '../contacts/contact-identity.service';
import { ChannelAccessService } from '../common/services/channel-access.service';
import { AssignmentService } from '../whatsapp/assignment.service';

/**
 * La Calling API salio con la v23. La version configurada para mensajes puede ser mas
 * vieja (en produccion es v21), y no se toca para no mover lo que ya anda.
 */
const CALLING_API_VERSION = 'v23.0';

const FINAL: CallStatus[] = ['COMPLETED', 'MISSED', 'REJECTED', 'FAILED'];

/**
 * Llamadas de voz de WhatsApp.
 *
 * Meta avisa por webhook que alguien llama y manda una oferta SDP. El panel de cada
 * agente que puede ver esa linea suena; el primero que atiende arma la respuesta SDP en
 * su navegador y la manda aca, y este servicio se la pasa a Meta. Desde ahi el audio va
 * directo entre el navegador y Meta: el servidor no toca la media, solo el registro.
 *
 * La llamada queda en la conversacion de esa linea (se abre una si no habia), porque
 * una llamada reabre la ventana de 24 horas y lo natural despues de una perdida es
 * escribirle.
 */
@Injectable()
export class CallsService {
  private readonly logger = new Logger(CallsService.name);

  constructor(
    private prisma: PrismaService,
    private eventBus: EventBusService,
    private identities: ContactIdentityService,
    private channelAccess: ChannelAccessService,
    private assignment: AssignmentService,
  ) {}

  // ─── Webhook ────────────────────────────────────────────────────────────────

  /** `value` de un change con field "calls". */
  async handleWebhook(account: ChannelAccount, value: any) {
    for (const call of value.calls ?? []) {
      try {
        if (call.event === 'connect' && call.direction === 'USER_INITIATED') {
          await this.onIncoming(account, call, value.contacts?.[0]);
        } else if (call.event === 'terminate') {
          await this.onTerminate(account.tenantId, call);
        }
      } catch (err) {
        this.logger.error(`Error procesando la llamada ${call.id} (${call.event})`, err);
      }
    }
  }

  private async onIncoming(account: ChannelAccount, call: any, contactInfo: any) {
    const tenantId = account.tenantId;
    // Meta reintenta los webhooks: la segunda vez la llamada ya esta.
    const existing = await this.prisma.call.findUnique({ where: { tenantId_externalId: { tenantId, externalId: call.id } } });
    if (existing) return;

    const sdpOffer: string | undefined = call.session?.sdp;
    const phone: string | undefined = call.from || contactInfo?.wa_id;
    if (!sdpOffer || !phone) {
      this.logger.warn(`Llamada ${call.id} sin ${sdpOffer ? 'numero' : 'oferta SDP'}: no se puede atender`);
      return;
    }

    const contact = await this.identities.resolve(tenantId, 'WHATSAPP', phone, { name: contactInfo?.profile?.name });
    const now = new Date();

    // Una llamada no la puede atender el bot, asi que una conversacion nueva arranca con
    // agentes. Si ya habia una (aunque sea con el bot) se usa esa: al atender pasa a
    // quien atendio.
    let conversation = await this.prisma.conversation.findFirst({
      where: { tenantId, contactId: contact.id, channelAccountId: account.id, status: { not: 'CLOSED' } },
      orderBy: { createdAt: 'desc' },
    });
    if (conversation) {
      // La llamada reabre la ventana de 24 horas aunque nadie atienda.
      await this.prisma.conversation.update({ where: { id: conversation.id }, data: { lastInboundAt: now } });
    } else {
      const assignedUserId = await this.assignment.findLeastBusyAgent(tenantId, account.id);
      conversation = await this.prisma.conversation.create({
        data: {
          tenantId,
          contactId: contact.id,
          channelAccountId: account.id,
          status: 'OPEN',
          mode: 'AGENT',
          assignedUserId,
          ...(assignedUserId && { assignedAt: now }),
          lastMessageAt: now,
          lastMessageText: '📞 Llamada entrante',
          lastInboundAt: now,
        },
      });
    }

    const created = await this.prisma.call.create({
      data: { tenantId, channelAccountId: account.id, conversationId: conversation.id, externalId: call.id, sdpOffer },
    });

    this.eventBus.publish({ type: 'conversation_updated', tenantId, payload: { conversationId: conversation.id } });
    this.eventBus.publish({
      type: 'call_ringing',
      tenantId,
      payload: {
        id: created.id,
        channelAccountId: account.id,
        lineName: account.label?.trim() || account.phoneNumber || account.displayName || 'WhatsApp',
        conversationId: conversation.id,
        contactName: displayId('WHATSAPP', contact, null),
        contactPhone: contact.phone,
        sdpOffer,
        createdAt: created.createdAt.toISOString(),
      },
    });
  }

  private async onTerminate(tenantId: string, call: any) {
    const row = await this.prisma.call.findUnique({ where: { tenantId_externalId: { tenantId, externalId: call.id } } });
    if (!row) return;

    const duration = Number(call.duration);
    const durationSec = Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null;

    if (FINAL.includes(row.status)) {
      // Ya la habia cerrado el agente al colgar; Meta trae la duracion exacta.
      if (durationSec !== null) await this.prisma.call.update({ where: { id: row.id }, data: { durationSec } });
      return;
    }

    const error = call.errors?.[0];
    const failureReason = error ? [error.code, error.error_data?.details || error.message].filter(Boolean).join(': ') : null;
    let status: CallStatus;
    if (row.status === 'RINGING') status = 'MISSED';
    else status = call.status === 'FAILED' ? 'FAILED' : 'COMPLETED';

    await this.finish(row.id, status, { durationSec, failureReason });
  }

  // ─── Acciones del agente ────────────────────────────────────────────────────

  /**
   * Atiende con la respuesta SDP que armo el navegador. El primero que llega se la
   * queda: el UPDATE condicional es el que decide, no una lectura previa.
   */
  async accept(tenantId: string, user: { id: string; name?: string }, callId: string, sdp: string) {
    if (!sdp?.trim()) throw new BadRequestException('Falta la respuesta SDP');
    const call = await this.findForUser(tenantId, user.id, callId);
    const account = await this.accountFor(call.channelAccountId, tenantId);
    const now = new Date();

    const { count } = await this.prisma.call.updateMany({
      where: { id: call.id, tenantId, status: 'RINGING' },
      data: { status: 'ANSWERED', answeredById: user.id, answeredAt: now },
    });
    if (count === 0) throw new ConflictException('Esa llamada ya la atendió otra persona o se cortó');

    try {
      // pre_accept arma la conexion de audio antes de dar la llamada por atendida; asi
      // el cliente no pierde las primeras palabras. accept tiene que llevar el mismo SDP.
      await this.metaAction(account, call.externalId, 'pre_accept', sdp);
      await this.metaAction(account, call.externalId, 'accept', sdp);
    } catch (err: any) {
      const reason = this.metaError(err);
      this.logger.error(`No se pudo atender la llamada ${call.id}: ${reason}`);
      await this.finish(call.id, 'FAILED', { failureReason: reason });
      throw new BadRequestException(`WhatsApp no aceptó la llamada: ${reason}`);
    }

    // Quien atiende se queda con la conversacion: si estaba con el bot o sin asignar, es
    // a esa persona a quien el cliente le va a escribir despues.
    if (call.conversationId) {
      const conv = await this.prisma.conversation.findUnique({ where: { id: call.conversationId } });
      if (conv && (conv.mode === 'BOT' || !conv.assignedUserId)) {
        await this.prisma.conversation.update({
          where: { id: conv.id },
          data: { mode: 'AGENT', botState: null, assignedUserId: user.id, assignedAt: now },
        });
        this.eventBus.publish({ type: 'conversation_updated', tenantId, payload: { conversationId: conv.id } });
      }
    }

    this.publishUpdate(tenantId, call.id, 'ANSWERED', user.id);
    return { ok: true };
  }

  async reject(tenantId: string, userId: string, callId: string) {
    const call = await this.findForUser(tenantId, userId, callId);
    if (call.status !== 'RINGING') return { ok: true };
    const account = await this.accountFor(call.channelAccountId, tenantId);
    try {
      await this.metaAction(account, call.externalId, 'reject');
    } catch (err) {
      // Si Meta ya la habia cortado no hay nada que rechazar; se registra igual.
      this.logger.warn(`Rechazo de la llamada ${call.id}: ${this.metaError(err)}`);
    }
    await this.finish(call.id, 'REJECTED', { byUserId: userId });
    return { ok: true };
  }

  async hangup(tenantId: string, userId: string, callId: string) {
    const call = await this.findForUser(tenantId, userId, callId);
    if (FINAL.includes(call.status)) return { ok: true };
    const account = await this.accountFor(call.channelAccountId, tenantId);
    try {
      await this.metaAction(account, call.externalId, 'terminate');
    } catch (err) {
      this.logger.warn(`Corte de la llamada ${call.id}: ${this.metaError(err)}`);
    }
    // Meta igual manda el terminate, pero si se pierde la llamada no puede quedar
    // "en curso" para siempre.
    const durationSec = call.answeredAt ? Math.round((Date.now() - call.answeredAt.getTime()) / 1000) : null;
    await this.finish(call.id, call.status === 'ANSWERED' ? 'COMPLETED' : 'MISSED', { durationSec });
    return { ok: true };
  }

  // ─── Activar llamadas en una linea ──────────────────────────────────────────

  /**
   * Prende o apaga las llamadas del numero en Meta. Prenderlas es lo que hace aparecer
   * el boton de llamar en el chat de todos los clientes de esa linea.
   */
  async setCallingEnabled(tenantId: string, accountId: string, enabled: boolean) {
    const account = await this.prisma.channelAccount.findFirst({ where: { id: accountId, tenantId, channel: 'WHATSAPP' } });
    if (!account?.phoneNumberId) throw new NotFoundException('Línea de WhatsApp no encontrada');
    try {
      await axios.post(
        `https://graph.facebook.com/${CALLING_API_VERSION}/${account.phoneNumberId}/settings`,
        { calling: { status: enabled ? 'ENABLED' : 'DISABLED' } },
        { headers: { Authorization: `Bearer ${account.accessToken}`, 'Content-Type': 'application/json' } },
      );
    } catch (err) {
      throw new BadRequestException(`WhatsApp no aceptó el cambio: ${this.metaError(err)}`);
    }
    await this.prisma.channelAccount.update({ where: { id: account.id }, data: { callingEnabled: enabled } });
    return { callingEnabled: enabled };
  }

  /** Lo que dice Meta de las llamadas de esa linea, para el admin. */
  async callingSettings(tenantId: string, accountId: string) {
    const account = await this.prisma.channelAccount.findFirst({ where: { id: accountId, tenantId, channel: 'WHATSAPP' } });
    if (!account?.phoneNumberId) throw new NotFoundException('Línea de WhatsApp no encontrada');
    try {
      const { data } = await axios.get(`https://graph.facebook.com/${CALLING_API_VERSION}/${account.phoneNumberId}/settings`, {
        headers: { Authorization: `Bearer ${account.accessToken}` },
      });
      return data?.calling ?? {};
    } catch (err) {
      throw new BadRequestException(`No se pudo consultar a WhatsApp: ${this.metaError(err)}`);
    }
  }

  // ─── Internos ───────────────────────────────────────────────────────────────

  private async findForUser(tenantId: string, userId: string, callId: string) {
    const call = await this.prisma.call.findFirst({ where: { id: callId, tenantId } });
    if (!call) throw new NotFoundException('Llamada no encontrada');
    if (!(await this.channelAccess.canAccessAccount(userId, call.channelAccountId))) {
      throw new ForbiddenException('No tenés acceso a esa línea');
    }
    return call;
  }

  private async accountFor(channelAccountId: string | null, tenantId: string) {
    const account = channelAccountId
      ? await this.prisma.channelAccount.findFirst({ where: { id: channelAccountId, tenantId } })
      : null;
    if (!account?.phoneNumberId) throw new BadRequestException('La línea de esa llamada ya no está conectada');
    return account;
  }

  private async metaAction(account: ChannelAccount, callId: string, action: string, sdp?: string) {
    await axios.post(
      `https://graph.facebook.com/${CALLING_API_VERSION}/${account.phoneNumberId}/calls`,
      {
        messaging_product: 'whatsapp',
        call_id: callId,
        action,
        ...(sdp && { session: { sdp_type: 'answer', sdp } }),
      },
      { headers: { Authorization: `Bearer ${account.accessToken}`, 'Content-Type': 'application/json' } },
    );
  }

  private metaError(err: any): string {
    const e = err?.response?.data?.error;
    if (!e) return err?.message || 'error desconocido';
    return [e.code, e.error_data?.details || e.message].filter(Boolean).join(': ');
  }

  /**
   * Cierra la llamada y la deja escrita en la conversacion y en la bitacora. Solo actua
   * si todavia no estaba cerrada, asi el colgar del agente y el aviso de Meta no la
   * registran dos veces.
   */
  private async finish(
    callId: string,
    status: CallStatus,
    extra: { durationSec?: number | null; failureReason?: string | null; byUserId?: string } = {},
  ) {
    const now = new Date();
    const { count } = await this.prisma.call.updateMany({
      where: { id: callId, status: { notIn: FINAL } },
      data: {
        status,
        endedAt: now,
        ...(extra.durationSec != null && { durationSec: extra.durationSec }),
        ...(extra.failureReason && { failureReason: extra.failureReason }),
      },
    });
    if (count === 0) return;

    const call = await this.prisma.call.findUniqueOrThrow({
      where: { id: callId },
      include: { answeredBy: { select: { name: true } }, conversation: { include: { contact: true } } },
    });
    const byUserId = extra.byUserId ?? call.answeredById ?? null;
    const byName = byUserId
      ? call.answeredBy?.name ?? (await this.prisma.user.findUnique({ where: { id: byUserId }, select: { name: true } }))?.name
      : null;

    const text = this.describe(status, byName, call.durationSec);
    if (call.conversation) {
      const conv = call.conversation;
      const missed = status === 'MISSED';
      const message = await this.prisma.message.create({
        data: {
          tenantId: call.tenantId,
          conversationId: conv.id,
          direction: 'INBOUND',
          type: 'TEXT',
          body: text,
          mediaType: 'call',
          status: 'DELIVERED',
          rawPayload: { call: { id: call.id, status, durationSec: call.durationSec } },
        },
      });
      await this.prisma.conversation.update({
        where: { id: conv.id },
        data: { lastMessageAt: now, lastMessageText: text, ...(missed && { unreadCount: { increment: 1 } }) },
      });
      this.eventBus.publish({
        type: 'new_message',
        tenantId: call.tenantId,
        payload: {
          message,
          conversationId: conv.id,
          contact: {
            id: conv.contact.id,
            name: conv.contact.name,
            phone: conv.contact.phone,
            channel: 'WHATSAPP' as const,
            displayId: displayId('WHATSAPP', conv.contact, null),
          },
          lastMessageText: text,
          lastMessageAt: now.toISOString(),
        },
      });
    }

    await this.prisma.auditLog.create({
      data: {
        tenantId: call.tenantId,
        conversationId: call.conversationId,
        userId: status === 'MISSED' || status === 'FAILED' ? null : byUserId,
        action: `call.${status.toLowerCase()}`,
        metadata: { callId: call.id, durationSec: call.durationSec },
      },
    });

    this.publishUpdate(call.tenantId, call.id, status, byUserId);
  }

  private describe(status: CallStatus, byName: string | null | undefined, durationSec: number | null): string {
    switch (status) {
      case 'MISSED':
        return '📞 Llamada perdida';
      case 'REJECTED':
        return `📞 Llamada rechazada${byName ? ` por ${byName}` : ''}`;
      case 'FAILED':
        return '📞 La llamada no se pudo conectar';
      default:
        return `📞 Llamada atendida${byName ? ` por ${byName}` : ''}${durationSec ? ` · ${formatDuration(durationSec)}` : ''}`;
    }
  }

  private publishUpdate(tenantId: string, callId: string, status: CallStatus, userId: string | null) {
    this.eventBus.publish({ type: 'call_updated', tenantId, payload: { id: callId, status, userId } });
  }
}

/** 3:07, 1:02:05 */
export function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
