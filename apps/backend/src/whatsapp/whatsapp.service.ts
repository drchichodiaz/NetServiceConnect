import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EventBusService } from '../events/event-bus.service';
import { MediaService } from '../media/media.service';
import { SendMessageDto } from './dto/send-message.dto';
import { SendMediaDto } from './dto/send-media.dto';
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
