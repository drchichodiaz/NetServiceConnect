import { HttpException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventBusService } from '../events/event-bus.service';
import { AssignmentService } from '../whatsapp/assignment.service';
import { WhatsAppAccountsService, WhatsAppAccountCreds } from '../whatsapp/accounts.service';
import { AiGatewayService } from '../ai-usage/ai-gateway.service';
import { LookupService, LookupConfig } from '../common/lookup.service';
import { BotsService } from '../bots/bots.service';
import { LocationConfig, hasValidCoordinates, mapsLinkFor } from '../common/maps-link';
import { AgendaSettingsService } from '../agenda/agenda-settings.service';
import { AvailabilityService } from '../agenda/availability.service';
import { AppointmentsService } from '../agenda/appointments.service';
import { addDays, fromLocal, toLocal } from '../agenda/agenda-time';
import { clinicName, dayText, hourText } from '../agenda/agenda-text';
import { BookingScreen, NOON, Row, appointmentTitle, dayRows, isAction, needsDayPart, parseScreenId, parseViewId, timeRows, viewId } from './booking';

type MenuNodeType = 'MENU' | 'TEXT' | 'ORDER_LOOKUP' | 'AGENT' | 'AI_CHAT' | 'LOCATION' | 'BOOK_APPOINTMENT' | 'MY_APPOINTMENTS';

interface MenuNode {
  id: string;
  parentId: string | null;
  type: MenuNodeType;
  title: string;
  subtitle: string | null;
  bodyText: string | null;
  promptText: string | null;
  // Config del nodo ORDER_LOOKUP (URL del sistema externo, plantilla de respuesta...).
  config?: unknown;
}

interface BotContext {
  nodeId: string | null;
  // Nodo ORDER_LOOKUP que pidio el dato. Se guarda aparte de nodeId porque ese apunta
  // al menu del que colgaba, y al llegar la respuesta del cliente hay que volver a
  // este nodo para saber a que sistema externo consultar.
  lookupNodeId: string | null;
  retryCount: number;
  // Desde cuándo está activa la sesión de chat de IA actual (ISO). Acota el
  // historial que se le manda a OpenAI para no incluir ruido de navegación
  // del menú de turnos anteriores en la misma conversación.
  aiSince: string | null;
  // Reserva de cita: el nodo BOOK_APPOINTMENT (por su texto de bienvenida) y la ultima
  // pantalla que se le mostro (un id de booking.ts), para reenviarla si responde algo
  // que no es una opcion. El resto del estado viaja en el id de cada fila.
  bookingNodeId: string | null;
  bookingView: string | null;
  // La cita que el paciente esta cambiando o cancelando (boton "Reprogramar" del
  // recordatorio). Null = esta reservando una nueva.
  bookingAppointmentId: string | null;
}

// Cuando un cambio de cita no se puede hacer por el bot y lo toma la clinica.
const BY_CLINIC_TEXT = 'Con gusto. En un momento alguien de la clínica te escribe por aquí para ayudarte con tu cita.';
const DEFAULT_CONFIG_TEXT = 'Todavía no cargamos esta información. Ya te paso con un agente para ayudarte.';
const DEFAULT_MENU_GREETING = '¡Hola! ¿En qué te podemos ayudar?';
const NAME_PLACEHOLDER_RE = /\s*\{nombre\}/gi;
// Meta permite máx. 10 filas por interactive list. En un nodo no-raíz reservamos
// 1 fila para "‹ Volver" (UP_ID), así que ahí el cupo real de opciones es 9.
const ROOT_ROW_CAP = 10;
const CHILD_ROW_CAP = 9;
const UP_ID = '__up__';
const HUMAN_ESCAPE_RE = /\b(agente|humano)\b/i;
// Sin \b: en JavaScript \b solo conoce letras ASCII, y "menú" o "atrás" (con tilde) no
// lo cumplian nunca. Se pide que no haya otra letra pegada antes ni despues.
const BACK_TO_MENU_RE = /(?<!\p{L})(volver|menu|menú|atras|atrás)(?!\p{L})/iu;
// Cuántas respuestas no reconocidas seguidas tolera el bot en un mismo prompt
// (listado de opciones, búsqueda, confirmación post-respuesta) antes de derivar
// a un humano en vez de seguir reenviando lo mismo indefinidamente.
const MAX_UNKNOWN_RETRIES = 3;
// Estados que conoce el motor genérico. Cualquier otro valor de ConversationBotState
// (los 4 legacy de Fase D: BRANCH_MENU/AWAITING_BRANCH_QUERY/AWAITING_BRANCH_FOLLOWUP/
// AWAITING_RESOLUTION_CONFIRMATION) significa que la conversación quedó a mitad de
// camino en el deploy del árbol configurable — se resetea a la raíz sin crashear.
const NEW_STATES = new Set(['MENU', 'AWAITING_QUERY', 'AWAITING_ORDER_NUMBER', 'AWAITING_POST_REPLY', 'AWAITING_AI_CHAT', 'AWAITING_BOOKING']);
// Cuántos mensajes de la sesión de IA actual (acotada por botContext.aiSince) se
// mandan como historial — generoso a propósito, el costo no es una preocupación acá,
// es solo una cota de sanidad para el tamaño del prompt.
const AI_CHAT_HISTORY_LIMIT = 60;
// Las palabras clave de salida (agente/humano/volver/menú) solo se interpretan como
// comando si el mensaje es corto — si no, una pregunta real como "¿tienen un agente
// de viajes?" o "¿cuál es el menú de precios?" dispararía una salida incorrecta.
const SHORT_MESSAGE_MAX_WORDS = 4;

/** Lo que bookingScope devuelve cuando se puede seguir. */
type BookingScope = Extract<Awaited<ReturnType<BotService['bookingScope']>>, { ok: true }>;

@Injectable()
export class BotService {
  private readonly logger = new Logger(BotService.name);
  private readonly apiVersion: string;

  constructor(
    private prisma: PrismaService,
    private eventBus: EventBusService,
    private assignmentService: AssignmentService,
    private accounts: WhatsAppAccountsService,
    private ai: AiGatewayService,
    private lookup: LookupService,
    private bots: BotsService,
    private agendaSettings: AgendaSettingsService,
    private availability: AvailabilityService,
    private appointments: AppointmentsService,
    config: ConfigService,
  ) {
    this.apiVersion = config.get('META_API_VERSION') || 'v19.0';
  }

  /** Arranca una conversación nueva — en el árbol de menú, o directo en modo IA si su bot está configurado así. */
  async sendMenu(tenantId: string, conversationId: string, phone: string) {
    const bot = await this.getBot(tenantId, conversationId);
    if (bot.startInAiChat) {
      return this.startAiChat(tenantId, conversationId, phone, null);
    }
    return this.enterNode(tenantId, conversationId, phone, null);
  }

