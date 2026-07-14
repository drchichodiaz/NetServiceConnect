import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EventBusService } from '../events/event-bus.service';
import { MediaService } from '../media/media.service';
import { BotService } from '../bot/bot.service';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);
  private readonly apiVersion: string;

  constructor(
    private prisma: PrismaService,
    private eventBus: EventBusService,
    private mediaService: MediaService,
    private botService: BotService,
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

        const account = await this.prisma.whatsAppAccount.findFirst({
          where: { phoneNumberId, isActive: true },
        });

        if (!account) {
          this.logger.warn(`No hay cuenta activa para phoneNumberId ${phoneNumberId}`);
          continue;
        }

        await this.processMessages(account.tenantId, account.accessToken, value);
        await this.processStatuses(account.tenantId, value);
      }
    }
  }

  private async processMessages(tenantId: string, accessToken: string, value: any) {
    for (const msg of value.messages ?? []) {
      try {
        await this.handleInboundMessage(tenantId, accessToken, msg, value.contacts?.[0]);
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

      await this.prisma.message.updateMany({
        where: { externalId: status.id, tenantId },
        data: { status: mapped as any },
      });

      this.eventBus.publish({
        type: 'message_status',
        tenantId,
        payload: { externalId: status.id, status: mapped },
      });
    }
  }

  private async handleInboundMessage(tenantId: string, accessToken: string, msg: any, contactInfo: any) {
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

    // Upsert de contacto
    const contact = await this.prisma.contact.upsert({
      where: { tenantId_phone: { tenantId, phone } },
      update: contactName ? { name: contactName } : {},
      create: { tenantId, phone, name: contactName },
    });

    // Buscar conversación abierta o pendiente existente
    let conversation = await this.prisma.conversation.findFirst({
      where: { tenantId, contactId: contact.id, status: { not: 'CLOSED' } },
      orderBy: { createdAt: 'desc' },
    });

    const now = new Date();
    const isNewConversation = !conversation;

    if (!conversation) {
      // Fase D: las conversaciones nuevas arrancan en modo BOT (menú interactivo) y
      // sin asignar — la asignación por carga se dispara recién cuando el bot deriva
      // a un humano (opción "Contactar a un agente" o fallback de "Consultar orden").
      conversation = await this.prisma.conversation.create({
        data: {
          tenantId,
          contactId: contact.id,
          status: 'OPEN',
          mode: 'BOT',
          botState: 'MENU',
          lastMessageAt: now,
          lastMessageText: body,
          lastInboundAt: now,
          unreadCount: 1,
        },
      });

      await this.prisma.auditLog.create({
        data: { tenantId, conversationId: conversation.id, action: 'conversation.created' },
      });
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
        contact: { id: contact.id, name: contact.name, phone: contact.phone },
        lastMessageText: body,
        lastMessageAt: now.toISOString(),
      },
    });

    // Fase D: el bot responde recién después de que el mensaje del cliente ya quedó
    // guardado y visible en el historial (así el humano que eventualmente tome la
    // conversación ve todo el intercambio, incluido lo que pasó con el bot).
    if (isNewConversation) {
      await this.botService.sendMenu(tenantId, conversation.id, phone);
    } else if (conversation.mode === 'BOT') {
      await this.botService.handleBotReply(tenantId, conversation.id, conversation.botState, phone, msg);
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
      interactive: 'TEXT',
    };
    return map[type] || 'TEXT';
  }
}
