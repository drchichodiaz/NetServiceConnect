import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateNoteDto } from './dto/create-note.dto';

@Injectable()
export class NotesService {
  constructor(private prisma: PrismaService) {}

  async create(tenantId: string, userId: string, conversationId: string, dto: CreateNoteDto) {
    const conv = await this.prisma.conversation.findFirst({ where: { id: conversationId, tenantId } });
    if (!conv) throw new NotFoundException('Conversation not found');

    return this.prisma.internalNote.create({
      data: { tenantId, userId, conversationId, body: dto.body },
      include: { user: { select: { id: true, name: true } } },
    });
  }

  async findByConversation(tenantId: string, conversationId: string) {
    const conv = await this.prisma.conversation.findFirst({ where: { id: conversationId, tenantId } });
    if (!conv) throw new NotFoundException('Conversation not found');

    return this.prisma.internalNote.findMany({
      where: { conversationId, tenantId },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, name: true } } },
    });
  }

  async remove(tenantId: string, userId: string, id: string) {
    const note = await this.prisma.internalNote.findFirst({ where: { id, tenantId } });
    if (!note) throw new NotFoundException('Note not found');
    if (note.userId !== userId) throw new ForbiddenException('Can only delete your own notes');
    return this.prisma.internalNote.delete({ where: { id } });
  }
}
