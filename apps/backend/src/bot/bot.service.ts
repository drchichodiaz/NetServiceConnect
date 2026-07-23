import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { PrismaService } from '../prisma/prisma.service';
import { EventBusService } from '../events/event-bus.service';
import { AssignmentService } from '../whatsapp/assignment.service';
import { OpenAiClientService } from '../common/openai-client.service';

interface WhatsAppAccountCreds {
  phoneNumberId: string;
  accessToken: string;
}

type MenuNodeType = 'MENU' | 'TEXT' | 'ORDER_LOOKUP' | 'AGENT' | 'AI_CHAT';

interface MenuNode {
  id: string;
  parentId: string | null;
  type: MenuNodeType;
  title: string;
  subtitle: string | null;
  bodyText: string | null;
  promptText: string | null;
}

interface BotContext {
  nodeId: string | null;
  retryCount: number;
  // Desde cuándo está activa la sesión de chat de IA actual (ISO). Acota el
  // historial que se le manda a OpenAI para no incluir ruido de navegación
  // del menú de turnos anteriores en la misma conversación.
  aiSince: string | null;
}

const DEFAULT_CONFIG_TEXT = 'Todavía no cargamos esta información. Ya te paso con un agente para ayudarte.';
// Meta permite máx. 10 filas por interactive list. En un nodo no-raíz reservamos
// 1 fila para "‹ Volver" (UP_ID), así que ahí el cupo real de opciones es 9.
const ROOT_ROW_CAP = 10;
const CHILD_ROW_CAP = 9;
const UP_ID = '__up__';
const HUMAN_ESCAPE_RE = /\b(agente|humano)\b/i;
const BACK_TO_MENU_RE = /\b(volver|menu|menú|atras|atrás)\b/i;
// Cuántas respuestas no reconocidas seguidas tolera el bot en un mismo prompt
// (listado de opciones, búsqueda, confirmación post-respuesta) antes de derivar
// a un humano en vez de seguir reenviando lo mismo indefinidamente.
const MAX_UNKNOWN_RETRIES = 3;
// Estados que conoce el motor genérico. Cualquier otro valor de ConversationBotState
// (los 4 legacy de Fase D: BRANCH_MENU/AWAITING_BRANCH_QUERY/AWAITING_BRANCH_FOLLOWUP/
// AWAITING_RESOLUTION_CONFIRMATION) significa que la conversación quedó a mitad de
// camino en el deploy del árbol configurable — se resetea a la raíz sin crashear.
const NEW_STATES = new Set(['MENU', 'AWAITING_QUERY', 'AWAITING_ORDER_NUMBER', 'AWAITING_POST_REPLY', 'AWAITING_AI_CHAT']);
// Cuántos mensajes de la sesión de IA actual (acotada por botContext.aiSince) se
// mandan como historial — generoso a propósito, el costo no es una preocupación acá,
// es solo una cota de sanidad para el tamaño del prompt.
const AI_CHAT_HISTORY_LIMIT = 60;
// Las palabras clave de salida (agente/humano/volver/menú) solo se interpretan como
// comando si el mensaje es corto — si no, una pregunta real como "¿tienen un agente
// de viajes?" o "¿cuál es el menú de precios?" dispararía una salida incorrecta.
const SHORT_MESSAGE_MAX_WORDS = 4;

@Injectable()
export class BotService {
  private readonly logger = new Logger(BotService.name);
  private readonly apiVersion: string;

  constructor(
    private prisma: PrismaService,
    private eventBus: EventBusService,
    private assignmentService: AssignmentService,
    private openaiClient: OpenAiClientService,
    config: ConfigService,
  ) {
    this.apiVersion = config.get('META_API_VERSION') || 'v19.0';
  }

  /** Envía el menú raíz del tenant. */
  async sendMenu(tenantId: string, conversationId: string, phone: string) {
    return this.enterNode(tenantId, conversationId, phone, null);
  }

