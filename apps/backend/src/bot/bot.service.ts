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

interface BranchLike {
  id: string;
  name: string;
  address: string;
  scheduleText: string | null;
  phone: string | null;
  mapsUrl: string | null;
  servicesText: string | null;
}

const MENU_OPTIONS: { id: string; title: string }[] = [
  { id: 'horarios', title: 'Horarios' },
  { id: 'sucursales', title: 'Sucursales' },
  { id: 'servicios', title: 'Servicios' },
  { id: 'consultar_orden', title: 'Consultar mi orden' },
  { id: 'agente', title: 'Hablar con un agente' },
];

const DEFAULT_CONFIG_TEXT = 'Todavía no cargamos esta información. Ya te paso con un agente para ayudarte.';
const MAX_LIST_ROWS = 10;
const HUMAN_ESCAPE_RE = /\b(agente|humano)\b/i;

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
    if (!account) {
      return this.handoffToHuman(tenantId, conversationId, 'whatsapp_account_unavailable');
    }

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
    const sent = await this.sendAndLog(tenantId, conversationId, account, payload, summary);
    if (!sent) {
      return this.handoffToHuman(tenantId, conversationId, 'bot_send_failed');
    }
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { botState: 'MENU' } });
  }

  /** Rutea la respuesta de un cliente cuando la conversación sigue en modo BOT. */
  async handleBotReply(tenantId: string, conversationId: string, botState: string | null, phone: string, msg: any) {
    const account = await this.getAccount(tenantId);
    if (!account) {
      return this.handoffToHuman(tenantId, conversationId, 'whatsapp_account_unavailable');
    }

    switch (botState) {
      case 'AWAITING_ORDER_NUMBER':
        return this.handleOrderNumberReply(tenantId, conversationId, phone, msg, account);
      case 'BRANCH_MENU':
        return this.handleBranchMenuReply(tenantId, conversationId, phone, msg, account);
      case 'AWAITING_BRANCH_QUERY':
        return this.handleBranchQueryReply(tenantId, conversationId, phone, msg, account);
      case 'AWAITING_BRANCH_FOLLOWUP':
        return this.handleBranchFollowupReply(tenantId, conversationId, phone, msg, account);
      case 'AWAITING_RESOLUTION_CONFIRMATION':
        return this.handleResolutionConfirmationReply(tenantId, conversationId, phone, msg, account);
    }

    const optionId = this.extractReplyId(msg);
    switch (optionId) {
      case 'horarios':
      case 'servicios':
        return this.replyWithConfigText(tenantId, conversationId, phone, optionId, account);
      case 'sucursales':
        return this.startBranchLookup(tenantId, conversationId, phone, account);
      case 'consultar_orden':
        return this.askOrderNumber(tenantId, conversationId, phone, account);
      case 'agente':
        await this.sendText(tenantId, conversationId, phone, account, 'Perfecto, ya te conecto con un agente.');
        return this.handoffToHuman(tenantId, conversationId, 'menu_selection');
      default:
        return this.resendMenuWithHint(tenantId, conversationId, phone, account);
    }
  }

  // ─── Horarios / Servicios / Sucursales (fallback plano) ───────────────────

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
    const sent = await this.sendText(tenantId, conversationId, phone, account, text);
    if (!sent) {
      return this.handoffToHuman(tenantId, conversationId, 'bot_send_failed');
    }
    return this.sendResolutionConfirmation(tenantId, conversationId, phone, account);
  }

  // ─── Sucursales dinámicas ───────────────────────────────────────────────────

  private async startBranchLookup(tenantId: string, conversationId: string, phone: string, account: WhatsAppAccountCreds) {
    const branches = await this.prisma.tenantBranch.findMany({
      where: { tenantId, active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    if (branches.length === 0) {
      return this.replyWithConfigText(tenantId, conversationId, phone, 'sucursales', account);
    }

    if (branches.length <= MAX_LIST_ROWS) {
      return this.sendBranchMenu(tenantId, conversationId, phone, account, branches);
    }

    // Meta no permite más de 10 filas en un interactive list message — con más
    // sucursales que eso, pedimos texto libre y buscamos por nombre/dirección.
    const sent = await this.sendText(
      tenantId,
      conversationId,
      phone,
      account,
      '¿En qué ciudad estás o cuál es el nombre de la sucursal más cercana?',
    );
    if (!sent) {
      return this.handoffToHuman(tenantId, conversationId, 'bot_send_failed');
    }
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { botState: 'AWAITING_BRANCH_QUERY' } });
  }

  private async sendBranchMenu(tenantId: string, conversationId: string, phone: string, account: WhatsAppAccountCreds, branches: BranchLike[]) {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: '¿Cuál es tu sucursal más cercana?' },
        action: {
          button: 'Ver sucursales',
          sections: [{
            title: 'Sucursales',
            rows: branches.map((b) => ({ id: b.id, title: b.name.slice(0, 24), description: (b.address || '').slice(0, 72) })),
          }],
        },
      },
    };

    const summary = `[Sucursales] ${branches.map((b) => b.name).join(' · ')}`;
    const sent = await this.sendAndLog(tenantId, conversationId, account, payload, summary);
    if (!sent) {
      return this.handoffToHuman(tenantId, conversationId, 'bot_send_failed');
    }
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { botState: 'BRANCH_MENU' } });
  }

  private async resendBranchMenuWithHint(tenantId: string, conversationId: string, phone: string, account: WhatsAppAccountCreds) {
    const sent = await this.sendText(tenantId, conversationId, phone, account, 'No identifiqué esa opción. Elegí una sucursal de la lista:');
    if (!sent) {
      return this.handoffToHuman(tenantId, conversationId, 'bot_send_failed');
    }
    return this.startBranchLookup(tenantId, conversationId, phone, account);
  }

  private async handleBranchMenuReply(tenantId: string, conversationId: string, phone: string, msg: any, account: WhatsAppAccountCreds) {
    const branchId = this.extractReplyId(msg);
    const branch = branchId
      ? await this.prisma.tenantBranch.findFirst({ where: { id: branchId, tenantId, active: true } })
      : null;

    if (!branch) {
      return this.resendBranchMenuWithHint(tenantId, conversationId, phone, account);
    }
    return this.showBranchDetails(tenantId, conversationId, phone, account, branch);
  }

  private async handleBranchQueryReply(tenantId: string, conversationId: string, phone: string, msg: any, account: WhatsAppAccountCreds) {
    const query = msg.text?.body?.trim() || '';

    if (HUMAN_ESCAPE_RE.test(query)) {
      return this.handoffToHuman(tenantId, conversationId, 'branch_lookup_escape');
    }

    if (!query) {
      const sent = await this.sendText(tenantId, conversationId, phone, account, 'No entendí. Escribime el nombre de tu ciudad o de la sucursal más cercana.');
      if (!sent) return this.handoffToHuman(tenantId, conversationId, 'bot_send_failed');
      return;
    }

    // Se filtra en memoria (no con `contains` de Postgres) porque necesitamos ignorar
    // tildes: un cliente escribiendo el nombre de su propia sucursal sin acentos
    // (muy común en WhatsApp) no debe fallar el match por eso.
    const normalizedQuery = this.normalizeText(query);
    const allActive = await this.prisma.tenantBranch.findMany({
      where: { tenantId, active: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
    const matches = allActive
      .filter((b) => this.normalizeText(b.name).includes(normalizedQuery) || this.normalizeText(b.address).includes(normalizedQuery))
      .slice(0, 8);

    if (matches.length === 0) {
      await this.prisma.auditLog.create({
        data: { tenantId, conversationId, action: 'conversation.branch_lookup_no_match', metadata: { query } },
      });
      await this.sendText(tenantId, conversationId, phone, account, 'No encontré una sucursal con ese nombre. Ya te paso con un agente.');
      return this.handoffToHuman(tenantId, conversationId, 'branch_lookup_no_match');
    }

    if (matches.length === 1) {
      return this.showBranchDetails(tenantId, conversationId, phone, account, matches[0]);
    }

    const names = matches.map((b) => `• ${b.name}`).join('\n');
    const sent = await this.sendText(
      tenantId,
      conversationId,
      phone,
      account,
      `Encontré varias sucursales, ¿cuál es la tuya?\n\n${names}\n\nEscribí el nombre completo.`,
    );
    if (!sent) {
      return this.handoffToHuman(tenantId, conversationId, 'bot_send_failed');
    }
    // se queda en AWAITING_BRANCH_QUERY para reintentar con un texto más específico
  }

  private async showBranchDetails(tenantId: string, conversationId: string, phone: string, account: WhatsAppAccountCreds, branch: BranchLike) {
    const lines = [`🏬 ${branch.name}`, `📍 ${branch.address}`];
    if (branch.scheduleText) lines.push(`🕐 ${branch.scheduleText}`);
    if (branch.phone) lines.push(`☎️ ${branch.phone}`);
    if (branch.mapsUrl) lines.push(branch.mapsUrl);
    if (branch.servicesText) lines.push('', `Servicios disponibles: ${branch.servicesText}`);

    const sent = await this.sendText(tenantId, conversationId, phone, account, lines.join('\n'));
    if (!sent) {
      return this.handoffToHuman(tenantId, conversationId, 'bot_send_failed');
    }

    await this.prisma.auditLog.create({
      data: { tenantId, conversationId, action: 'bot.branch_selected', metadata: { branchId: branch.id, branchName: branch.name } },
    });

    return this.sendBranchFollowup(tenantId, conversationId, phone, account);
  }

  private async sendBranchFollowup(tenantId: string, conversationId: string, phone: string, account: WhatsAppAccountCreds) {
    const sent = await this.sendButtons(tenantId, conversationId, phone, account, '¿Necesitás algo más?', [
      { id: 'branch_other', title: 'Ver otra sucursal' },
      { id: 'branch_menu', title: 'Volver al menú' },
      { id: 'branch_agent', title: 'Hablar con un agente' },
    ]);
    if (!sent) {
      return this.handoffToHuman(tenantId, conversationId, 'bot_send_failed');
    }
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { botState: 'AWAITING_BRANCH_FOLLOWUP' } });
  }

  private async handleBranchFollowupReply(tenantId: string, conversationId: string, phone: string, msg: any, account: WhatsAppAccountCreds) {
    const optionId = this.extractReplyId(msg);
    switch (optionId) {
      case 'branch_other':
        return this.startBranchLookup(tenantId, conversationId, phone, account);
      case 'branch_menu':
        return this.sendMenu(tenantId, conversationId, phone);
      case 'branch_agent':
        return this.handoffToHuman(tenantId, conversationId, 'branch_followup');
      default:
        return this.sendBranchFollowup(tenantId, conversationId, phone, account);
    }
  }

  // ─── Confirmación de resolución ────────────────────────────────────────────

  private async sendResolutionConfirmation(tenantId: string, conversationId: string, phone: string, account: WhatsAppAccountCreds) {
    const sent = await this.sendButtons(tenantId, conversationId, phone, account, '¿Pude resolver tu consulta?', [
      { id: 'yes', title: 'Sí, gracias' },
      { id: 'menu', title: 'Volver al menú' },
      { id: 'agent', title: 'Hablar con un agente' },
    ]);
    if (!sent) {
      return this.handoffToHuman(tenantId, conversationId, 'bot_send_failed');
    }
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { botState: 'AWAITING_RESOLUTION_CONFIRMATION' } });
  }

  private async handleResolutionConfirmationReply(tenantId: string, conversationId: string, phone: string, msg: any, account: WhatsAppAccountCreds) {
    const optionId = this.extractReplyId(msg);
    switch (optionId) {
      case 'yes':
        return this.closeAsBotResolved(tenantId, conversationId, phone, account);
      case 'menu':
        return this.sendMenu(tenantId, conversationId, phone);
      case 'agent':
        return this.handoffToHuman(tenantId, conversationId, 'resolution_confirmation');
      default:
        return this.sendResolutionConfirmation(tenantId, conversationId, phone, account);
    }
  }

  private async closeAsBotResolved(tenantId: string, conversationId: string, phone: string, account: WhatsAppAccountCreds) {
    // Ya se resolvió la consulta — cerramos igual aunque el mensaje de despedida
    // falle al enviarse, no tiene sentido derivar a un humano por esto.
    await this.sendText(
      tenantId,
      conversationId,
      phone,
      account,
      '¡Perfecto! Me alegra haberte ayudado.\n\nCuando necesites algo más, podés volver a escribirnos.',
    );

    const updated = await this.prisma.conversation.updateMany({
      where: { id: conversationId, mode: 'BOT' },
      data: { status: 'CLOSED', botState: null, closedReason: 'BOT_RESOLVED' },
    });
    if (updated.count === 0) return; // ya no estaba en modo BOT (otra derivación ganó la carrera)

    await this.prisma.auditLog.create({ data: { tenantId, conversationId, action: 'bot.resolved_without_agent' } });
    await this.prisma.auditLog.create({
      data: { tenantId, conversationId, action: 'conversation.closed', metadata: { reason: 'BOT_RESOLVED' } },
    });

    this.eventBus.publish({ type: 'conversation_updated', tenantId, payload: { conversationId } });
  }

  // ─── Consultar orden (sin cambios de Fase D) ───────────────────────────────

  private async askOrderNumber(tenantId: string, conversationId: string, phone: string, account: WhatsAppAccountCreds) {
    const sent = await this.sendText(tenantId, conversationId, phone, account, 'Decime el número de tu orden y en un momento te ayudamos.');
    if (!sent) {
      return this.handoffToHuman(tenantId, conversationId, 'bot_send_failed');
    }
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

  // ─── Menú principal: reenvío ante texto no reconocido ──────────────────────

  private async resendMenuWithHint(tenantId: string, conversationId: string, phone: string, account: WhatsAppAccountCreds) {
    const sent = await this.sendText(tenantId, conversationId, phone, account, 'No entendí tu respuesta. Elegí una opción de la lista:');
    if (!sent) {
      return this.handoffToHuman(tenantId, conversationId, 'bot_send_failed');
    }
    // sendMenu ya se auto-deriva a un humano si el reenvío del menú también falla.
    await this.sendMenu(tenantId, conversationId, phone);
  }

  // ─── Handoff a humano (idempotente) ────────────────────────────────────────

  private async handoffToHuman(tenantId: string, conversationId: string, reason: string) {
    await this.prisma.auditLog.create({
      data: { tenantId, conversationId, action: 'bot.handoff_requested', metadata: { reason } },
    });

    const assignedUserId = await this.assignmentService.findLeastBusyAgent(tenantId);

    // Guard atómico: si dos disparadores de handoff casi simultáneos (ej: falla de
    // envío + el cliente tocando "hablar con un agente" a la vez) llegan acá, solo
    // el primero en commitear gana — el segundo ve count 0 y no duplica nada.
    const updated = await this.prisma.conversation.updateMany({
      where: { id: conversationId, mode: 'BOT' },
      data: { mode: 'AGENT', botState: null, assignedUserId },
    });
    if (updated.count === 0) return;

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

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private extractReplyId(msg: any): string | undefined {
    return msg.interactive?.list_reply?.id || msg.interactive?.button_reply?.id || undefined;
  }

  private normalizeText(text: string): string {
    return text
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{Diacritic}/gu, '')
      .trim();
  }

  private async getAccount(tenantId: string): Promise<WhatsAppAccountCreds | null> {
    const account = await this.prisma.whatsAppAccount.findUnique({ where: { tenantId } });
    if (!account || !account.isActive) {
      this.logger.warn(`No hay cuenta activa de WhatsApp para tenant ${tenantId}, el bot no puede responder`);
      return null;
    }
    return { phoneNumberId: account.phoneNumberId, accessToken: account.accessToken };
  }

  private async sendText(
    tenantId: string,
    conversationId: string,
    phone: string,
    account: WhatsAppAccountCreds,
    body: string,
  ): Promise<boolean> {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone,
      type: 'text',
      text: { preview_url: false, body },
    };
    return this.sendAndLog(tenantId, conversationId, account, payload, body);
  }

  private async sendButtons(
    tenantId: string,
    conversationId: string,
    phone: string,
    account: WhatsAppAccountCreds,
    bodyText: string,
    buttons: { id: string; title: string }[],
  ): Promise<boolean> {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: bodyText },
        action: {
          buttons: buttons.map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title.slice(0, 20) } })),
        },
      },
    };
    const summary = `[${bodyText}] ${buttons.map((b) => b.title).join(' · ')}`;
    return this.sendAndLog(tenantId, conversationId, account, payload, summary);
  }

  /** Devuelve true si el mensaje salió — los llamadores usan esto para derivar a un humano en vez de quedarse callados. */
  private async sendAndLog(
    tenantId: string,
    conversationId: string,
    account: WhatsAppAccountCreds,
    payload: any,
    bodyForHistory: string,
  ): Promise<boolean> {
    let externalId: string | undefined;
    try {
      const url = `https://graph.facebook.com/${this.apiVersion}/${account.phoneNumberId}/messages`;
      const { data } = await axios.post(url, payload, {
        headers: { Authorization: `Bearer ${account.accessToken}`, 'Content-Type': 'application/json' },
      });
      externalId = data?.messages?.[0]?.id;
    } catch (err) {
      this.logger.error('Failed to send bot message', err?.response?.data || err?.message);
      return false;
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

    return true;
  }
}
