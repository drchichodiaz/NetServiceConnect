import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { displayId } from '../contacts/contact-identity.service';
import { Channel } from '@prisma/client';
import { EventBusService } from '../events/event-bus.service';
import { UpdateConversationDto } from './dto/update-conversation.dto';

@Injectable()
export class ConversationsService {
  constructor(
    private prisma: PrismaService,
    private eventBus: EventBusService,
  ) {}

  async findAll(
    tenantId: string,
    requester: any,
    status?: string,
    assignedUserId?: string,
    search?: string,
    contactId?: string,
    channelAccountId?: string,
  ) {
    // Un AGENTE solo puede ver sus propias conversaciones asignadas, sin importar
    // qué assignedUserId pida por query — ADMIN/SUPERVISOR ven todo el tenant.
    const effectiveAssignedUserId = requester?.role === 'AGENT' ? requester.id : assignedUserId;

    // El filtro por línea (sucursal) es una vista, no un permiso: el pool de agentes
    // es compartido y todos ven todas las líneas. Si más adelante se pide limitar
    // qué líneas ve cada agente, el filtro forzado va acá, al lado del de AGENT.
    const conversations = await this.prisma.conversation.findMany({
      where: {
        tenantId,
        ...(status && { status: status as any }),
        ...(effectiveAssignedUserId && { assignedUserId: effectiveAssignedUserId }),
        ...(contactId && { contactId }),
        ...(channelAccountId && { channelAccountId }),
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
        contact: {
          select: {
            id: true,
            name: true,
            phone: true,
            avatarUrl: true,
            identities: { select: { channel: true, externalId: true, handle: true } },
          },
        },
        channelAccount: { select: { id: true, label: true, phoneNumber: true, channel: true } },
        assignedUser: { select: { id: true, name: true } },
        tags: { include: { tag: true } },
        _count: { select: { messages: true, notes: true } },
      },
    });

    return conversations.map(withDisplayId);
  }

  async findOne(tenantId: string, id: string, requester?: any) {
    const conv = await this.prisma.conversation.findFirst({
      where: { id, tenantId },
      include: {
        contact: { include: { identities: { select: { channel: true, externalId: true, handle: true } } } },
        channelAccount: { select: { id: true, label: true, phoneNumber: true, channel: true } },
        assignedUser: { select: { id: true, name: true, email: true } },
        tags: { include: { tag: true } },
        _count: { select: { messages: true, notes: true } },
      },
    });
    if (!conv) throw new NotFoundException('Conversation not found');
    if (requester?.role === 'AGENT' && conv.assignedUserId !== requester.id) {
      throw new NotFoundException('Conversation not found');
    }
    return withDisplayId(conv);
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

    // Los cambios del bot ya emitian este evento, los manuales no: si un agente
    // cerraba o reasignaba una conversacion, el inbox del resto seguia mostrandola
    // como estaba hasta que recargaran a mano.
    this.eventBus.publish({ type: 'conversation_updated', tenantId, payload: { conversationId: id } });

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

/**
 * Le agrega al contacto el nombre con el que se lo muestra en la bandeja, resuelto
 * segun el canal por el que entro la conversacion. Vive en el backend y no en cada
 * componente del panel para que la regla — que en Instagram es el @usuario y en
 * Messenger nunca es el id crudo — este escrita una sola vez.
 */
function withDisplayId<
  T extends {
    channelAccount?: { channel?: Channel | null } | null;
    contact: {
      name?: string | null;
      phone?: string | null;
      identities?: Array<{ channel: Channel; externalId: string; handle: string | null }>;
    };
  },
>(conv: T) {
  const channel = conv.channelAccount?.channel ?? null;
  const identity = conv.contact.identities?.find((i) => i.channel === channel) ?? conv.contact.identities?.[0] ?? null;
  return {
    ...conv,
    contact: {
      ...conv.contact,
      channel,
      displayId: displayId(channel, conv.contact, identity),
    },
  };
}
