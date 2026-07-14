import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { EventBusService } from '../events/event-bus.service';
import { AssignmentService } from '../whatsapp/assignment.service';

interface WhatsAppAccountCreds {
  phoneNumberId: string;
  accessToken: string;
}

const MENU_OPTIONS: { id: string; title: string }[] = [
  { id: 'horarios', title: 'Horarios' },
  { id: 'sucursales', title: 'Sucursales' },
  { id: 'servicios', title: 'Servicios' },
  { id: 'consultar_orden', title: 'Consultar mi orden' },
  { id: 'agente', title: 'Hablar con un agente' },
];

const DEFAULT_CONFIG_TEXT = 'Todavía no cargamos esta información. Ya te paso con un agente para ayudarte.';

@Injectable()
export class BotService {
  private readonly logger = new Logger(BotService.name);
  private readonly apiVersion: string;

  constructor(
    private prisma: PrismaService,
    private eventBus: EventBusService,
    private assignmentService: AssignmentService,
    config: ConfigService,
  ) {
    this.apiVersion = config.get('META_API_VERSION') || 'v19.0';
  }

  /** Envía el menú principal como WhatsApp interactive list message. */
  async sendMenu(tenantId: string, conversationId: string, phone: string) {
    const account = await this.getAccount(tenantId);
    if (!account) return;

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: '¡Hola! ¿En qué te podemos ayudar?' },
        action: {
          button: 'Ver opciones',
          sections: [{ title: 'Menú', rows: MENU_OPTIONS.map((o) => ({ id: o.id, title: o.title })) }],
        },
      },
    };

    const summary = `[Menú] ${MENU_OPTIONS.map((o) => o.title).join(' · ')}`;
    await this.sendAndLog(tenantId, conversationId, account, payload, summary);
  }

  /** Rutea la respuesta de un cliente cuando la conversación sigue en modo BOT. */
  async handleBotReply(tenantId: string, conversationId: string, botState: string | null, phone: string, msg: any) {
    const account = await this.getAccount(tenantId);
    if (!account) return;

    if (botState === 'AWAITING_ORDER_NUMBER') {
      return this.handleOrderNumberReply(tenantId, conversationId, phone, msg, account);
    }

    const optionId = this.extractReplyId(msg);
    switch (optionId) {
      case 'horarios':
      case 'sucursales':
      case 'servicios':
        return this.replyWithConfigText(tenantId, conversationId, phone, optionId, account);
      case 'consultar_orden':
        return this.askOrderNumber(tenantId, conversationId, phone, account);
      case 'agente':
        await this.sendText(tenantId, conversationId, phone, account, 'Perfecto, ya te conecto con un agente.');
        return this.handoffToHuman(tenantId, conversationId, 'menu_selection');
      default:
        return this.resendMenuWithHint(tenantId, conversationId, phone, account);
    }
  }

  private async replyWithConfigText(
    tenantId: string,
    conversationId: string,
    phone: string,
    optionId: 'horarios' | 'sucursales' | 'servicios',
    account: WhatsAppAccountCreds,
  ) {
    const config = await this.prisma.tenantBotConfig.findUnique({ where: { tenantId } });
    const fieldMap = {
      horarios: config?.horariosText,
      sucursales: config?.sucursalesText,
      servicios: config?.serviciosText,
    };
    const text = fieldMap[optionId]?.trim() || DEFAULT_CONFIG_TEXT;
    await this.sendText(tenantId, conversationId, phone, account, text);
  }

  private async askOrderNumber(tenantId: string, conversationId: string, phone: string, account: WhatsAppAccountCreds) {
    await this.sendText(tenantId, conversationId, phone, account, 'Decime el número de tu orden y en un momento te ayudamos.');
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { botState: 'AWAITING_ORDER_NUMBER' } });
  }

  private async handleOrderNumberReply(
    tenantId: string,
    conversationId: string,
    phone: string,
    msg: any,
    account: WhatsAppAccountCreds,
  ) {
    const orderNumber = msg.text?.body?.trim() || '(no informado)';

    await this.prisma.auditLog.create({
      data: {
        tenantId,
        conversationId,
        action: 'conversation.order_lookup_requested',
        metadata: { orderNumber },
      },
    });

    // Todavía no hay ninguna API de pedidos conectada para ningún tenant — siempre
    // cae al fallback humano. Cuando exista TenantBotConfig.orderStatusApiUrl para
    // el tenant, acá es donde se debería intentar la consulta real antes de derivar.
    await this.sendText(
      tenantId,
      conversationId,
      phone,
      account,
      'Por ahora no puedo consultar tu orden automáticamente. Ya te paso con un agente que te va a ayudar con el número que me pasaste.',
    );
    await this.handoffToHuman(tenantId, conversationId, 'order_lookup_fallback');
  }

  private async resendMenuWithHint(tenantId: string, conversationId: string, phone: string, account: WhatsAppAccountCreds) {
    await this.sendText(tenantId, conversationId, phone, account, 'No entendí tu respuesta. Elegí una opción de la lista:');
    await this.sendMenu(tenantId, conversationId, phone);
  }

  private async handoffToHuman(tenantId: string, conversationId: string, reason: string) {
    const assignedUserId = await this.assignmentService.findLeastBusyAgent(tenantId);

    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { mode: 'AGENT', botState: null, assignedUserId },
    });

    await this.prisma.auditLog.create({
      data: { tenantId, conversationId, action: 'conversation.bot_handoff', metadata: { reason, assignedUserId } },
    });
    if (assignedUserId) {
      await this.prisma.auditLog.create({
        data: { tenantId, conversationId, action: 'conversation.auto_assigned', metadata: { assignedUserId } },
      });
    }

    this.eventBus.publish({ type: 'conversation_updated', tenantId, payload: { conversationId } });
  }

  private extractReplyId(msg: any): string | undefined {
    return msg.interactive?.list_reply?.id || msg.interactive?.button_reply?.id || undefined;
  }

  private async getAccount(tenantId: string): Promise<WhatsAppAccountCreds | null> {
    const account = await this.prisma.whatsAppAccount.findUnique({ where: { tenantId } });
    if (!account || !account.isActive) {
      this.logger.warn(`No hay cuenta activa de WhatsApp para tenant ${tenantId}, el bot no puede responder`);
      return null;
    }
    return { phoneNumberId: account.phoneNumberId, accessToken: account.accessToken };
  }

  private async sendText(tenantId: string, conversationId: string, phone: string, account: WhatsAppAccountCreds, body: string) {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone,
      type: 'text',
      text: { preview_url: false, body },
    };
    await this.sendAndLog(tenantId, conversationId, account, payload, body);
  }

  private async sendAndLog(
    tenantId: string,
    conversationId: string,
    account: WhatsAppAccountCreds,
    payload: any,
    bodyForHistory: string,
  ) {
    let externalId: string | undefined;
    try {
      const url = `https://graph.facebook.com/${this.apiVersion}/${account.phoneNumberId}/messages`;
      const { data } = await axios.post(url, payload, {
        headers: { Authorization: `Bearer ${account.accessToken}`, 'Content-Type': 'application/json' },
      });
      externalId = data?.messages?.[0]?.id;
    } catch (err) {
      this.logger.error('Failed to send bot message', err?.response?.data || err?.message);
      return;
    }

    const now = new Date();
    const [message] = await Promise.all([
      this.prisma.message.create({
        data: {
          tenantId,
          conversationId,
          direction: 'OUTBOUND',
          type: 'TEXT',
          body: bodyForHistory,
          status: 'SENT',
          externalId,
        },
      }),
      this.prisma.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: now, lastMessageText: bodyForHistory },
      }),
    ]);

    this.eventBus.publish({
      type: 'new_message',
      tenantId,
      payload: {
        message,
        conversationId,
        lastMessageText: bodyForHistory,
        lastMessageAt: now.toISOString(),
      },
    });
  }
}
