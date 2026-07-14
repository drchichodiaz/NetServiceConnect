import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EventBusService } from '../events/event-bus.service';
import { MediaService } from '../media/media.service';
import { TemplatesService } from '../templates/templates.service';
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
  ) {
    this.apiVersion = config.get('META_API_VERSION') || 'v19.0';
  }

  async sendMessage(tenantId: string, senderId: string, dto: SendMessageDto) {
    const account = await this.prisma.whatsAppAccount.findUnique({
      where: { tenantId },
    });

    if (!account || !account.isActive) {
      throw new BadRequestException('No active WhatsApp account found for this tenant');
    }

    const conversation = await this.prisma.conversation.findFirst({
      where: { id: dto.conversationId, tenantId },
    });

    if (!conversation) throw new NotFoundException('Conversation not found');

    const payload = this.buildPayload(dto.to, dto);
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
    const account = await this.prisma.whatsAppAccount.findUnique({
      where: { tenantId },
    });

    if (!account || !account.isActive) {
      throw new BadRequestException('No active WhatsApp account found for this tenant');
    }

    const conversation = await this.prisma.conversation.findFirst({
      where: { id: dto.conversationId, tenantId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');

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
      to: dto.to,
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
    const account = await this.prisma.whatsAppAccount.findUnique({ where: { tenantId } });
    if (!account || !account.isActive) {
      throw new BadRequestException('No active WhatsApp account found for this tenant');
    }

    const template = await this.templatesService.findApprovedOrThrow(tenantId, dto.templateId);

    let contact: { id: string; name: string | null; phone: string };
    if (dto.contactId) {
      const found = await this.prisma.contact.findFirst({ where: { id: dto.contactId, tenantId } });
      if (!found) throw new NotFoundException('Contact not found');
      contact = found;
    } else {
      if (!dto.phone) throw new BadRequestException('phone is required to create a new contact');
      contact = await this.prisma.contact.upsert({
        where: { tenantId_phone: { tenantId, phone: dto.phone } },
        update: dto.name ? { name: dto.name } : {},
        create: { tenantId, phone: dto.phone, name: dto.name },
      });
    }

    let conversation = await this.prisma.conversation.findFirst({
      where: { tenantId, contactId: contact.id, status: { not: 'CLOSED' } },
      orderBy: { createdAt: 'desc' },
    });

    const now = new Date();
    const variables = dto.variables ?? [];
    const renderedBody = this.renderTemplateBody(template.bodyText, variables);

    if (!conversation) {
      conversation = await this.prisma.conversation.create({
        data: {
          tenantId,
          contactId: contact.id,
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

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: contact.phone,
      type: 'template',
      template: {
        name: template.name,
        language: { code: template.language },
        ...(variables.length > 0 && {
          components: [{ type: 'body', parameters: variables.map((v) => ({ type: 'text', text: v })) }],
        }),
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
      throw new BadRequestException(err?.response?.data?.error?.message || 'Failed to send template message');
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
        contact: { id: contact.id, name: contact.name, phone: contact.phone },
        lastMessageText: renderedBody,
        lastMessageAt: now.toISOString(),
      },
    });

    return { conversation, message };
  }

  private renderTemplateBody(bodyText: string, variables: string[]): string {
    return bodyText.replace(/\{\{(\d+)\}\}/g, (_, idx) => variables[Number(idx) - 1] ?? `{{${idx}}}`);
  }

  private async uploadMediaToMeta(phoneNumberId: string, accessToken: string, file: Express.Multer.File): Promise<string> {
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
