import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationsService } from '../conversations/conversations.service';
import { MediaService } from '../media/media.service';

@Injectable()
export class MessagesService {
  constructor(
    private prisma: PrismaService,
    private conversationsService: ConversationsService,
    private mediaService: MediaService,
  ) {}

  async findByConversation(tenantId: string, conversationId: string, requester: any, cursor?: string) {
    // findOne ya valida tenant + (si es AGENT) que la conversacion sea suya
    await this.conversationsService.findOne(tenantId, conversationId, requester);

    const messages = await this.prisma.message.findMany({
      where: { conversationId, tenantId },
      orderBy: { createdAt: 'asc' },
      take: 50,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      include: {
        sender: { select: { id: true, name: true } },
      },
    });

    return {
      messages,
      nextCursor: messages.length === 50 ? messages[messages.length - 1].id : null,
    };
  }

  async getMediaFile(tenantId: string, conversationId: string, messageId: string, requester: any) {
    // Misma validacion de visibilidad que el listado de mensajes.
    await this.conversationsService.findOne(tenantId, conversationId, requester);

    const message = await this.prisma.message.findFirst({
      where: { id: messageId, conversationId, tenantId },
    });
    if (!message || !message.mediaUrl || !(await this.mediaService.exists(message.mediaUrl))) {
      throw new NotFoundException('Media not found');
    }

    return {
      absolutePath: await this.mediaService.resolveAbsolutePath(message.mediaUrl),
      mimeType: message.mediaMimeType || 'application/octet-stream',
    };
  }
}
