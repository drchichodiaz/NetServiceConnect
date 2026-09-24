import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ContactIdentityService, displayId } from '../contacts/contact-identity.service';
import { EventBusService } from '../events/event-bus.service';
import { MediaService } from '../media/media.service';
import { BotService } from '../bot/bot.service';
import { BotsService } from '../bots/bots.service';
import { AssignmentService } from './assignment.service';

/**
 * Palabras con las que alguien pide dejar de recibir envios masivos.
 *
 * Se exige que el mensaje sea corto (mismo criterio que usa el bot para "agente" y
 * "menu"): asi "baja" como respuesta cuenta, pero "me dieron de baja en el seguro" no.
 * Frente a la duda conviene equivocarse dando de baja de mas: una baja no impide
 * responderle a la persona, solo corta los envios proactivos, y un envio no deseado
 * con datos de salud de por medio es un problema bastante mayor (Ley 81).
 */
const OPT_OUT_RE = /\b(baja|stop|cancelar|desuscribir|desuscribirme|unsubscribe|remover)\b/i;
const OPT_OUT_MAX_WORDS = 4;

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);
  private readonly apiVersion: string;

  constructor(
    private prisma: PrismaService,
    private identities: ContactIdentityService,
    private eventBus: EventBusService,
    private mediaService: MediaService,
    private botService: BotService,
    private bots: BotsService,
    private assignmentService: AssignmentService,
    config: ConfigService,
  ) {
    this.apiVersion = config.get('META_API_VERSION') || 'v19.0';
  }

  async processWebhookPayload(payload: any) {
    if (payload?.object !== 'whatsapp_business_account') return;

    for (const entry of payload.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== 'messages') continue;

        const value = change.value;
        // phoneNumberId es más específico que wabaId para el lookup del tenant
        const phoneNumberId = value.metadata?.phone_number_id;

        const account = await this.prisma.channelAccount.findFirst({
          where: { phoneNumberId, isActive: true },
        });

        if (!account) {
          this.logger.warn(`No hay cuenta activa para phoneNumberId ${phoneNumberId}`);
          continue;
        }

        await this.processMessages(account.tenantId, account.id, account.accessToken, value);
        await this.processStatuses(account.tenantId, value);
      }
    }
  }

  private async processMessages(tenantId: string, accountId: string, accessToken: string, value: any) {
    for (const msg of value.messages ?? []) {
      try {
        await this.handleInboundMessage(tenantId, accountId, accessToken, msg, value.contacts?.[0]);
      } catch (err) {
        this.logger.error(`Error procesando mensaje ${msg.id}`, err);
      }
    }
  }

  private async processStatuses(tenantId: string, value: any) {
    const statusMap: Record<string, string> = {
      sent: 'SENT',
      delivered: 'DELIVERED',
      read: 'READ',
      failed: 'FAILED',
    };

    for (const status of value.statuses ?? []) {
      const mapped = statusMap[status.status];
      if (!mapped) continue;

      // Meta acepta el mensaje (devuelve un wamid) y recien despues avisa por webhook
      // que no lo entrego. El motivo viene aca y antes se descartaba, asi que un envio
      // fallido era indistinguible de uno que nunca salio.
      const failureReason = mapped === 'FAILED' ? this.extractFailureReason(status) : null;
      if (failureReason) {
        this.logger.error(`Entrega fallida (${status.id}) para ${status.recipient_id}: ${failureReason}`);
      }

      await this.prisma.message.updateMany({
        where: { externalId: status.id, tenantId },
        data: { status: mapped as any, ...(failureReason && { failureReason }) },
      });

      this.eventBus.publish({
        type: 'message_status',
        tenantId,
        payload: { externalId: status.id, status: mapped, failureReason },
      });
    }
  }

  /** "131049: Title — detalle". Meta manda el motivo en statuses[].errors[0]. */
  private extractFailureReason(status: any): string | null {
    const error = status?.errors?.[0];
    if (!error) return null;
    const details = error.error_data?.details || error.message || error.title;
    return [error.code, details].filter(Boolean).join(': ') || null;
  }

  private async handleInboundMessage(tenantId: string, accountId: string, accessToken: string, msg: any, contactInfo: any) {
    // Extraer texto del mensaje según su tipo
    const body = this.extractBody(msg);
    const type = this.mapType(msg.type);
    const phone = msg.from;
    const contactName = contactInfo?.profile?.name;

    // Descargar y guardar el media (si lo hay) separado por tenant, antes de crear el mensaje.
    // Si falla la descarga no bloqueamos el procesamiento del mensaje: queda sin media
    // adjunto pero el texto/etiqueta del mensaje se guarda igual.
    const mediaId = this.extractMediaId(msg);
    let mediaUrl: string | undefined;
    let mediaMimeType: string | undefined;
    if (mediaId) {
      try {
        const downloaded = await this.mediaService.downloadInboundMedia(tenantId, mediaId, accessToken, this.apiVersion);
        mediaUrl = downloaded.relativePath;
        mediaMimeType = downloaded.mimeType;
      } catch (err) {
        this.logger.error(`Error descargando media ${mediaId}`, err?.response?.data || err?.message || err);
      }
    }

    // Quien escribio. En WhatsApp la identidad es el telefono, pero el que resuelve
    // eso es ContactIdentityService: aca no se asume mas que un contacto se busca por
    // numero, porque en Messenger e Instagram no hay numero que buscar.
    const contact = await this.identities.resolve(tenantId, 'WHATSAPP', phone, { name: contactName });

    // Buscar conversación abierta o pendiente existente EN ESTA LÍNEA. El contacto
    // es uno solo por tenant a propósito (el agente ve la ficha completa del cliente),
    // pero la conversación se separa por línea: si el mismo cliente le escribe a dos
    // sucursales, son dos hilos distintos y cada respuesta sale por su propio número.
    let conversation = await this.prisma.conversation.findFirst({
      where: { tenantId, contactId: contact.id, channelAccountId: accountId, status: { not: 'CLOSED' } },
      orderBy: { createdAt: 'desc' },
    });

    const now = new Date();
    const isNewConversation = !conversation;

    if (!conversation) {
      // Cada linea elige su bot. Con bot, la conversacion arranca en modo BOT y sin
      // asignar — la asignacion por carga se dispara recien cuando el bot deriva a un
      // humano. Sin bot, entra directo a los agentes y se reparte en el momento, con la
      // misma regla de permisos por linea que usa el bot al derivar.
      const bot = await this.bots.resolveForAccount(tenantId, accountId);
      const assignedUserId = bot ? null : await this.assignmentService.findLeastBusyAgent(tenantId, accountId);

      conversation = await this.prisma.conversation.create({
        data: {
          tenantId,
          contactId: contact.id,
          channelAccountId: accountId,
          status: 'OPEN',
          ...(bot
            ? { mode: 'BOT', botState: 'MENU', botId: bot.id }
            : { mode: 'AGENT', assignedUserId, ...(assignedUserId && { assignedAt: now }) }),
          lastMessageAt: now,
          lastMessageText: body,
          lastInboundAt: now,
          unreadCount: 1,
        },
      });

      await this.prisma.auditLog.create({
        data: { tenantId, conversationId: conversation.id, action: 'conversation.created' },
      });
      if (bot) {
        await this.prisma.auditLog.create({
          data: { tenantId, conversationId: conversation.id, action: 'bot.started' },
        });
      } else if (assignedUserId) {
        await this.prisma.auditLog.create({
          data: { tenantId, conversationId: conversation.id, action: 'conversation.auto_assigned', metadata: { assignedUserId } },
        });
      }
    } else {
      await this.prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          lastMessageAt: now,
          lastMessageText: body,
          lastInboundAt: now,
          status: 'OPEN',
          unreadCount: { increment: 1 },
        },
      });
    }

    // Evitar duplicados por externalId
    const existing = await this.prisma.message.findFirst({
      where: { externalId: msg.id, tenantId },
    });
    if (existing) return;

    const message = await this.prisma.message.create({
      data: {
        tenantId,
        conversationId: conversation.id,
        direction: 'INBOUND',
        type: type as any,
        body,
        mediaUrl,
        mediaMimeType,
        mediaType: msg.type !== 'text' ? msg.type : undefined,
        status: 'DELIVERED',
        externalId: msg.id,
        rawPayload: msg,
      },
    });

    // Emitir evento SSE a todos los clientes conectados del tenant
    this.eventBus.publish({
      type: 'new_message',
      tenantId,
      payload: {
        message,
        conversationId: conversation.id,
        contact: {
          id: contact.id,
          name: contact.name,
          phone: contact.phone,
          channel: 'WHATSAPP' as const,
          // El evento en vivo tiene que traer el mismo nombre que devuelve la API al
          // recargar; si no, la conversacion cambia de titulo sola al refrescar.
          displayId: displayId('WHATSAPP', contact, null),
        },
        lastMessageText: body,
        lastMessageAt: now.toISOString(),
      },
    });

    // La baja se procesa antes que el bot: si la persona pide dejar de recibir envios,
    // eso vale aunque despues el bot le conteste otra cosa.
    await this.applyOptOutIfRequested(tenantId, contact.id, body, type);

    // Fase D: el bot responde recién después de que el mensaje del cliente ya quedó
    // guardado y visible en el historial (así el humano que eventualmente tome la
    // conversación ve todo el intercambio, incluido lo que pasó con el bot).
    if (isNewConversation && conversation.mode === 'BOT') {
      await this.botService.sendMenu(tenantId, conversation.id, phone);
    } else if (!isNewConversation && conversation.mode === 'BOT') {
      await this.botService.handleBotReply(tenantId, conversation.id, conversation.botState, phone, msg);
    }
  }

  /**
   * Marca el contacto como dado de baja si el mensaje lo pide. Es idempotente: si ya
   * estaba dado de baja no se toca la fecha original, que es la que interesa.
   */
  private async applyOptOutIfRequested(tenantId: string, contactId: string, body: string, type: string) {
    if (type !== 'TEXT' || !body) return;
    const words = body.trim().split(/\s+/);
    if (words.length > OPT_OUT_MAX_WORDS || !OPT_OUT_RE.test(body)) return;

    const { count } = await this.prisma.contact.updateMany({
      where: { id: contactId, tenantId, optedOutAt: null },
      data: { optedOutAt: new Date(), optedOutReason: body.slice(0, 200) },
    });
    if (count > 0) {
      this.logger.log(`[baja] contacto ${contactId} pidio no recibir mas envios: "${body.slice(0, 60)}"`);
    }
  }

  private extractBody(msg: any): string {
    switch (msg.type) {
      case 'text':      return msg.text?.body || '';
      case 'image':     return msg.image?.caption || '[imagen]';
      case 'audio':     return '[audio]';
      case 'document':  return msg.document?.filename || '[documento]';
      case 'video':     return msg.video?.caption || '[video]';
      case 'sticker':   return '[sticker]';
      // Antes caia en el default y la bandeja mostraba "[mensaje]": el agente no sabia
      // que el cliente le habia mandado donde estaba. El nombre y la direccion solo
      // vienen si compartio un lugar; si compartio su posicion, no hay texto.
      case 'location': {
        const label = [msg.location?.name, msg.location?.address].filter(Boolean).join(' — ');
        return label ? `📍 ${label}` : '📍 Ubicación';
      }
      // Cuando el cliente toca una respuesta rapida de una PLANTILLA, Meta manda
      // type 'button' (no 'interactive', que es el de los botones del bot). Sin este
      // caso caia en el default y la bandeja mostraba "[mensaje]": el agente sabia
      // que el cliente habia respondido, pero no que opcion habia elegido.
      case 'button':
        return msg.button?.text || '[respuesta]';
      case 'interactive': {
        const reply = msg.interactive?.button_reply ?? msg.interactive?.list_reply;
        return reply?.title || '[interactivo]';
      }
      default:          return '[mensaje]';
    }
  }

  private extractMediaId(msg: any): string | undefined {
    return (
      msg.image?.id ||
      msg.audio?.id ||
      msg.document?.id ||
      msg.video?.id ||
      msg.sticker?.id ||
      undefined
    );
  }

  private mapType(type: string): string {
    const map: Record<string, string> = {
      text:        'TEXT',
      image:       'IMAGE',
      audio:       'AUDIO',
      document:    'DOCUMENT',
      video:       'VIDEO',
      sticker:     'STICKER',
      location:    'LOCATION',
      interactive: 'TEXT',
      button:      'TEXT',
    };
    return map[type] || 'TEXT';
  }
}
