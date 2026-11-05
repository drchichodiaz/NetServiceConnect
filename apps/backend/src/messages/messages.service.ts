import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationsService } from '../conversations/conversations.service';
import { MediaService } from '../media/media.service';

const PAGE_SIZE = 50;

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

    // Se trae la pagina MAS RECIENTE y se pagina hacia atras. Antes era `asc` + take 50
    // y el inbox nunca pedia la pagina siguiente: pasados los 50 mensajes, todo lo nuevo
    // se veia en vivo y desaparecia al volver a abrir el chat. El cursor es el mensaje
    // mas viejo ya cargado; el `id` desempata los que comparten createdAt.
    const page = await this.prisma.message.findMany({
      where: { conversationId, tenantId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: PAGE_SIZE + 1,
      ...(cursor && { cursor: { id: cursor }, skip: 1 }),
      include: {
        sender: { select: { id: true, name: true } },
      },
    });

    const hasMore = page.length > PAGE_SIZE;
    const messages = page.slice(0, PAGE_SIZE).reverse();

    return {
      // En orden cronologico, como antes: el frontend los dibuja tal cual llegan.
      messages,
      // Para pedir los anteriores a esta pagina. null = ya no hay mas atras.
      nextCursor: hasMore ? messages[0].id : null,
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
