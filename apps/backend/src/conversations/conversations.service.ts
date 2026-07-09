import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateConversationDto } from './dto/update-conversation.dto';

@Injectable()
export class ConversationsService {
  constructor(private prisma: PrismaService) {}

  async findAll(tenantId: string, requester: any, status?: string, assignedUserId?: string, search?: string, contactId?: string) {
    // Un AGENTE solo puede ver sus propias conversaciones asignadas, sin importar
    // qué assignedUserId pida por query — ADMIN/SUPERVISOR ven todo el tenant.
    const effectiveAssignedUserId = requester?.role === 'AGENT' ? requester.id : assignedUserId;

    return this.prisma.conversation.findMany({
      where: {
        tenantId,
        ...(status && { status: status as any }),
        ...(effectiveAssignedUserId && { assignedUserId: effectiveAssignedUserId }),
        ...(contactId && { contactId }),
        ...(search && {
          contact: {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { phone: { contains: search } },
            ],
          },
        }),
      },
      orderBy: { lastMessageAt: 'desc' },
      include: {
        contact: { select: { id: true, name: true, phone: true, avatarUrl: true } },
        assignedUser: { select: { id: true, name: true } },
        tags: { include: { tag: true } },
        _count: { select: { messages: true, notes: true } },
      },
    });
  }

  async findOne(tenantId: string, id: string, requester?: any) {
    const conv = await this.prisma.conversation.findFirst({
      where: { id, tenantId },
      include: {
        contact: true,
        assignedUser: { select: { id: true, name: true, email: true } },
        tags: { include: { tag: true } },
        _count: { select: { messages: true, notes: true } },
      },
    });
    if (!conv) throw new NotFoundException('Conversation not found');
    if (requester?.role === 'AGENT' && conv.assignedUserId !== requester.id) {
      throw new NotFoundException('Conversation not found');
    }
    return conv;
  }

  async update(tenantId: string, id: string, actorId: string, dto: UpdateConversationDto, requester?: any) {
    const conv = await this.findOne(tenantId, id, requester);
    const updates: any = {};

    if (dto.status !== undefined) updates.status = dto.status;
    if (dto.assignedUserId !== undefined) updates.assignedUserId = dto.assignedUserId;

    await this.prisma.$transaction(async (tx) => {
      if (Object.keys(updates).length > 0) {
        await tx.conversation.update({ where: { id }, data: updates });
      }

      if (dto.tagIds !== undefined) {
        await tx.conversationTag.deleteMany({ where: { conversationId: id } });
        if (dto.tagIds.length > 0) {
          await tx.conversationTag.createMany({
            data: dto.tagIds.map((tagId) => ({ conversationId: id, tagId })),
          });
        }
      }

      // Audit trail
      if (dto.status && dto.status !== conv.status) {
        await tx.auditLog.create({
          data: {
            tenantId,
            userId: actorId,
            conversationId: id,
            action: `conversation.status.${dto.status.toLowerCase()}`,
            metadata: { from: conv.status, to: dto.status },
          },
        });
      }

      if (dto.assignedUserId !== undefined && dto.assignedUserId !== conv.assignedUserId) {
        await tx.auditLog.create({
          data: {
            tenantId,
            userId: actorId,
            conversationId: id,
            action: 'conversation.assigned',
            metadata: { from: conv.assignedUserId, to: dto.assignedUserId },
          },
        });
      }
    });

    return this.findOne(tenantId, id);
  }

  async markRead(tenantId: string, id: string, requester?: any) {
    return this.prisma.conversation.updateMany({
      where: {
        id,
        tenantId,
        ...(requester?.role === 'AGENT' && { assignedUserId: requester.id }),
      },
      data: { unreadCount: 0 },
    });
  }
}