  /** Rutea la respuesta de un cliente cuando la conversación sigue en modo BOT. */
  async handleBotReply(tenantId: string, conversationId: string, botState: string | null, phone: string, msg: any) {
    const account = await this.getAccount(tenantId);
    if (!account) {
      return this.handoffToHuman(tenantId, conversationId, 'whatsapp_account_unavailable');
    }

    if (botState && !NEW_STATES.has(botState)) {
      await this.setContext(conversationId, { nodeId: null, retryCount: 0 });
      return this.enterNode(tenantId, conversationId, phone, null, account);
    }

    switch (botState) {
      case 'AWAITING_ORDER_NUMBER':
        return this.handleOrderNumberReply(tenantId, conversationId, phone, msg, account);
      case 'AWAITING_QUERY':
        return this.handleQueryReply(tenantId, conversationId, phone, msg, account);
      case 'AWAITING_POST_REPLY':
        return this.handlePostReplyReply(tenantId, conversationId, phone, msg, account);
      case 'AWAITING_AI_CHAT':
        return this.handleAiChatReply(tenantId, conversationId, phone, msg, account);
    }
    return this.handleMenuReply(tenantId, conversationId, phone, msg, account);
  }

  // ─── Motor genérico del árbol de menú ──────────────────────────────────────

  /**
   * Lista los hijos activos de `nodeId` (null = raíz) como interactive list, o
   * pide texto libre si superan el cupo de filas de WhatsApp. Siempre revalida
   * el nodo contra la DB — nunca confía ciegamente en botContext.nodeId, porque
   * un admin puede haber borrado/desactivado el nodo mientras la conversación
   * estaba a mitad de camino.
   */
  private async enterNode(
    tenantId: string,
    conversationId: string,
    phone: string,
    nodeId: string | null,
    account?: WhatsAppAccountCreds,
  ) {
    const acc = account ?? (await this.getAccount(tenantId));
    if (!acc) {
      return this.handoffToHuman(tenantId, conversationId, 'whatsapp_account_unavailable');
    }

    let node: MenuNode | null = null;
    if (nodeId) {
      node = await this.resolveNode(tenantId, nodeId);
      if (!node) {
        return this.enterNode(tenantId, conversationId, phone, null, acc);
      }
    }

    const children = await this.prisma.tenantMenuNode.findMany({
      where: { tenantId, parentId: nodeId, active: true },
      orderBy: [{ sortOrder: 'asc' }],
    });

    if (children.length === 0) {
      const sent = await this.sendText(tenantId, conversationId, phone, acc, DEFAULT_CONFIG_TEXT);
      if (!sent) {
        return this.handoffToHuman(tenantId, conversationId, 'bot_send_failed');
      }
      if (node) {
        return this.enterNode(tenantId, conversationId, phone, node.parentId, acc);
      }
      return this.handoffToHuman(tenantId, conversationId, 'bot_not_configured');
    }

    const isRoot = nodeId === null;
    const rowCap = isRoot ? ROOT_ROW_CAP : CHILD_ROW_CAP;

    if (children.length > rowCap) {
      const prompt = node?.promptText?.trim() || '¿Qué estás buscando? Escríbeme el nombre de la opción.';
      const sent = await this.sendText(tenantId, conversationId, phone, acc, prompt);
      if (!sent) {
        return this.handoffToHuman(tenantId, conversationId, 'bot_send_failed');
      }
      await this.setContext(conversationId, { nodeId, retryCount: 0 });
      await this.prisma.conversation.update({ where: { id: conversationId }, data: { botState: 'AWAITING_QUERY' } });
      return;
    }

    const rows = children.map((c) => {
      const row: { id: string; title: string; description?: string } = { id: c.id, title: c.title.slice(0, 24) };
      if (c.subtitle) row.description = c.subtitle.slice(0, 72);
      return row;
    });
    if (!isRoot) rows.push({ id: UP_ID, title: '‹ Volver' });

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: node?.promptText?.trim() || (isRoot ? '¡Hola! ¿En qué te podemos ayudar?' : `¿Qué necesitas de "${node!.title}"?`) },
        action: { button: 'Ver opciones', sections: [{ title: node?.title || 'Menú', rows }] },
      },
    };

    const summary = `[${node?.title || 'Menú'}] ${children.map((c) => c.title).join(' · ')}`;
    const sent = await this.sendAndLog(tenantId, conversationId, acc, payload, summary);
    if (!sent) {
      return this.handoffToHuman(tenantId, conversationId, 'bot_send_failed');
    }

    await this.setContext(conversationId, { nodeId, retryCount: 0 });
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { botState: 'MENU' } });
  }

  private async handleMenuReply(tenantId: string, conversationId: string, phone: string, msg: any, account: WhatsAppAccountCreds) {
    const { nodeId } = await this.getContext(conversationId);
    const optionId = this.extractReplyId(msg);

    if (optionId === UP_ID) {
      await this.resetRetryCount(conversationId);
      const current = nodeId ? await this.resolveNode(tenantId, nodeId) : null;
      return this.enterNode(tenantId, conversationId, phone, current?.parentId ?? null, account);
    }

    const child = optionId
      ? await this.prisma.tenantMenuNode.findFirst({ where: { id: optionId, tenantId, parentId: nodeId, active: true } })
      : null;

    if (!child) {
      return this.trackUnrecognizedReply(tenantId, conversationId, phone, account, msg, () =>
        this.resendListWithHint(tenantId, conversationId, phone, account, nodeId),
      );
    }

    await this.resetRetryCount(conversationId);
    return this.dispatchNode(tenantId, conversationId, phone, account, child);
  }

  private async resendListWithHint(tenantId: string, conversationId: string, phone: string, account: WhatsAppAccountCreds, nodeId: string | null) {
    const sent = await this.sendText(tenantId, conversationId, phone, account, 'No entendí tu respuesta. Elige una opción de la lista:');
    if (!sent) {
      return this.handoffToHuman(tenantId, conversationId, 'bot_send_failed');
    }
    // enterNode ya se auto-deriva a un humano si el reenvío del listado también falla.
    return this.enterNode(tenantId, conversationId, phone, nodeId, account);
  }

  private async dispatchNode(tenantId: string, conversationId: string, phone: string, account: WhatsAppAccountCreds, node: MenuNode) {
    switch (node.type) {
      case 'MENU':
        return this.enterNode(tenantId, conversationId, phone, node.id, account);
      case 'TEXT':
        return this.sendLeafText(tenantId, conversationId, phone, account, node);
      case 'ORDER_LOOKUP':
        return this.askOrderNumber(tenantId, conversationId, phone, account);
      case 'AGENT':
        await this.sendText(tenantId, conversationId, phone, account, 'Perfecto, ya te conecto con un agente.');
        return this.handoffToHuman(tenantId, conversationId, 'menu_selection');
      case 'AI_CHAT':
        return this.startAiChat(tenantId, conversationId, phone, account, node);
    }
  }

  // ─── Modo IA: chat libre con OpenAI, usando la info del negocio del tenant ─

  private async startAiChat(tenantId: string, conversationId: string, phone: string, account: WhatsAppAccountCreds, node: MenuNode) {
    const config = await this.prisma.tenantBotConfig.findUnique({ where: { tenantId } });
    const knowledgeBase = config?.aiKnowledgeBase?.trim();
    const resolved = knowledgeBase ? await this.openaiClient.getClient(tenantId) : null;

    // Sin info del negocio o sin clave de OpenAI resoluble, no tiene sentido entrar
    // al modo — el bot "conversaría" sin nada que decir. Se deriva directo.
    if (!knowledgeBase || !resolved) {
      return this.handoffToHuman(tenantId, conversationId, 'ai_not_configured');
    }

    const welcome = node.bodyText?.trim() || 'Cuéntame en qué te puedo ayudar.';
    const sent = await this.sendText(tenantId, conversationId, phone, account, welcome);
    if (!sent) {
      return this.handoffToHuman(tenantId, conversationId, 'bot_send_failed');
    }

    await this.setContext(conversationId, { nodeId: node.parentId, retryCount: 0, aiSince: new Date().toISOString() });
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { botState: 'AWAITING_AI_CHAT' } });

    await this.prisma.auditLog.create({
      data: { tenantId, conversationId, action: 'bot.ai_chat_started', metadata: { nodeId: node.id, title: node.title } },
    });
  }

  private async handleAiChatReply(tenantId: string, conversationId: string, phone: string, msg: any, account: WhatsAppAccountCreds) {
    const text = msg.type === 'text' ? (msg.text?.body?.trim() || '') : '';

    // Imagen/audio/documento/sticker/interactivo, o texto vacío: no tiene sentido
    // mandarle eso a OpenAI. Pedimos texto y no gastamos una llamada a la API.
    if (!text) {
      const sent = await this.sendText(tenantId, conversationId, phone, account, 'Por ahora solo puedo leer mensajes de texto. ¿Podrías escribirlo?');
      if (!sent) return this.handoffToHuman(tenantId, conversationId, 'bot_send_failed');
      return;
    }

    const { nodeId, aiSince } = await this.getContext(conversationId);

    // Las palabras clave de salida solo aplican a mensajes cortos — si no, una
    // pregunta real como "¿tienen un agente de viajes?" o "¿cuál es el menú de
    // precios?" dispararía una salida incorrecta en vez de ir a la IA.
    const isShortMessage = text.split(/\s+/).length <= SHORT_MESSAGE_MAX_WORDS;

    if (isShortMessage && HUMAN_ESCAPE_RE.test(text)) {
      return this.handoffToHuman(tenantId, conversationId, 'ai_chat_escape');
    }
    if (isShortMessage && BACK_TO_MENU_RE.test(text)) {
      await this.resetRetryCount(conversationId);
      const current = nodeId ? await this.resolveNode(tenantId, nodeId) : null;
      return this.enterNode(tenantId, conversationId, phone, current?.parentId ?? null, account);
    }

    // Se busca fresco en cada turno (no se cachea en botContext) para que un admin
    // corrigiendo la info del negocio a mitad de conversación tenga efecto inmediato.
    const config = await this.prisma.tenantBotConfig.findUnique({ where: { tenantId } });
    const knowledgeBase = config?.aiKnowledgeBase?.trim();
    const resolved = knowledgeBase ? await this.openaiClient.getClient(tenantId) : null;

    if (!knowledgeBase || !resolved) {
      return this.handoffToHuman(tenantId, conversationId, 'ai_not_configured');
    }

    // Acotado por aiSince: no queremos que el historial incluya resúmenes de listas
    // de menú ni prompts de "¿necesitas algo más?" de una navegación anterior en la
    // misma conversación — solo los turnos de la sesión de IA actual.
    const since = aiSince ? new Date(aiSince) : new Date(0);
    const history = await this.prisma.message.findMany({
      where: { conversationId, tenantId, direction: { in: ['INBOUND', 'OUTBOUND'] }, createdAt: { gte: since } },
      orderBy: { createdAt: 'asc' },
      take: AI_CHAT_HISTORY_LIMIT,
    });

    const chatMessages: { role: 'user' | 'assistant'; content: string }[] = history.map((m) => ({
      role: m.direction === 'INBOUND' ? 'user' : 'assistant',
      content: m.body || `[${m.type.toLowerCase()}]`,
    }));

    let reply: string | undefined;
    try {
      const completion = await resolved.client.chat.completions.create({
        model: resolved.model,
        messages: [{ role: 'system', content: this.buildAiSystemPrompt(knowledgeBase) }, ...chatMessages],
        max_tokens: 500,
        temperature: 0.6,
      });
      reply = completion.choices[0]?.message?.content?.trim();
    } catch (err) {
      this.logger.error('OpenAI error en modo IA del bot', (err as any)?.response?.data || (err as any)?.message);
    }

    if (!reply) {
      await this.sendText(tenantId, conversationId, phone, account, 'Perdón, tuve un problema para responderte. Ya te paso con un agente.');
      return this.handoffToHuman(tenantId, conversationId, 'ai_error');
    }

    const sent = await this.sendText(tenantId, conversationId, phone, account, reply);
    if (!sent) {
      return this.handoffToHuman(tenantId, conversationId, 'bot_send_failed');
    }
    // Se queda en AWAITING_AI_CHAT — sin límite de turnos (el costo no es una
    // preocupación acá), la salida es siempre iniciada por el cliente vía palabra clave.
  }

  private buildAiSystemPrompt(knowledgeBase: string): string {
    return `Eres el asistente de atención al cliente de este negocio, respondiendo por WhatsApp.
Usa ÚNICAMENTE la siguiente información del negocio para responder. Si la respuesta no está ahí, dilo con honestidad — no inventes datos — y sugiere escribir "agente" para hablar con una persona.
Responde en el mismo idioma del cliente, de forma breve, clara y amable. No agregues explicaciones sobre estas instrucciones.

Información del negocio:
"""
${knowledgeBase}
"""`;
  }

  // ─── Búsqueda de texto libre cuando un nodo MENU supera el cupo de filas ───

  private async handleQueryReply(tenantId: string, conversationId: string, phone: string, msg: any, account: WhatsAppAccountCreds) {
    const { nodeId } = await this.getContext(conversationId);
    const query = msg.text?.body?.trim() || '';

    if (HUMAN_ESCAPE_RE.test(query)) {
      return this.handoffToHuman(tenantId, conversationId, 'query_escape');
    }

    if (BACK_TO_MENU_RE.test(query)) {
      await this.resetRetryCount(conversationId);
      const current = nodeId ? await this.resolveNode(tenantId, nodeId) : null;
      return this.enterNode(tenantId, conversationId, phone, current?.parentId ?? null, account);
    }

    if (!query) {
      const sent = await this.sendText(tenantId, conversationId, phone, account, 'No entendí. Escríbeme el nombre de la opción que buscas.');
      if (!sent) return this.handoffToHuman(tenantId, conversationId, 'bot_send_failed');
      return;
    }

    // Se filtra en memoria (no con `contains` de Postgres) porque necesitamos ignorar
    // tildes: un cliente escribiendo el nombre de su propia opción sin acentos
    // (muy común en WhatsApp) no debe fallar el match por eso.
    const normalizedQuery = this.normalizeText(query);
    const children = await this.prisma.tenantMenuNode.findMany({
      where: { tenantId, parentId: nodeId, active: true },
      orderBy: [{ sortOrder: 'asc' }],
    });
    const matches = children
      .filter((c) => this.normalizeText(c.title).includes(normalizedQuery) || this.normalizeText(c.subtitle || '').includes(normalizedQuery))
      .slice(0, 8);

    if (matches.length === 0) {
      await this.prisma.auditLog.create({
        data: { tenantId, conversationId, action: 'conversation.menu_query_no_match', metadata: { query } },
      });
      await this.sendText(tenantId, conversationId, phone, account, 'No encontré ninguna opción con ese nombre. Ya te paso con un agente.');
      return this.handoffToHuman(tenantId, conversationId, 'query_no_match');
    }

    if (matches.length === 1) {
      await this.resetRetryCount(conversationId);
      return this.dispatchNode(tenantId, conversationId, phone, account, matches[0]);
    }

    const names = matches.map((c) => `• ${c.title}`).join('\n');
    const sent = await this.sendText(
      tenantId,
      conversationId,
      phone,
      account,
      `Encontré varias opciones, ¿cuál es la tuya?\n\n${names}\n\nEscribe el nombre completo.`,
    );
    if (!sent) {
      return this.handoffToHuman(tenantId, conversationId, 'bot_send_failed');
    }
    // se queda en AWAITING_QUERY para reintentar con un texto más específico
  }

  // ─── Hoja de texto (horarios/servicios/detalle de sucursal/lo que cargue el tenant) ─

  private async sendLeafText(tenantId: string, conversationId: string, phone: string, account: WhatsAppAccountCreds, node: MenuNode) {
    const text = node.bodyText?.trim() || DEFAULT_CONFIG_TEXT;
    const sent = await this.sendText(tenantId, conversationId, phone, account, text);
    if (!sent) {
      return this.handoffToHuman(tenantId, conversationId, 'bot_send_failed');
    }

    await this.prisma.auditLog.create({
      data: { tenantId, conversationId, action: 'bot.node_selected', metadata: { nodeId: node.id, title: node.title, nodeType: node.type } },
    });

    return this.sendPostReplyPrompt(tenantId, conversationId, phone, account, node.parentId);
  }

  // ─── Prompt post-respuesta (generaliza confirmación de resolución + follow-up) ─

  private async sendPostReplyPrompt(tenantId: string, conversationId: string, phone: string, account: WhatsAppAccountCreds, parentNodeId: string | null) {
    const sent = await this.sendButtons(tenantId, conversationId, phone, account, '¿Necesitas algo más?', [
      { id: 'post_no_more', title: 'No, gracias' },
      { id: 'post_more', title: 'Ver otra opción' },
      { id: 'post_agent', title: 'Hablar con un agente' },
    ]);
    if (!sent) {
      return this.handoffToHuman(tenantId, conversationId, 'bot_send_failed');
    }
    await this.setContext(conversationId, { nodeId: parentNodeId, retryCount: 0 });
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { botState: 'AWAITING_POST_REPLY' } });
  }

  private async handlePostReplyReply(tenantId: string, conversationId: string, phone: string, msg: any, account: WhatsAppAccountCreds) {
    const { nodeId } = await this.getContext(conversationId);
    const optionId = this.extractReplyId(msg);
    switch (optionId) {
      case 'post_no_more':
        return this.closeAsBotResolved(tenantId, conversationId, phone, account);
      case 'post_more':
        await this.resetRetryCount(conversationId);
        return this.enterNode(tenantId, conversationId, phone, nodeId, account);
      case 'post_agent':
        return this.handoffToHuman(tenantId, conversationId, 'post_reply_agent');
      default:
        return this.trackUnrecognizedReply(tenantId, conversationId, phone, account, msg, () =>
          this.sendPostReplyPrompt(tenantId, conversationId, phone, account, nodeId),
        );
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
      '¡Perfecto! Me alegra haberte ayudado.\n\nCuando necesites algo más, puedes volver a escribirnos.',
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

  // ─── Consultar orden (sin cambios respecto al árbol configurable) ──────────

  private async askOrderNumber(tenantId: string, conversationId: string, phone: string, account: WhatsAppAccountCreds) {
    const sent = await this.sendText(tenantId, conversationId, phone, account, 'Dime el número de tu orden y en un momento te ayudamos.');
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
    // cae al fallback humano. Cuando el nodo ORDER_LOOKUP tenga una config.apiUrl,
    // acá es donde se debería intentar la consulta real antes de derivar.
    await this.sendText(
      tenantId,
      conversationId,
      phone,
      account,
      'Por ahora no puedo consultar tu orden automáticamente. Ya te paso con un agente que te va a ayudar con el número que me pasaste.',
    );
    await this.handoffToHuman(tenantId, conversationId, 'order_lookup_fallback');
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

  // ─── Contador de respuestas no reconocidas ─────────────────────────────────

  /**
   * Se llama desde cada prompt del bot (listado de opciones, confirmación
   * post-respuesta) cuando la respuesta del cliente no matchea ninguna opción
   * esperada. Reenvía el mismo prompt hasta MAX_UNKNOWN_RETRIES veces seguidas;
   * a partir de ahí deriva a un humano en vez de seguir dando vueltas
   * indefinidamente si el cliente nunca toca una opción válida.
   */
  private async trackUnrecognizedReply(
    tenantId: string,
    conversationId: string,
    phone: string,
    account: WhatsAppAccountCreds,
    msg: any,
    resend: () => Promise<any>,
  ) {
    const { retryCount: prevRetryCount } = await this.getContext(conversationId);
    const retryCount = prevRetryCount + 1;
    const rawReply = msg.text?.body || msg.interactive?.list_reply?.title || msg.interactive?.button_reply?.title || `[${msg.type}]`;

    await this.prisma.auditLog.create({
      data: { tenantId, conversationId, action: 'bot.unknown_message', metadata: { retryCount, rawReply } },
    });

    if (retryCount >= MAX_UNKNOWN_RETRIES) {
      await this.prisma.auditLog.create({ data: { tenantId, conversationId, action: 'bot.max_retries_reached' } });
      await this.sendText(
        tenantId,
        conversationId,
        phone,
        account,
        'Parece que necesitas una atención más específica. Ya te comunico con uno de nuestros asesores.',
      );
      return this.handoffToHuman(tenantId, conversationId, 'max_retries_reached');
    }

    await this.setContext(conversationId, { retryCount });
    return resend();
  }

  private async resetRetryCount(conversationId: string) {
    await this.setContext(conversationId, { retryCount: 0 });
  }

  // ─── botContext (merge, nunca overwrite — ver setContext) ──────────────────

  private async getContext(conversationId: string): Promise<BotContext> {
    const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId }, select: { botContext: true } });
    const ctx = (conv?.botContext as Partial<BotContext>) || {};
    return { nodeId: ctx.nodeId ?? null, retryCount: ctx.retryCount ?? 0, aiSince: ctx.aiSince ?? null };
  }

  /**
   * Siempre mergea sobre el botContext actual — nunca sobrescribe. botContext
   * ahora carga tanto `nodeId` (en qué punto del árbol está la conversación)
   * como `retryCount`; escribir uno sin el otro borraría el que no se pasó.
   */
  private async setContext(conversationId: string, patch: Partial<BotContext>) {
    const current = await this.getContext(conversationId);
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { botContext: { ...current, ...patch } },
    });
  }

  private async resolveNode(tenantId: string, nodeId: string): Promise<MenuNode | null> {
    return this.prisma.tenantMenuNode.findFirst({ where: { id: nodeId, tenantId, active: true } });
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
