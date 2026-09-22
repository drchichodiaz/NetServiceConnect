import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ContactIdentityService, displayId } from '../contacts/contact-identity.service';
import { ChannelAccessService } from '../common/services/channel-access.service';
import { EventBusService } from '../events/event-bus.service';
import { MediaService } from '../media/media.service';
import { TemplatesService } from '../templates/templates.service';
import { buildSendComponents, TemplateButton } from '../templates/template-components';
import { WhatsAppAccountsService } from './accounts.service';
import { SendMessageDto } from './dto/send-message.dto';
import { SendMediaDto } from './dto/send-media.dto';
import { StartConversationDto } from './dto/start-conversation.dto';
import axios from 'axios';
// form-data es un modulo CommonJS puro (module.exports = FormData) y este proyecto
// no tiene esModuleInterop activado, asi que un default-import ("import FormData from...")
// compila mal (form_data_1.default is undefined). El import de namespace si funciona.
import * as FormData from 'form-data';

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly apiVersion: string;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    private eventBus: EventBusService,
    private mediaService: MediaService,
    private templatesService: TemplatesService,
    private accounts: WhatsAppAccountsService,
    private identities: ContactIdentityService,
    private channelAccess: ChannelAccessService,
  ) {
    this.apiVersion = config.get('META_API_VERSION') || 'v19.0';
  }

  async sendMessage(tenantId: string, senderId: string, dto: SendMessageDto) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: dto.conversationId, tenantId },
    });

    if (!conversation) throw new NotFoundException('Conversation not found');

    // La respuesta sale SIEMPRE por la línea por la que entró la conversación —
    // si no, el cliente que escribió a una sucursal recibiría la respuesta desde
    // el número de otra.
    const account = await this.accounts.getForConversation(conversation.id);
    if (!account) {
      throw new BadRequestException('No active WhatsApp account found for this tenant');
    }

    await this.assertCanSend(senderId, conversation);

    await this.takeOverFromBot(tenantId, conversation, senderId);

    const payload = this.buildPayload(await this.recipientFor(conversation.contactId), dto);
    let externalId: string | undefined;

    try {
      const url = `https://graph.facebook.com/${this.apiVersion}/${account.phoneNumberId}/messages`;
      const { data } = await axios.post(url, payload, {
        headers: {
          Authorization: `Bearer ${account.accessToken}`,
          'Content-Type': 'application/json',
        },
      });
      externalId = data?.messages?.[0]?.id;
    } catch (err) {
      this.logger.error('Failed to send WhatsApp message', err?.response?.data);
      throw new BadRequestException(
        err?.response?.data?.error?.message || 'Failed to send message',
      );
    }

    const now = new Date();
    const body = dto.body || dto.mediaUrl || '';

    const [message] = await Promise.all([
      this.prisma.message.create({
        data: {
          tenantId,
          conversationId: dto.conversationId,
          senderId,
          direction: 'OUTBOUND',
          type: dto.type.toUpperCase() as any,
          body,
          mediaUrl: dto.mediaUrl,
          mediaType: dto.mediaType,
          status: externalId ? 'SENT' : 'FAILED',
          externalId,
        },
      }),
      this.prisma.conversation.update({
        where: { id: dto.conversationId },
        data: { lastMessageAt: now, lastMessageText: body, unreadCount: 0 },
      }),
    ]);

    // Notificar a otros agentes conectados (ej: misma conversación en otra pestaña)
    this.eventBus.publish({
      type: 'new_message',
      tenantId,
      payload: {
        message,
        conversationId: dto.conversationId,
        lastMessageText: body,
        lastMessageAt: now.toISOString(),
      },
    });

    return message;
  }

  /** Envia un archivo adjunto (imagen/audio/documento/video) subido por un agente desde el inbox. */
  async sendMediaMessage(tenantId: string, senderId: string, dto: SendMediaDto, file: Express.Multer.File) {
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: dto.conversationId, tenantId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');

    const account = await this.accounts.getForConversation(conversation.id);
    if (!account) {
      throw new BadRequestException('No active WhatsApp account found for this tenant');
    }

    await this.assertCanSend(senderId, conversation);

    await this.takeOverFromBot(tenantId, conversation, senderId);

    // 1. Subir el archivo a Meta para obtener un media id reutilizable en el mensaje
    const metaMediaId = await this.uploadMediaToMeta(account.phoneNumberId, account.accessToken, file);

    // 2. Guardar una copia local (mismo id que Meta) para poder mostrarla despues en el inbox
    const relativePath = await this.mediaService.storeFile(tenantId, metaMediaId, file.buffer, file.mimetype);

    // 3. Enviar el mensaje referenciando el media ya subido
    const mediaPayload: any = { id: metaMediaId };
    if (dto.caption) mediaPayload.caption = dto.caption;
    if (dto.type === 'document') mediaPayload.filename = file.originalname;

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: await this.recipientFor(conversation.contactId),
      type: dto.type,
      [dto.type]: mediaPayload,
    };

    let externalId: string | undefined;
    try {
      const url = `https://graph.facebook.com/${this.apiVersion}/${account.phoneNumberId}/messages`;
      const { data } = await axios.post(url, payload, {
        headers: {
          Authorization: `Bearer ${account.accessToken}`,
          'Content-Type': 'application/json',
        },
      });
      externalId = data?.messages?.[0]?.id;
    } catch (err) {
      this.logger.error('Failed to send WhatsApp media message', err?.response?.data);
      throw new BadRequestException(
        err?.response?.data?.error?.message || 'Failed to send media message',
      );
    }

    const now = new Date();
    const body = dto.caption || '';
    const lastMessageText = body || `[${dto.type}]`;

    const [message] = await Promise.all([
      this.prisma.message.create({
        data: {
          tenantId,
          conversationId: dto.conversationId,
          senderId,
          direction: 'OUTBOUND',
          type: dto.type.toUpperCase() as any,
          body,
          mediaUrl: relativePath,
          mediaType: dto.type,
          mediaMimeType: file.mimetype,
          status: externalId ? 'SENT' : 'FAILED',
          externalId,
        },
      }),
      this.prisma.conversation.update({
        where: { id: dto.conversationId },
        data: { lastMessageAt: now, lastMessageText, unreadCount: 0 },
      }),
    ]);

    this.eventBus.publish({
      type: 'new_message',
      tenantId,
      payload: {
        message,
        conversationId: dto.conversationId,
        lastMessageText,
        lastMessageAt: now.toISOString(),
      },
    });

    return message;
  }

  /**
   * Inicia una conversacion con un contacto nuevo o existente usando una plantilla
   * aprobada — necesario porque WhatsApp no permite texto libre fuera de la ventana
   * de 24hs de servicio al cliente. Quien la inicia queda asignado como agente.
   */
  async startConversation(tenantId: string, senderId: string, dto: StartConversationDto) {
    // Acá no hay conversación de la cual deducir la línea, así que la elige el agente
    // (o se usa la línea por defecto del tenant).
    const account = dto.channelAccountId
      ? await this.accounts.findActiveCredsOrThrow(tenantId, dto.channelAccountId)
      : await this.accounts.getDefault(tenantId);
    if (!account) {
      this.logger.warn(`[Envio bloqueado] Tenant ${tenantId} no tiene ninguna línea de WhatsApp activa`);
      throw new BadRequestException('No hay ninguna línea de WhatsApp activa en esta empresa');
    }

    // Deja constancia de cada intento ANTES de que pueda fallar: sin esto, un envio
    // rechazado por nuestras propias validaciones no aparecia en el log y era
    // indistinguible de "nunca se intento".
    this.logger.log(
      `[start-conversation] tenant=${tenantId} linea=${account.phoneNumberId} waba=${account.wabaId} plantilla=${dto.templateId}`,
    );

    // El WABA de la línea que envía: una plantilla de otro WABA no existe para este número.
    const template = await this.templatesService.findApprovedOrThrow(tenantId, dto.templateId, account.wabaId);

    let contact: { id: string; name: string | null; phone: string | null };
    if (dto.contactId) {
      const found = await this.prisma.contact.findFirst({ where: { id: dto.contactId, tenantId } });
      if (!found) throw new NotFoundException('Contact not found');
      contact = found;
    } else {
      if (!dto.phone) throw new BadRequestException('phone is required to create a new contact');
      contact = await this.identities.resolve(tenantId, 'WHATSAPP', dto.phone, { name: dto.name });
    }

    // El destinatario sale de la identidad de WhatsApp del contacto, no de su columna
    // phone: un contacto que llego por Instagram no tiene numero, y a uno que tiene
    // ficha cargada a mano puede faltarle la identidad.
    const recipient = await this.identities.findExternalId(contact.id, 'WHATSAPP');
    if (!recipient) {
      throw new BadRequestException('Ese contacto no tiene un número de WhatsApp');
    }

    // Misma regla que el webhook: la identidad de un hilo es (contacto, línea).
    let conversation = await this.prisma.conversation.findFirst({
      where: { tenantId, contactId: contact.id, channelAccountId: account.id, status: { not: 'CLOSED' } },
      orderBy: { createdAt: 'desc' },
    });

    const now = new Date();
    const variables = dto.variables ?? [];
    // Lo que se guarda en la bandeja es lo que el cliente ve: encabezado de texto,
    // cuerpo y pie. Si solo se guardara el cuerpo, el agente abriria la conversacion
    // y leeria algo distinto de lo que se mando.
    const renderedBody = this.renderTemplateText(template, variables, dto.headerVariables ?? []);

    if (!conversation) {
      conversation = await this.prisma.conversation.create({
        data: {
          tenantId,
          contactId: contact.id,
          channelAccountId: account.id,
          status: 'OPEN',
          assignedUserId: senderId,
          lastMessageAt: now,
          lastMessageText: renderedBody,
          unreadCount: 0,
        },
      });

      await this.prisma.auditLog.create({
        data: { tenantId, userId: senderId, conversationId: conversation.id, action: 'conversation.started' },
      });
    }

    // La imagen del encabezado se manda por media id, no por URL: el id es por linea
    // y se cachea, asi que un segundo envio por la misma linea no vuelve a subirla.
    const headerMediaId =
      template.headerFormat === 'IMAGE'
        ? await this.resolveHeaderMediaId(template, account)
        : undefined;

    const components = buildSendComponents(
      {
        headerFormat: template.headerFormat,
        headerText: template.headerText,
        bodyText: template.bodyText,
        buttons: template.buttons as unknown as TemplateButton[] | null,
      },
      {
        body: variables,
        header: dto.headerVariables ?? [],
        buttons: dto.buttonVariables ?? [],
      },
      headerMediaId,
    );

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipient,
      type: 'template',
      template: {
        name: template.name,
        language: { code: template.language },
        ...(components.length > 0 && { components }),
      },
    };

    let externalId: string | undefined;
    try {
      const url = `https://graph.facebook.com/${this.apiVersion}/${account.phoneNumberId}/messages`;
      const { data } = await axios.post(url, payload, {
        headers: { Authorization: `Bearer ${account.accessToken}`, 'Content-Type': 'application/json' },
      });
      externalId = data?.messages?.[0]?.id;
    } catch (err) {
      this.logger.error('Failed to send template message', err?.response?.data);
      const metaError = err?.response?.data?.error;
      // 132001: Meta no encontró la plantilla con ese nombre + idioma para el WABA de
      // este número. El texto crudo ("template name does not exist in the translation")
      // no dice cuál de las dos cosas falló, así que se explica acá.
      if (metaError?.code === 132001) {
        throw new BadRequestException(
          `Meta no encontró la plantilla "${template.name}" en el idioma "${template.language}" para esta línea. ` +
            'Verificá que el idioma sea exactamente el aprobado en Meta (es, es_AR, en_US… no son intercambiables) ' +
            'y que la plantilla exista en la cuenta de WhatsApp Business de esta línea.',
        );
      }
      throw new BadRequestException(metaError?.message || 'Failed to send template message');
    }

    const [message] = await Promise.all([
      this.prisma.message.create({
        data: {
          tenantId,
          conversationId: conversation.id,
          senderId,
          direction: 'OUTBOUND',
          type: 'TEMPLATE',
          body: renderedBody,
          status: externalId ? 'SENT' : 'FAILED',
          externalId,
          // Se apunta a la copia local de la imagen del encabezado (la misma que la
          // vista previa), para que la burbuja del inbox muestre lo que se envio.
          ...(template.headerFormat === 'IMAGE' &&
            template.headerMediaPath && {
              mediaUrl: template.headerMediaPath,
              mediaType: 'image',
              mediaMimeType: template.headerMediaMime ?? 'image/jpeg',
            }),
        },
      }),
      this.prisma.conversation.update({
        where: { id: conversation.id },
        data: { lastMessageAt: now, lastMessageText: renderedBody, unreadCount: 0 },
      }),
    ]);

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
        lastMessageText: renderedBody,
        lastMessageAt: now.toISOString(),
      },
    });

    return { conversation, message };
  }

  /**
   * Si un agente escribe a mano en una conversación que todavía está en modo BOT
   * (ej: un admin ve el hilo y contesta directo sin pasar por "Contactar a un agente"),
   * la sacamos del bot para que no le siga respondiendo por arriba del humano.
   */
  private async takeOverFromBot(tenantId: string, conversation: { id: string; mode: string; assignedUserId: string | null }, senderId: string) {
    if (conversation.mode !== 'BOT') return;

    await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        mode: 'AGENT',
        botState: null,
        assignedUserId: conversation.assignedUserId ?? senderId,
      },
    });

    await this.prisma.auditLog.create({
      data: {
        tenantId,
        userId: senderId,
        conversationId: conversation.id,
        action: 'conversation.bot_handoff',
        metadata: { reason: 'manual_takeover' },
      },
    });
  }

  /**
   * Media id de la imagen del encabezado para la linea que envia, subiendola si hace falta.
   *
   * Meta pide un media id (o una URL publica) al enviar, y ese id es por numero y vence
   * a los ~30 dias — por eso se cachea por linea en vez de guardar uno solo. Sin imagen
   * no se puede enviar: una plantilla con encabezado IMAGE mandada sin el parametro
   * devuelve 132000 ("number of parameters does not match"), que no dice que falto.
   */
  private async resolveHeaderMediaId(
    template: { id: string; name: string; headerMediaPath: string | null; headerMediaMime: string | null; headerMediaIds: any },
    account: { phoneNumberId: string; accessToken: string },
  ): Promise<string> {
    const cached = this.templatesService.getCachedHeaderMediaId(template, account.phoneNumberId);
    if (cached) return cached;

    const file = await this.templatesService.readHeaderMediaFile(template);
    if (!file) {
      this.logger.error(
        `[Envio bloqueado] La plantilla "${template.name}" (${template.id}) tiene encabezado de imagen ` +
          `pero falta el archivo ${template.headerMediaPath ?? '(sin ruta)'}`,
      );
      throw new BadRequestException(
        `No se encontró la imagen del encabezado de la plantilla "${template.name}". ` +
          'Volvé a crearla con la imagen para poder enviarla.',
      );
    }

    const mediaId = await this.uploadMediaToMeta(account.phoneNumberId, account.accessToken, file);
    await this.templatesService.cacheHeaderMediaId(template.id, account.phoneNumberId, mediaId);
    return mediaId;
  }

  private renderTemplateBody(bodyText: string, variables: string[]): string {
    return bodyText.replace(/\{\{(\d+)\}\}/g, (_, idx) => variables[Number(idx) - 1] ?? `{{${idx}}}`);
  }

  /** Encabezado de texto + cuerpo + pie, ya con las variables reemplazadas. */
  private renderTemplateText(
    template: { headerFormat: string | null; headerText: string | null; bodyText: string; footerText: string | null },
    variables: string[],
    headerVariables: string[],
  ): string {
    const parts: string[] = [];
    if (template.headerFormat === 'TEXT' && template.headerText) {
      parts.push(this.renderTemplateBody(template.headerText, headerVariables));
    }
    parts.push(this.renderTemplateBody(template.bodyText, variables));
    if (template.footerText) parts.push(template.footerText);
    return parts.join('\n\n');
  }

  private async uploadMediaToMeta(
    phoneNumberId: string,
    accessToken: string,
    file: { buffer: Buffer; originalname: string; mimetype: string },
  ): Promise<string> {
    const form = new FormData();
    form.append('messaging_product', 'whatsapp');
    form.append('file', file.buffer, { filename: file.originalname, contentType: file.mimetype });

    try {
      const url = `https://graph.facebook.com/${this.apiVersion}/${phoneNumberId}/media`;
      const { data } = await axios.post(url, form, {
        headers: { Authorization: `Bearer ${accessToken}`, ...form.getHeaders() },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });
      if (!data?.id) throw new Error('Meta no devolvio un media id');
      return data.id;
    } catch (err) {
      this.logger.error('Failed to upload media to Meta', err?.response?.data || err?.message);
      throw new BadRequestException(err?.response?.data?.error?.message || 'Failed to upload media');
    }
  }

  /**
   * A que numero se entrega. Sale de la identidad de WhatsApp del contacto de la
   * conversacion, nunca de lo que mande el cliente: hasta ahora el panel enviaba el
   * destinatario en el body, asi que un request manipulado podia entregarle el mensaje
   * a cualquiera.
   */
  /**
   * Corta un envio si el usuario no puede ver la linea de esa conversacion. Sin esto el
   * limite por linea seria solo visual: la conversacion no aparece en la bandeja, pero
   * el endpoint de envio la acepta igual si alguien conoce su id.
   */
  private async assertCanSend(senderId: string, conversation: { id: string; channelAccountId: string | null }) {
    if (!(await this.channelAccess.canAccessAccount(senderId, conversation.channelAccountId))) {
      throw new BadRequestException('No tenés acceso a la línea de esta conversación');
    }
  }

  private async recipientFor(contactId: string): Promise<string> {
    const recipient = await this.identities.findExternalId(contactId, 'WHATSAPP');
    if (!recipient) {
      throw new BadRequestException('Ese contacto no tiene un número de WhatsApp');
    }
    return recipient;
  }

  private buildPayload(to: string, dto: SendMessageDto) {
    const base = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
    };

    if (dto.type === 'text') {
      return { ...base, type: 'text', text: { preview_url: false, body: dto.body } };
    }

    if (dto.type === 'image') {
      return { ...base, type: 'image', image: dto.mediaUrl?.startsWith('http') ? { link: dto.mediaUrl } : { id: dto.mediaUrl } };
    }

    if (dto.type === 'audio') {
      return { ...base, type: 'audio', audio: dto.mediaUrl?.startsWith('http') ? { link: dto.mediaUrl } : { id: dto.mediaUrl } };
    }

    if (dto.type === 'document') {
      return { ...base, type: 'document', document: dto.mediaUrl?.startsWith('http') ? { link: dto.mediaUrl, filename: 'document' } : { id: dto.mediaUrl } };
    }

    return { ...base, type: 'text', text: { body: dto.body || '' } };
  }
}
