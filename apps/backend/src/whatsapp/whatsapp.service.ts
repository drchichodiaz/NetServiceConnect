import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EventBusService } from '../events/event-bus.service';
import { SendMessageDto } from './dto/send-message.dto';
import axios from 'axios';

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);
  private readonly apiVersion: string;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    private eventBus: EventBusService,
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
