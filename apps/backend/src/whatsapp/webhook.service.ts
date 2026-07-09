import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventBusService } from '../events/event-bus.service';

@Injectable()
export class WebhookService {
  private readonly logger = new Logger(WebhookService.name);

  constructor(
    private prisma: PrismaService,
    private eventBus: EventBusService,
  ) {}

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

        await this.processMessages(account.tenantId, value);
        await this.processStatuses(account.tenantId, value);
      }
    }
  }

  private async processMessages(tenantId: string, value: any) {
    for (const msg of value.messages ?? []) {
      try {
        await this.handleInboundMessage(tenantId, msg, value.contacts?.[0]);
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

  private async handleInboundMessage(tenantId: string, msg: any, contactInfo: any) {
    // Extraer texto del mensaje según su tipo
    const body = this.extractBody(msg);
    const type = this.mapType(msg.type);
    const phone = msg.from;
    const contactName = contactInfo?.profile?.name;

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

    if (!conversation) {
      const assignedUserId = await this.findLeastBusyAgent(tenantId);

      conversation = await this.prisma.conversation.create({
        data: {
          tenantId,
          contactId: contact.id,
          status: 'OPEN',
          assignedUserId,
          lastMessageAt: now,
          lastMessageText: body,
          lastInboundAt: now,
          unreadCount: 1,
        },
      });

      await this.prisma.auditLog.create({
        data: { tenantId, conversationId: conversation.id, action: 'conversation.created' },
      });

      if (assignedUserId) {
        await this.prisma.auditLog.create({
          data: {
            tenantId,
            conversationId: conversation.id,
            action: 'conversation.auto_assigned',
            metadata: { assignedUserId },
          },
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
        mediaUrl: this.extractMediaId(msg),
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
  }

  /**
   * Asigna al agente activo con menor cantidad de conversaciones abiertas/pendientes
   * en el tenant. Empate se resuelve por orden de creación del usuario (más antiguo primero).
   */
  private async findLeastBusyAgent(tenantId: string): Promise<string | null> {
    const agents = await this.prisma.user.findMany({
      where: { tenantId, role: 'AGENT', isActive: true },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (agents.length === 0) return null;

    const workload = await this.prisma.conversation.groupBy({
      by: ['assignedUserId'],
      where: {
        tenantId,
        assignedUserId: { in: agents.map((a) => a.id) },
        status: { in: ['OPEN', 'PENDING'] },
      },
      _count: { _all: true },
    });

    const loadByAgent = new Map(agents.map((a) => [a.id, 0]));
    for (const row of workload) {
      if (row.assignedUserId) loadByAgent.set(row.assignedUserId, row._count._all);
    }

    let bestAgentId = agents[0].id;
    let bestLoad = loadByAgent.get(bestAgentId) ?? 0;
    for (const agent of agents) {
      const load = loadByAgent.get(agent.id) ?? 0;
      if (load < bestLoad) {
        bestLoad = load;
        bestAgentId = agent.id;
      }
    }
    return bestAgentId;
  }

  private extractBody(msg: any): string {
    switch (msg.type) {
      case 'text':      return msg.text?.body || '';
      case 'image':     return msg.image?.caption || '[imagen]';
      case 'audio':     return '[audio]';
      case 'document':  return msg.document?.filename || '[documento]';
      case 'video':     return msg.video?.caption || '[video]';
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
      interactive: 'TEXT',
    };
    return map[type] || 'TEXT';
  }
}