  /** Rutea la respuesta de un cliente cuando la conversación sigue en modo BOT. */
  async handleBotReply(tenantId: string, conversationId: string, botState: string | null, phone: string, msg: any) {
    const account = await this.accounts.getForConversation(conversationId);
    if (!account) {
      return this.handoffToHuman(tenantId, conversationId, 'whatsapp_account_unavailable');
    }

    if (botState && !NEW_STATES.has(botState)) {
      await this.setContext(conversationId, { nodeId: null, retryCount: 0 });
      return this.enterNode(tenantId, conversationId, phone, null, account);
    }

    // Una fila de una lista de reserva vieja (la conversacion ya siguio a otro paso):
    // se retoma la reserva desde esa pantalla, revalidada. Menos los botones que hacen
    // algo ("Sí, reservar", "Sí, cancelarla"...): esos solo valen en el paso en que se
    // ofrecieron, y fuera de el se ignoran (es el segundo toque de un doble toque, o un
    // boton de hace horas).
    const bookingTap = botState !== 'AWAITING_BOOKING' ? parseViewId(this.extractReplyId(msg)) : null;
    if (bookingTap && isAction(bookingTap)) return;
    if (bookingTap && bookingTap.kind !== 'menu') {
      return this.handleBookingReply(tenantId, conversationId, phone, msg, account);
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
      case 'AWAITING_BOOKING':
        return this.handleBookingReply(tenantId, conversationId, phone, msg, account);
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
    const acc = account ?? (await this.accounts.getForConversation(conversationId));
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

    const bot = await this.getBot(tenantId, conversationId);
    const children = await this.prisma.tenantMenuNode.findMany({
      where: { tenantId, botId: bot.id, parentId: nodeId, active: true },
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
    const greeting = isRoot ? await this.renderMenuGreeting(bot.menuGreeting, conversationId) : null;

    if (children.length > rowCap) {
      const askForName = '¿Qué estás buscando? Escríbeme el nombre de la opción.';
      const prompt = node?.promptText?.trim() || (greeting ? `${greeting}\n\n${askForName}` : askForName);
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
        body: { text: node?.promptText?.trim() || (isRoot ? greeting || DEFAULT_MENU_GREETING : `¿Qué necesitas de "${node!.title}"?`) },
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

    // El botId importa en la raíz: parentId null lo comparten las opciones de todos los bots.
    const botId = await this.getBotId(tenantId, conversationId);
    const child = optionId
      ? await this.prisma.tenantMenuNode.findFirst({ where: { id: optionId, tenantId, botId, parentId: nodeId, active: true } })
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
        return this.askOrderNumber(tenantId, conversationId, phone, account, node);
      case 'AGENT':
        await this.sendText(tenantId, conversationId, phone, account, 'Perfecto, ya te conecto con un agente.');
        return this.handoffToHuman(tenantId, conversationId, 'menu_selection');
      case 'AI_CHAT':
        return this.startAiChat(tenantId, conversationId, phone, node, account);
      case 'LOCATION':
        return this.sendLocation(tenantId, conversationId, phone, account, node);
      case 'BOOK_APPOINTMENT':
        return this.startBooking(tenantId, conversationId, phone, account, node);
      case 'MY_APPOINTMENTS':
        return this.showBookingView(tenantId, conversationId, phone, account, { kind: 'mine' });
    }
  }

  // ─── Modo IA: chat libre con OpenAI, usando la info del negocio del tenant ─

  /**
   * `node` es null cuando el bot está configurado para "arrancar directo en modo IA"
   * (Bot.startInAiChat) — en ese caso no hay un nodo del árbol de
   * menú detrás, así que se usa el texto de bienvenida por defecto y el nivel
   * al que vuelve un "menú"/"volver" es la raíz del árbol (nodeId: null).
   */
  private async startAiChat(
    tenantId: string,
    conversationId: string,
    phone: string,
    node: MenuNode | null,
    account?: WhatsAppAccountCreds,
  ) {
    const acc = account ?? (await this.accounts.getForConversation(conversationId));
    if (!acc) {
      return this.handoffToHuman(tenantId, conversationId, 'whatsapp_account_unavailable');
    }

    const bot = await this.getBot(tenantId, conversationId);
    const knowledgeBase = bot.aiKnowledgeBase?.trim();
    const hasKey = await this.ai.isConfigured(tenantId);

    // Sin info del negocio o sin clave de OpenAI resoluble, no tiene sentido entrar
    // al modo — el bot "conversaría" sin nada que decir. Se deriva directo.
    if (!knowledgeBase || !hasKey) {
      return this.handoffAiNotConfigured(tenantId, conversationId, phone, acc, bot.name, !knowledgeBase, !hasKey);
    }

    // Sin saldo tampoco tiene sentido entrar: sería darle la bienvenida a un cliente
    // para dejarlo sin respuesta en el mensaje siguiente.
    if (!(await this.ai.hasCredits(tenantId))) {
      return this.handoffAiNoCredits(tenantId, conversationId, phone, acc, bot.name);
    }

    const contactName = await this.getContactName(conversationId);
    const baseWelcome = node?.bodyText?.trim() || 'Cuéntame en qué te puedo ayudar.';
    const welcome = contactName ? `¡Hola ${contactName}! ${baseWelcome}` : baseWelcome;
    const sent = await this.sendText(tenantId, conversationId, phone, acc, welcome);
    if (!sent) {
      return this.handoffToHuman(tenantId, conversationId, 'bot_send_failed');
    }

    await this.setContext(conversationId, { nodeId: node?.parentId ?? null, retryCount: 0, aiSince: new Date().toISOString() });
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { botState: 'AWAITING_AI_CHAT' } });

    await this.prisma.auditLog.create({
      data: { tenantId, conversationId, action: 'bot.ai_chat_started', metadata: { nodeId: node?.id ?? null, title: node?.title ?? 'Entrada directa' } },
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
    const bot = await this.getBot(tenantId, conversationId);
    const knowledgeBase = bot.aiKnowledgeBase?.trim();
    const hasKey = await this.ai.isConfigured(tenantId);

    if (!knowledgeBase || !hasKey) {
      return this.handoffAiNotConfigured(tenantId, conversationId, phone, account, bot.name, !knowledgeBase, !hasKey);
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

    const contactName = await this.getContactName(conversationId);

    // El gateway resuelve la clave, llama y deja registrado el consumo. Un fallo del
    // proveedor ya quedo logueado y medido ahi adentro; acá solo importa que no hay
    // respuesta para el cliente.
    const result = await this.ai.chat(tenantId, {
      feature: 'bot_ai_chat',
      messages: [{ role: 'system', content: this.buildAiSystemPrompt(knowledgeBase, contactName) }, ...chatMessages],
      maxTokens: 500,
      temperature: 0.6,
      conversationId,
    });
    if (!result.ok && (result.reason === 'NO_CREDITS' || result.reason === 'AI_DISABLED')) {
      return this.handoffAiNoCredits(tenantId, conversationId, phone, account, bot.name);
    }

    const reply = result.ok ? result.text : undefined;

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

  /**
   * El modo IA no tiene con qué responder. Antes se derivaba en silencio: el cliente
   * tocaba la opción y no recibía nada, y como no quedaba ni un log, desde afuera solo
   * se veía que "el bot no funciona". Ahora se le avisa que lo atiende una persona y
   * queda escrito qué falta configurar.
   */
  /**
   * Se acabaron los créditos de IA de la empresa.
   *
   * Al cliente final se le dice exactamente lo mismo que cuando el modo IA no está
   * configurado: él no es nuestro cliente, no sabe que existimos y no tiene nada que
   * ver con la cuenta de su proveedor. Quien tiene que enterarse es el admin del
   * tenant, por log hoy y por correo cuando estén las alertas.
   */
  private async handoffAiNoCredits(
    tenantId: string,
    conversationId: string,
    phone: string,
    account: WhatsAppAccountCreds,
    botName: string,
  ) {
    this.logger.warn(`Sin créditos de IA en el bot "${botName}" (tenant ${tenantId}). Se deriva a un agente.`);
    await this.sendText(tenantId, conversationId, phone, account, 'En este momento no puedo responderte por acá. Ya te paso con un agente.');
    return this.handoffToHuman(tenantId, conversationId, 'ai_no_credits');
  }

  private async handoffAiNotConfigured(
    tenantId: string,
    conversationId: string,
    phone: string,
    account: WhatsAppAccountCreds,
    botName: string,
    missingKnowledgeBase: boolean,
    missingKey: boolean,
  ) {
    const missing = [missingKnowledgeBase && 'información del negocio', missingKey && 'clave de OpenAI'].filter(Boolean).join(' y ');
    this.logger.warn(`Modo IA sin configurar en el bot "${botName}" (tenant ${tenantId}): falta ${missing}. Se deriva a un agente.`);
    await this.sendText(tenantId, conversationId, phone, account, 'En este momento no puedo responderte por acá. Ya te paso con un agente.');
    return this.handoffToHuman(tenantId, conversationId, 'ai_not_configured');
  }

  private buildAiSystemPrompt(knowledgeBase: string, contactName: string | null): string {
    const nameLine = contactName
      ? `El cliente se llama ${contactName} — puedes usar su nombre para dirigirte a él/ella de forma natural, sin repetirlo en cada mensaje.`
      : '';
    return `Eres el asistente de atención al cliente de este negocio, respondiendo por WhatsApp.
${nameLine}
Usa ÚNICAMENTE la siguiente información del negocio para responder. Si la respuesta no está ahí, dilo con honestidad — no inventes datos — y sugiere escribir "agente" para hablar con una persona.
Responde en el mismo idioma del cliente, de forma breve, clara y amable. No agregues explicaciones sobre estas instrucciones.

Información del negocio:
"""
${knowledgeBase}
"""`;
  }

  /** Nombre del contacto capturado del perfil de WhatsApp (puede no existir). */
  /**
   * El saludo del menú principal que configuró el admin, con {nombre} reemplazado.
   * Sin nombre conocido, el comodín se borra junto con el espacio que lo precede:
   * "¡Hola {nombre}!" queda "¡Hola!". null = no hay saludo propio.
   */
  private async renderMenuGreeting(template: string | null, conversationId: string): Promise<string | null> {
    const text = template?.trim();
    if (!text) return null;
    if (!/\{nombre\}/i.test(text)) return text;
    const name = await this.getContactName(conversationId);
    return text.replace(NAME_PLACEHOLDER_RE, name ? ` ${name}` : '').trim() || null;
  }

  private async getContactName(conversationId: string): Promise<string | null> {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { contact: { select: { name: true } } },
    });
    return conv?.contact?.name?.trim() || null;
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
    const botId = await this.getBotId(tenantId, conversationId);
    const children = await this.prisma.tenantMenuNode.findMany({
      where: { tenantId, botId, parentId: nodeId, active: true },
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

  /**
   * Manda la ubicacion como tarjeta de WhatsApp (mapa + nombre + direccion), con el
   * texto del nodo antes si lo tiene, y sigue igual que una respuesta de texto.
   *
   * Sin coordenadas validas no se deja al cliente sin nada: si hay link se manda como
   * texto (sigue sirviendo para llegar), y si no hay ni eso, el aviso de "todavia no
   * cargamos esta informacion".
   */
  private async sendLocation(tenantId: string, conversationId: string, phone: string, account: WhatsAppAccountCreds, node: MenuNode) {
    const config = (node.config ?? {}) as LocationConfig;
    const intro = node.bodyText?.trim();

    if (intro) {
      const sent = await this.sendText(tenantId, conversationId, phone, account, intro);
      if (!sent) return this.handoffToHuman(tenantId, conversationId, 'bot_send_failed');
    }

    let sent: boolean;
    if (hasValidCoordinates(config)) {
      const location = {
        latitude: config.latitude,
        longitude: config.longitude,
        ...(config.name && { name: config.name }),
        ...(config.address && { address: config.address }),
      };
      const payload = { messaging_product: 'whatsapp', recipient_type: 'individual', to: phone, type: 'location', location };
      const summary = `📍 ${[config.name, config.address].filter(Boolean).join(' — ') || node.title}`;
      sent = !!(await this.sendAndLog(tenantId, conversationId, account, payload, summary, {
        type: 'LOCATION',
        rawPayload: { location: { ...location, url: config.mapsUrl || mapsLinkFor(config.latitude, config.longitude) } },
      }));
    } else {
      this.logger.warn(`Nodo de ubicacion "${node.title}" (${node.id}) sin coordenadas validas (tenant ${tenantId}).`);
      const fallback = config.mapsUrl
        ? [config.name, config.address, config.mapsUrl].filter(Boolean).join('\n')
        : intro ? null : DEFAULT_CONFIG_TEXT;
      sent = fallback ? !!(await this.sendText(tenantId, conversationId, phone, account, fallback)) : true;
    }
    if (!sent) return this.handoffToHuman(tenantId, conversationId, 'bot_send_failed');

    await this.prisma.auditLog.create({
      data: { tenantId, conversationId, action: 'bot.node_selected', metadata: { nodeId: node.id, title: node.title, nodeType: node.type } },
    });
    return this.sendPostReplyPrompt(tenantId, conversationId, phone, account, node.parentId);
  }

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

  // ─── Reservar, cambiar o cancelar una cita ─────────────────────────────────

  /**
   * Dos caminos con las mismas pantallas (booking.ts):
   * - Reservar (nodo BOOK_APPOINTMENT): dia → (mañana o tarde) → hora → confirmar. La
   *   clinica es la linea a la que escribio y el doctor lo asigna la agenda, igual que
   *   cuando reserva la recepcion.
   * - Cambiar o cancelar una cita que ya existe, desde el boton "Reprogramar" del
   *   recordatorio (startPatientReschedule) o desde "Mis citas" (nodo MY_APPOINTMENTS),
   *   si la empresa lo permite. La cita viaja en botContext.bookingAppointmentId.
   */
  private async startBooking(tenantId: string, conversationId: string, phone: string, account: WhatsAppAccountCreds, node: MenuNode) {
    await this.setContext(conversationId, { bookingNodeId: node.id, bookingAppointmentId: null, bookingView: null, retryCount: 0 });
    return this.showBookingView(tenantId, conversationId, phone, account, { kind: 'days', offset: 0 });
  }

  /**
   * El paciente toco "Reprogramar" en el recordatorio y la empresa lo deja cambiar o
   * cancelar solo (lo decide el webhook con AgendaRepliesService.selfServiceAllowed).
   * Arranca en "¿Qué quieres hacer?", o directo en los dias si solo puede cambiar el
   * horario: toco "Reprogramar", ya dijo lo que quiere.
   */
  async startPatientReschedule(tenantId: string, conversationId: string, phone: string, appointmentId: string) {
    const account = await this.accounts.getForConversation(conversationId);
    if (!account) return this.handoffToHuman(tenantId, conversationId, 'whatsapp_account_unavailable');
    await this.setContext(conversationId, {
      nodeId: null,
      bookingNodeId: null,
      bookingAppointmentId: appointmentId,
      bookingView: null,
      retryCount: 0,
    });
    const settings = await this.agendaSettings.get(tenantId);
    const first: BookingScreen = settings.patientCanCancel ? { kind: 'manage' } : { kind: 'days', offset: 0 };
    return this.showBookingView(tenantId, conversationId, phone, account, first);
  }

  private async handleBookingReply(tenantId: string, conversationId: string, phone: string, msg: any, account: WhatsAppAccountCreds) {
    const { nodeId, bookingView } = await this.getContext(conversationId);

    // Escribir "agente" o "menú" sale del flujo, como en el resto del bot.
    const text = msg.type === 'text' ? msg.text?.body?.trim() || '' : '';
    if (text && text.split(/\s+/).length <= SHORT_MESSAGE_MAX_WORDS) {
      if (HUMAN_ESCAPE_RE.test(text)) return this.handoffToHuman(tenantId, conversationId, 'booking_escape');
      if (BACK_TO_MENU_RE.test(text)) {
        await this.resetRetryCount(conversationId);
        return this.enterNode(tenantId, conversationId, phone, nodeId, account);
      }
    }

    // No se interpretan fechas escritas a mano: se vuelve a mostrar la ultima pantalla.
    const view = parseViewId(this.extractReplyId(msg));
    if (!view) {
      const last = parseScreenId(bookingView) ?? { kind: 'days', offset: 0 };
      return this.trackUnrecognizedReply(tenantId, conversationId, phone, account, msg, () =>
        this.showBookingView(tenantId, conversationId, phone, account, last, 'No entendí tu respuesta. Elige una opción:'),
      );
    }

    await this.resetRetryCount(conversationId);
    switch (view.kind) {
      case 'menu':
        return this.enterNode(tenantId, conversationId, phone, nodeId, account);
      case 'book':
        return this.bookSlot(tenantId, conversationId, phone, account, view.date, view.minute);
      case 'cancelOk':
        return this.cancelAppointment(tenantId, conversationId, phone, account);
      case 'keep':
        return this.keepAppointment(tenantId, conversationId, phone, account);
      case 'human':
        await this.sendText(tenantId, conversationId, phone, account, BY_CLINIC_TEXT);
        return this.handoffToHuman(tenantId, conversationId, 'reschedule_by_clinic');
      case 'pick':
        return this.openAppointment(tenantId, conversationId, phone, account, view.appointmentId);
      case 'new':
        return this.startBookingFromMine(tenantId, conversationId, phone, account);
      default:
        return this.showBookingView(tenantId, conversationId, phone, account, view);
    }
  }

  /**
   * Lo que hace falta saber para reservar o cambiar la cita en esta conversacion, o por
   * que no se puede. Se arma en cada paso: si la recepcion ocupa un horario, cancela la
   * cita o el admin apaga algo mientras el paciente elige, el paso siguiente ya lo sabe.
   */
  private async bookingScope(tenantId: string, conversationId: string) {
    const settings = await this.agendaSettings.get(tenantId);
    if (!settings.enabled) return { ok: false as const, error: 'agenda_disabled' };
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        contactId: true,
        channelAccountId: true,
        contact: { select: { name: true } },
        channelAccount: { select: { label: true, displayName: true, businessName: true } },
      },
    });
    if (!conv) return { ok: false as const, error: 'no_line' };
    const { bookingAppointmentId } = await this.getContext(conversationId);
    const now = new Date();
    const base = {
      ok: true as const,
      settings,
      contactId: conv.contactId,
      contactName: conv.contact?.name?.trim() || null,
      today: toLocal(now, settings.timezone).date,
      notBefore: new Date(now.getTime() + settings.bookingMinNoticeMinutes * 60000),
    };

    if (!bookingAppointmentId) {
      if (!conv.channelAccountId || !conv.channelAccount) return { ok: false as const, error: 'no_line' };
      return { ...base, channelAccountId: conv.channelAccountId, clinic: clinicName(conv.channelAccount), minutes: settings.slotMinutes, change: null };
    }

    // Cambiar una cita: tiene que seguir abierta, ser de este paciente, la empresa lo
    // tiene que permitir y faltar mas que el limite. Si no, la atiende la clinica.
    const appt = await this.appointments.findOpenForPatient(tenantId, bookingAppointmentId);
    if (!appt || appt.contactId !== conv.contactId) return { ok: false as const, error: 'stale' };
    const { patientCanReschedule: canReschedule, patientCanCancel: canCancel } = settings;
    if (!canReschedule && !canCancel) return { ok: false as const, error: 'self_service_off' };
    if (appt.startsAt.getTime() - now.getTime() < settings.selfServiceCutoffHours * 3600_000) return { ok: false as const, error: 'too_late' };
    const start = toLocal(appt.startsAt, settings.timezone);
    return {
      ...base,
      channelAccountId: appt.channelAccountId,
      clinic: clinicName(appt.channelAccount),
      minutes: Math.round((appt.endsAt.getTime() - appt.startsAt.getTime()) / 60000),
      change: { appointmentId: appt.id, date: start.date, minute: start.minute, canReschedule, canCancel },
    };
  }

  /**
   * Los dias con horarios que se le ofrecen al paciente, desde `fromDate`. Al cambiar una
   * cita, la cita no se ocupa a si misma y su horario actual no se ofrece: elegirlo no
   * cambiaria nada.
   */
  private async offeredStarts(tenantId: string, scope: BookingScope, fromDate: string, days: number) {
    const { settings, change } = scope;
    const result = await this.availability.bookableStarts(
      tenantId,
      scope.channelAccountId,
      fromDate,
      days,
      scope.minutes,
      scope.notBefore,
      change?.appointmentId,
    );
    if (!change) return result;
    return result
      .map((d) => (d.date === change.date ? { ...d, starts: d.starts.filter((s) => s !== change.minute) } : d))
      .filter((d) => d.starts.length > 0 && d.date < addDays(scope.today, settings.bookingDaysAhead));
  }

  /** Los horarios libres de un dia, o ninguno si cae fuera de los dias que se ofrecen. */
  private async bookableStartsOf(tenantId: string, scope: BookingScope, date: string) {
    if (date < scope.today || date >= addDays(scope.today, scope.settings.bookingDaysAhead)) return [];
    const [day] = await this.offeredStarts(tenantId, scope, date, 1);
    return day?.starts ?? [];
  }

  /**
   * Muestra una pantalla. Cada una se valida contra la agenda de ahora: si lo que el
   * paciente toco ya no esta (dia lleno, horario ocupado), se le dice y se le muestra lo
   * que queda. `notice` va arriba del texto de la pantalla, en el mismo mensaje.
   */
  private async showBookingView(
    tenantId: string,
    conversationId: string,
    phone: string,
    account: WhatsAppAccountCreds,
    view: BookingScreen,
    notice?: string,
  ): Promise<unknown> {
    if (view.kind === 'mine') return this.showMyAppointments(tenantId, conversationId, phone, account, notice);
    const scope = await this.bookingScope(tenantId, conversationId);
    if (!scope.ok) return this.bookingUnavailable(tenantId, conversationId, phone, account, scope.error);
    const { change } = scope;
    const withNotice = (body: string) => (notice ? `${notice}\n\n${body}` : body);
    const fail = () => this.handoffToHuman(tenantId, conversationId, 'bot_send_failed');
    const show = (next: BookingScreen, nextNotice = notice) => this.showBookingView(tenantId, conversationId, phone, account, next, nextNotice);

    try {
      // ─── Cambiar o cancelar una cita que ya existe ───
      if (view.kind === 'manage' || view.kind === 'cancel') {
        if (!change) return show({ kind: 'days', offset: 0 });
        if (view.kind === 'cancel' && !change.canCancel) return show({ kind: 'manage' });
        const when = `${dayText(change.date)} a las ${hourText(change.minute)} en ${scope.clinic}`;
        // Los botones salen de lo que la empresa permite: cambiar (o, si no, hablar con
        // alguien de la clinica), cancelar si se puede, y siempre dejarla como esta.
        const options = [
          change.canReschedule
            ? { id: viewId({ kind: 'days', offset: 0 }), title: 'Cambiar horario' }
            : { id: viewId({ kind: 'human' }), title: 'Hablar con alguien' },
          ...(change.canCancel ? [{ id: viewId({ kind: 'cancel' }), title: 'Cancelar cita' }] : []),
          { id: viewId({ kind: 'keep' }), title: 'Dejarla así' },
        ];
        const sent =
          view.kind === 'manage'
            ? await this.sendButtons(tenantId, conversationId, phone, account, withNotice(`Tu cita es el ${when}. ¿Qué quieres hacer?`), options)
            : await this.sendButtons(tenantId, conversationId, phone, account, withNotice(`¿Seguro que quieres cancelar tu cita del ${when}?`), [
                { id: viewId({ kind: 'cancelOk' }), title: 'Sí, cancelarla' },
                { id: viewId({ kind: 'keep' }), title: 'No, mantenerla' },
              ]);
        if (!sent) return fail();
        return this.setBookingView(conversationId, view);
      }

      // Puede cancelar pero no cambiar el horario: no hay dias que mostrarle.
      if (change && !change.canReschedule) return show({ kind: 'manage' });

      if (view.kind === 'days') {
        const days = await this.offeredStarts(tenantId, scope, scope.today, scope.settings.bookingDaysAhead);
        if (days.length === 0) {
          this.logger.warn(`[booking] tenant ${tenantId}: sin horarios libres en ${scope.clinic} en ${scope.settings.bookingDaysAhead} dias`);
          const text = change
            ? `Por ahora no tenemos otros horarios libres para cambiar tu cita por aquí. ${BY_CLINIC_TEXT}`
            : `Por ahora no tenemos horarios libres para reservar por aquí. Ya te paso con alguien de ${scope.clinic} para buscarte un lugar.`;
          await this.sendText(tenantId, conversationId, phone, account, text);
          return this.handoffToHuman(tenantId, conversationId, change ? 'reschedule_no_slots' : 'booking_no_slots');
        }
        const offset = view.offset < days.length ? view.offset : 0;
        let body: string;
        let exit: Row | undefined;
        if (change) {
          body = `Tu cita es el ${dayText(change.date)} a las ${hourText(change.minute)}. ¿Qué día te queda mejor?`;
          exit = { id: viewId({ kind: 'manage' }), title: '‹ Volver' };
        } else {
          const { bookingNodeId } = await this.getContext(conversationId);
          const node = bookingNodeId ? await this.resolveNode(tenantId, bookingNodeId) : null;
          body = node?.bodyText?.trim() || `¿Qué día te queda bien para tu cita en ${scope.clinic}?`;
        }
        const rows = dayRows(days, scope.today, offset, exit);
        if (!(await this.sendList(tenantId, conversationId, phone, account, withNotice(body), 'Ver días', 'Días con lugar', rows))) return fail();
        return this.setBookingView(conversationId, { kind: 'days', offset });
      }

      const starts = await this.bookableStartsOf(tenantId, scope, view.date);
      if (starts.length === 0) {
        return show({ kind: 'days', offset: 0 }, `El ${dayText(view.date)} ya no tiene horarios libres.`);
      }

      if (view.kind === 'day') {
        if (!needsDayPart(starts)) return show({ kind: 'times', date: view.date, from: 0, to: 24 * 60 });
        const body = `El ${dayText(view.date)} tenemos ${starts.length} horarios libres. ¿Te queda mejor en la mañana o en la tarde?`;
        const sent = await this.sendButtons(tenantId, conversationId, phone, account, withNotice(body), [
          { id: viewId({ kind: 'times', date: view.date, from: 0, to: NOON }), title: 'En la mañana' },
          { id: viewId({ kind: 'times', date: view.date, from: NOON, to: 24 * 60 }), title: 'En la tarde' },
          { id: viewId({ kind: 'days', offset: 0 }), title: 'Otro día' },
        ]);
        if (!sent) return fail();
        return this.setBookingView(conversationId, view);
      }

      if (view.kind === 'times') {
        if (!starts.some((s) => s >= view.from && s < view.to)) {
          return show({ kind: 'day', date: view.date }, 'Ya no quedan horarios libres en esa parte del día.');
        }
        const part = view.from === 0 && view.to === NOON ? ' en la mañana' : view.from >= NOON ? ' en la tarde' : '';
        const body = `Horarios libres el ${dayText(view.date)}${part}:`;
        const rows = timeRows(view.date, starts, view.from, view.to);
        if (!(await this.sendList(tenantId, conversationId, phone, account, withNotice(body), 'Ver horarios', 'Horarios', rows))) return fail();
        return this.setBookingView(conversationId, view);
      }

      if (view.kind === 'ask') {
        if (!starts.includes(view.minute)) {
          return show({ kind: 'day', date: view.date }, 'Ese horario ya no está libre. Estos son los que quedan:');
        }
        const at = `el ${dayText(view.date)} a las ${hourText(view.minute)} en ${scope.clinic}`;
        const forWhom = scope.contactName ? `, a nombre de ${scope.contactName}` : '';
        const body = change ? `Te cambio la cita al ${dayText(view.date)} a las ${hourText(view.minute)} en ${scope.clinic}. ¿Confirmo?` : `Te reservo ${at}${forWhom}. ¿Confirmo?`;
        const sent = await this.sendButtons(tenantId, conversationId, phone, account, withNotice(body), [
          { id: viewId({ kind: 'book', date: view.date, minute: view.minute }), title: change ? 'Sí, cambiarla' : 'Sí, reservar' },
          { id: viewId({ kind: 'day', date: view.date }), title: 'Otro horario' },
        ]);
        if (!sent) return fail();
        return this.setBookingView(conversationId, view);
      }
    } catch (err) {
      return this.bookingFailed(tenantId, conversationId, phone, account, err);
    }
  }

  /**
   * "Mis citas": las proximas citas del paciente en la clinica de la linea.
   * - Ninguna: se le dice, y se le ofrece reservar si el bot tiene "Agendar cita".
   * - Una: se abre directo (openAppointment).
   * - Varias: elige cual de una lista.
   */
  private async showMyAppointments(tenantId: string, conversationId: string, phone: string, account: WhatsAppAccountCreds, notice?: string) {
    await this.setContext(conversationId, { bookingAppointmentId: null, bookingNodeId: null });
    const settings = await this.agendaSettings.get(tenantId);
    if (!settings.enabled) return this.bookingUnavailable(tenantId, conversationId, phone, account, 'agenda_disabled');
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { contactId: true, channelAccountId: true, botId: true, channelAccount: { select: { label: true, displayName: true, businessName: true } } },
    });
    if (!conv?.channelAccountId || !conv.channelAccount) return this.bookingUnavailable(tenantId, conversationId, phone, account, 'no_line');
    const clinic = clinicName(conv.channelAccount);
    const withNotice = (body: string) => (notice ? `${notice}\n\n${body}` : body);

    const appointments = await this.prisma.appointment.findMany({
      where: {
        tenantId,
        contactId: conv.contactId,
        channelAccountId: conv.channelAccountId,
        status: { in: ['SCHEDULED', 'CONFIRMED'] },
        startsAt: { gt: new Date() },
      },
      orderBy: { startsAt: 'asc' },
      take: 9,
      select: { id: true, startsAt: true },
    });

    if (appointments.length === 0) {
      const bookingNode = conv.botId
        ? await this.prisma.tenantMenuNode.findFirst({ where: { tenantId, botId: conv.botId, type: 'BOOK_APPOINTMENT', active: true }, select: { id: true } })
        : null;
      const text = `No tienes citas agendadas en ${clinic}.`;
      if (!bookingNode) {
        if (!(await this.sendText(tenantId, conversationId, phone, account, withNotice(text)))) return this.handoffToHuman(tenantId, conversationId, 'bot_send_failed');
        const { nodeId } = await this.getContext(conversationId);
        return this.sendPostReplyPrompt(tenantId, conversationId, phone, account, nodeId);
      }
      const sent = await this.sendButtons(tenantId, conversationId, phone, account, withNotice(`${text} ¿Quieres agendar una?`), [
        { id: viewId({ kind: 'new' }), title: 'Agendar cita' },
        { id: viewId({ kind: 'menu' }), title: 'Volver al menú' },
      ]);
      if (!sent) return this.handoffToHuman(tenantId, conversationId, 'bot_send_failed');
      return this.setBookingView(conversationId, { kind: 'mine' });
    }

    if (appointments.length === 1 && !notice) return this.openAppointment(tenantId, conversationId, phone, account, appointments[0].id);

    const rows: Row[] = appointments.map((a) => {
      const start = toLocal(a.startsAt, settings.timezone);
      return { id: viewId({ kind: 'pick', appointmentId: a.id }), title: appointmentTitle(start.date, start.minute) };
    });
    rows.push({ id: viewId({ kind: 'menu' }), title: '‹ Volver' });
    const body = appointments.length === 1 ? `Tienes una cita en ${clinic}:` : `Tienes ${appointments.length} citas en ${clinic}. ¿Cuál quieres ver?`;
    if (!(await this.sendList(tenantId, conversationId, phone, account, withNotice(body), 'Ver citas', 'Mis citas', rows))) {
      return this.handoffToHuman(tenantId, conversationId, 'bot_send_failed');
    }
    return this.setBookingView(conversationId, { kind: 'mine' });
  }

  /**
   * Una cita elegida en "Mis citas". Si la empresa deja cambiarla o cancelarla y falta mas
   * que el limite, "¿Qué quieres hacer?". Si no, solo se le muestra: ver sus citas es
   * util aunque no pueda tocarlas, y "¿Necesitas algo más?" le deja hablar con alguien.
   */
  private async openAppointment(tenantId: string, conversationId: string, phone: string, account: WhatsAppAccountCreds, appointmentId: string) {
    const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId }, select: { contactId: true } });
    const appt = await this.appointments.findOpenForPatient(tenantId, appointmentId);
    if (!appt || appt.contactId !== conv?.contactId) {
      return this.showBookingView(tenantId, conversationId, phone, account, { kind: 'mine' }, 'Esa cita ya no está vigente.');
    }
    const settings = await this.agendaSettings.get(tenantId);
    const selfService = settings.patientCanReschedule || settings.patientCanCancel;
    const tooLate = appt.startsAt.getTime() - Date.now() < settings.selfServiceCutoffHours * 3600_000;
    if (settings.enabled && selfService && !tooLate) {
      await this.setContext(conversationId, { bookingAppointmentId: appt.id });
      return this.showBookingView(tenantId, conversationId, phone, account, { kind: 'manage' });
    }

    const start = toLocal(appt.startsAt, settings.timezone);
    const late = selfService && tooLate ? ' Como falta poco, si necesitas cambiarla te comunico con alguien de la clínica.' : '';
    const text = `Tu cita es el ${dayText(start.date)} a las ${hourText(start.minute)} en ${clinicName(appt.channelAccount)}.${late}`;
    if (!(await this.sendText(tenantId, conversationId, phone, account, text))) return this.handoffToHuman(tenantId, conversationId, 'bot_send_failed');
    const { nodeId } = await this.getContext(conversationId);
    return this.sendPostReplyPrompt(tenantId, conversationId, phone, account, nodeId);
  }

  /** "Agendar cita" desde "Mis citas" sin citas: la reserva con el nodo de reserva del bot. */
  private async startBookingFromMine(tenantId: string, conversationId: string, phone: string, account: WhatsAppAccountCreds) {
    const botId = await this.getBotId(tenantId, conversationId);
    const node = await this.prisma.tenantMenuNode.findFirst({ where: { tenantId, botId, type: 'BOOK_APPOINTMENT', active: true } });
    if (!node) {
      const { nodeId } = await this.getContext(conversationId);
      return this.enterNode(tenantId, conversationId, phone, nodeId, account);
    }
    return this.startBooking(tenantId, conversationId, phone, account, node);
  }

  /**
   * Dos toques seguidos en un boton que hace algo ("Sí, reservar", "Sí, cancelarla")
   * llegan como dos mensajes casi a la vez, y serian dos citas o dos cancelaciones. Sigue
   * solo el que saca a la conversacion del paso en que estaba; el otro no hace nada. Cada
   * salida de quien lo gana vuelve a fijar el estado que corresponde.
   */
  private async claimBookingStep(conversationId: string) {
    const claimed = await this.prisma.conversation.updateMany({
      where: { id: conversationId, botState: 'AWAITING_BOOKING' },
      data: { botState: 'MENU' },
    });
    return claimed.count > 0;
  }

  /** Reserva el horario, o lo cambia si la conversacion esta cambiando una cita que ya existe. */
  private async bookSlot(tenantId: string, conversationId: string, phone: string, account: WhatsAppAccountCreds, date: string, minute: number) {
    const scope = await this.bookingScope(tenantId, conversationId);
    if (!scope.ok) return this.bookingUnavailable(tenantId, conversationId, phone, account, scope.error);
    if (!(await this.claimBookingStep(conversationId))) return;
    const taken = 'Ese horario se acaba de ocupar. Estos son los que quedan:';
    const { change } = scope;

    let appointmentId: string;
    try {
      if (change && !change.canReschedule) return this.showBookingView(tenantId, conversationId, phone, account, { kind: 'manage' });
      // Se revalida contra lo que se ofrece (anticipacion minima, dias hacia adelante),
      // no solo contra la agenda: el boton puede ser de una conversacion de ayer.
      const starts = await this.bookableStartsOf(tenantId, scope, date);
      if (!starts.includes(minute)) return this.showBookingView(tenantId, conversationId, phone, account, { kind: 'day', date }, taken);

      const startsAt = fromLocal(date, minute, scope.settings.timezone);
      const appt = change
        ? await this.appointments.rescheduleForPatient({ tenantId, appointmentId: change.appointmentId, startsAt, conversationId })
        : await this.appointments.createForPatient({ tenantId, channelAccountId: scope.channelAccountId, contactId: scope.contactId, startsAt, conversationId });
      appointmentId = appt.id;
    } catch (err) {
      // 409: otra recepcion o paciente lo tomo entre que se mostro y se confirmo.
      if (err instanceof HttpException && err.getStatus() === 409) {
        return this.showBookingView(tenantId, conversationId, phone, account, { kind: 'day', date }, taken);
      }
      return this.bookingFailed(tenantId, conversationId, phone, account, err);
    }

    const reminder = scope.settings.reminderTemplateId ? ' Antes de la cita te enviamos un recordatorio.' : '';
    const at = `el ${dayText(date)} a las ${hourText(minute)} en ${scope.clinic}`;
    const messageId = await this.sendText(
      tenantId,
      conversationId,
      phone,
      account,
      change ? `¡Listo! Cambiamos tu cita para ${at}.${reminder}` : `¡Listo! Tu cita quedó para ${at}.${reminder}`,
    );
    if (!messageId) {
      // La cita ya esta tomada; lo que falta es que el paciente se entere. Sin la marca,
      // el worker de avisos le manda la confirmacion por plantilla.
      await this.appointments.releaseConfirmation(tenantId, appointmentId);
      return this.handoffToHuman(tenantId, conversationId, 'bot_send_failed');
    }
    await this.appointments.markConfirmationMessage(tenantId, appointmentId, messageId);
    return this.finishBooking(tenantId, conversationId, phone, account);
  }

  private async cancelAppointment(tenantId: string, conversationId: string, phone: string, account: WhatsAppAccountCreds) {
    const scope = await this.bookingScope(tenantId, conversationId);
    if (!scope.ok) return this.bookingUnavailable(tenantId, conversationId, phone, account, scope.error);
    const { change } = scope;
    if (!change?.canCancel) return this.showBookingView(tenantId, conversationId, phone, account, { kind: 'manage' });
    if (!(await this.claimBookingStep(conversationId))) return;

    const cancelled = await this.appointments.cancelForPatient({ tenantId, appointmentId: change.appointmentId, conversationId });
    if (!cancelled) return this.bookingUnavailable(tenantId, conversationId, phone, account, 'stale');
    const when = `${dayText(change.date)} a las ${hourText(change.minute)} en ${scope.clinic}`;
    await this.sendText(tenantId, conversationId, phone, account, `Listo, cancelamos tu cita del ${when}. Si quieres agendar otra, escríbenos por aquí.`);
    return this.finishBooking(tenantId, conversationId, phone, account);
  }

  private async keepAppointment(tenantId: string, conversationId: string, phone: string, account: WhatsAppAccountCreds) {
    const scope = await this.bookingScope(tenantId, conversationId);
    if (!scope.ok) return this.bookingUnavailable(tenantId, conversationId, phone, account, scope.error);
    const { change } = scope;
    if (!change) return this.showBookingView(tenantId, conversationId, phone, account, { kind: 'days', offset: 0 });
    if (!(await this.claimBookingStep(conversationId))) return;

    await this.appointments.clearRescheduleRequest(tenantId, change.appointmentId);
    const when = `${dayText(change.date)} a las ${hourText(change.minute)} en ${scope.clinic}`;
    await this.sendText(tenantId, conversationId, phone, account, `Perfecto, tu cita sigue el ${when}.`);
    return this.finishBooking(tenantId, conversationId, phone, account);
  }

  /** Termino la reserva o el cambio: se limpia el contexto y sigue "¿Necesitas algo más?". */
  private async finishBooking(tenantId: string, conversationId: string, phone: string, account: WhatsAppAccountCreds) {
    await this.setContext(conversationId, { bookingNodeId: null, bookingAppointmentId: null, bookingView: null });
    const { nodeId } = await this.getContext(conversationId);
    return this.sendPostReplyPrompt(tenantId, conversationId, phone, account, nodeId);
  }

  private async setBookingView(conversationId: string, view: BookingScreen) {
    await this.setContext(conversationId, { bookingView: viewId(view) });
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { botState: 'AWAITING_BOOKING' } });
  }

  /**
   * No se puede seguir por el bot: la agenda esta apagada, la conversacion no tiene linea,
   * o (al cambiar una cita) la cita ya no esta vigente, la empresa apago el autoservicio o
   * falta menos que el limite. Se le avisa al paciente y lo atiende la clinica.
   */
  private async bookingUnavailable(tenantId: string, conversationId: string, phone: string, account: WhatsAppAccountCreds, reason: string) {
    this.logger.warn(`[booking] tenant ${tenantId}: no se puede seguir por el bot (${reason})`);
    const text =
      reason === 'stale'
        ? `Esa cita ya no está vigente. ${BY_CLINIC_TEXT}`
        : reason === 'too_late' || reason === 'self_service_off'
          ? BY_CLINIC_TEXT
          : 'En este momento no puedo agendar citas por aquí. Ya te paso con alguien de la clínica para ayudarte.';
    await this.sendText(tenantId, conversationId, phone, account, text);
    return this.handoffToHuman(tenantId, conversationId, `booking_${reason}`);
  }

  private async bookingFailed(tenantId: string, conversationId: string, phone: string, account: WhatsAppAccountCreds, err: unknown) {
    this.logger.error(`[booking] tenant ${tenantId}: fallo la reserva`, (err as any)?.stack || err);
    await this.sendText(tenantId, conversationId, phone, account, 'Perdón, tuve un problema con tu cita. Ya te paso con alguien de la clínica.');
    return this.handoffToHuman(tenantId, conversationId, 'booking_error');
  }

  // ─── Consultar orden (sin cambios respecto al árbol configurable) ──────────

  private async askOrderNumber(
    tenantId: string,
    conversationId: string,
    phone: string,
    account: WhatsAppAccountCreds,
    node: MenuNode,
  ) {
    // El prompt lo escribe el admin en el nodo: este tipo de nodo ya no es solo
    // "numero de orden", sirve igual para un expediente o una factura.
    const prompt = node.promptText?.trim() || 'Dime el número de tu orden y en un momento te ayudamos.';
    const sent = await this.sendText(tenantId, conversationId, phone, account, prompt);
    if (!sent) {
      return this.handoffToHuman(tenantId, conversationId, 'bot_send_failed');
    }
    await this.setContext(conversationId, { lookupNodeId: node.id, retryCount: 0 });
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { botState: 'AWAITING_ORDER_NUMBER' } });
  }

  private async handleOrderNumberReply(
    tenantId: string,
    conversationId: string,
    phone: string,
    msg: any,
    account: WhatsAppAccountCreds,
  ) {
    const orderNumber = msg.text?.body?.trim() || '';
    const { lookupNodeId } = await this.getContext(conversationId);
    const node = lookupNodeId ? await this.resolveNode(tenantId, lookupNodeId) : null;
    const config = (node?.config ?? null) as LookupConfig | null;

    await this.prisma.auditLog.create({
      data: {
        tenantId,
        conversationId,
        action: 'conversation.order_lookup_requested',
        metadata: { orderNumber: orderNumber || '(no informado)', nodeId: lookupNodeId },
      },
    });

    // Sin URL o sin plantilla el nodo no puede responder solo — es el comportamiento
    // que tenia siempre, ahora acotado al caso de un nodo sin configurar.
    if (!config || !this.lookup.isConfigured(config)) {
      await this.sendText(
        tenantId,
        conversationId,
        phone,
        account,
        'Por ahora no puedo consultar eso automáticamente. Ya te paso con un agente que te va a ayudar con el dato que me pasaste.',
      );
      return this.handoffToHuman(tenantId, conversationId, 'order_lookup_not_configured');
    }

    if (!orderNumber) {
      return this.trackUnrecognizedReply(tenantId, conversationId, phone, account, msg, async () => {
        await this.sendText(tenantId, conversationId, phone, account, 'No entendí. Escribime solo el número, por favor.');
      });
    }

    const result = await this.lookup.run(config, orderNumber);

    // Cae el sistema externo o tarda: no se le muestra el error tecnico al cliente,
    // se lo pasa a un humano que puede resolverlo igual.
    if (!result.ok) {
      await this.prisma.auditLog.create({
        data: {
          tenantId,
          conversationId,
          action: 'conversation.order_lookup_failed',
          metadata: { orderNumber, error: result.error, status: result.status },
        },
      });
      await this.sendText(
        tenantId,
        conversationId,
        phone,
        account,
        'No pude consultar el sistema en este momento. Ya te paso con un agente para que te ayude.',
      );
      return this.handoffToHuman(tenantId, conversationId, 'order_lookup_error');
    }

    // No existe: se deja reintentar (puede haberse equivocado tipeando) hasta el tope
    // de reintentos, que ya deriva a un humano solo.
    if (result.notFound) {
      await this.prisma.auditLog.create({
        data: { tenantId, conversationId, action: 'conversation.order_lookup_not_found', metadata: { orderNumber } },
      });
      return this.trackUnrecognizedReply(tenantId, conversationId, phone, account, msg, async () => {
        await this.sendText(tenantId, conversationId, phone, account, this.lookup.renderNotFound(config, orderNumber));
      });
    }

    const sent = await this.sendText(tenantId, conversationId, phone, account, result.rendered || '');
    if (!sent) {
      return this.handoffToHuman(tenantId, conversationId, 'bot_send_failed');
    }

    await this.prisma.auditLog.create({
      data: { tenantId, conversationId, action: 'conversation.order_lookup_resolved', metadata: { orderNumber } },
    });

    // Sigue el flujo normal ("¿necesitas algo más?"), igual que una hoja de texto:
    // la consulta resuelta no tiene por que cortar la conversacion.
    await this.resetRetryCount(conversationId);
    return this.sendPostReplyPrompt(tenantId, conversationId, phone, account, node?.parentId ?? null);
  }

  // ─── Handoff a humano (idempotente) ────────────────────────────────────────

  private async handoffToHuman(tenantId: string, conversationId: string, reason: string) {
    await this.prisma.auditLog.create({
      data: { tenantId, conversationId, action: 'bot.handoff_requested', metadata: { reason } },
    });

    // El reparto automatico tiene que respetar los permisos por linea igual que el
    // manual: si no, el cliente que escribe a una sucursal cae en manos de alguien que
    // no puede ver esa linea, y la conversacion queda asignada y sin nadie mirandola.
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { channelAccountId: true },
    });
    const assignedUserId = await this.assignmentService.findLeastBusyAgent(
      tenantId,
      conv?.channelAccountId ?? null,
    );

    // Guard atómico: si dos disparadores de handoff casi simultáneos (ej: falla de
    // envío + el cliente tocando "hablar con un agente" a la vez) llegan acá, solo
    // el primero en commitear gana — el segundo ve count 0 y no duplica nada.
    const updated = await this.prisma.conversation.updateMany({
      where: { id: conversationId, mode: 'BOT' },
      data: {
        mode: 'AGENT',
        botState: null,
        assignedUserId,
        // Le cae en la bandeja sin que nadie se lo diga: se marca igual que un traspaso
        // hecho a mano, o el agente no tiene forma de notar que le llego.
        ...(assignedUserId ? { assignedAt: new Date(), assignedSeenAt: null } : {}),
      },
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
    return {
      nodeId: ctx.nodeId ?? null,
      lookupNodeId: ctx.lookupNodeId ?? null,
      retryCount: ctx.retryCount ?? 0,
      aiSince: ctx.aiSince ?? null,
      bookingNodeId: ctx.bookingNodeId ?? null,
      bookingView: ctx.bookingView ?? null,
      bookingAppointmentId: ctx.bookingAppointmentId ?? null,
    };
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

  /**
   * Bot de la conversación. Se fija al crearla (webhook); si quedó en null — porque
   * borraron el bot a mitad de camino (FK SET NULL) — se sigue con el predeterminado
   * y se deja anotado, para que el resto de la conversación no cambie de bot otra vez.
   */
  private async getBot(tenantId: string, conversationId: string) {
    const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId }, select: { bot: true } });
    if (conv?.bot) return conv.bot;
    const fallback = await this.bots.getDefault(tenantId);
    await this.prisma.conversation.update({ where: { id: conversationId }, data: { botId: fallback.id } });
    return fallback;
  }

  private async getBotId(tenantId: string, conversationId: string): Promise<string> {
    const conv = await this.prisma.conversation.findUnique({ where: { id: conversationId }, select: { botId: true } });
    return conv?.botId ?? (await this.getBot(tenantId, conversationId)).id;
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

  private async sendText(
    tenantId: string,
    conversationId: string,
    phone: string,
    account: WhatsAppAccountCreds,
    body: string,
  ): Promise<string | null> {
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
  ): Promise<string | null> {
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

  private async sendList(
    tenantId: string,
    conversationId: string,
    phone: string,
    account: WhatsAppAccountCreds,
    bodyText: string,
    button: string,
    sectionTitle: string,
    rows: Row[],
  ): Promise<string | null> {
    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: phone,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text: bodyText },
        action: {
          button: button.slice(0, 20),
          sections: [
            {
              title: sectionTitle.slice(0, 24),
              rows: rows.map((r) => ({ id: r.id, title: r.title.slice(0, 24), ...(r.description && { description: r.description.slice(0, 72) }) })),
            },
          ],
        },
      },
    };
    const summary = `[${bodyText}] ${rows.map((r) => r.title).join(' · ')}`;
    return this.sendAndLog(tenantId, conversationId, account, payload, summary);
  }

  /**
   * El id del Message guardado si salió, o null si no — los llamadores usan esto para
   * derivar a un humano en vez de quedarse callados.
   */
  private async sendAndLog(
    tenantId: string,
    conversationId: string,
    account: WhatsAppAccountCreds,
    payload: any,
    bodyForHistory: string,
    /** Para lo que no es texto (hoy, la ubicacion): el tipo y lo que la bandeja necesita para dibujarlo. */
    extra: { type?: 'TEXT' | 'LOCATION'; rawPayload?: Prisma.InputJsonValue } = {},
  ): Promise<string | null> {
    let externalId: string | undefined;
    try {
      const url = `https://graph.facebook.com/${this.apiVersion}/${account.phoneNumberId}/messages`;
      const { data } = await axios.post(url, payload, {
        headers: { Authorization: `Bearer ${account.accessToken}`, 'Content-Type': 'application/json' },
      });
      externalId = data?.messages?.[0]?.id;
    } catch (err) {
      this.logger.error('Failed to send bot message', err?.response?.data || err?.message);
      return null;
    }

    const now = new Date();
    const [message] = await Promise.all([
      this.prisma.message.create({
        data: {
          tenantId,
          conversationId,
          direction: 'OUTBOUND',
          type: extra.type ?? 'TEXT',
          body: bodyForHistory,
          status: 'SENT',
          externalId,
          ...(extra.rawPayload !== undefined && { rawPayload: extra.rawPayload }),
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

    return message.id;
  }
}
