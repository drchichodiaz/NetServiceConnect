import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ChannelAccessService } from '../common/services/channel-access.service';
import { displayId } from '../contacts/contact-identity.service';
import { Channel } from '@prisma/client';
import { EventBusService } from '../events/event-bus.service';
import { UpdateConversationDto } from './dto/update-conversation.dto';

@Injectable()
export class ConversationsService {
  constructor(
    private prisma: PrismaService,
    private eventBus: EventBusService,
    private channelAccess: ChannelAccessService,
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

    // Filtro forzado por línea: si al usuario se le asignaron líneas, sólo ve esas —
    // sin importar su rol ni qué channelAccountId pida por query. El `channelAccountId`
    // de abajo es la *vista* que el agente elige; esto es el permiso, y va primero.
    const accessFilter = requester?.id ? await this.channelAccess.conversationFilter(requester.id) : {};

    const conversations = await this.prisma.conversation.findMany({
      where: {
        tenantId,
        ...accessFilter,
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
        _count: { select: { messages: true, notes: true } },
      },
    });
    if (!conv) throw new NotFoundException('Conversation not found');
    if (requester?.role === 'AGENT' && conv.assignedUserId !== requester.id) {
      throw new NotFoundException('Conversation not found');
    }
    // Misma respuesta que si no existiera: a alguien que no puede ver esta línea no le
    // decimos que la conversación existe pero es de otra sucursal.
    if (requester?.id && !(await this.channelAccess.canAccessAccount(requester.id, conv.channelAccountId))) {
      throw new NotFoundException('Conversation not found');
    }
    return withDisplayId(conv);
  }

  async update(tenantId: string, id: string, actorId: string, dto: UpdateConversationDto, requester?: any) {
    const conv = await this.findOne(tenantId, id, requester);
    const updates: any = {};

    if (dto.status !== undefined) updates.status = dto.status;

    // Asignar a alguien desactivado deja la conversacion en manos de quien no puede
    // entrar: nadie la atiende y no se nota, porque en la bandeja se ve igual que
    // cualquier otra asignada. Se valida aca y no solo en el panel porque el panel es
    // una de las formas de llegar, no la unica.
    if (dto.assignedUserId) {
      const destinatario = await this.prisma.user.findFirst({
        where: { id: dto.assignedUserId, tenantId },
        select: { isActive: true },
      });
      if (!destinatario) throw new NotFoundException('Ese usuario no existe en esta empresa');
      if (!destinatario.isActive) {
        throw new BadRequestException('Ese usuario está desactivado. Actívalo o elige a otra persona.');
      }
      // Y que pueda ver la linea por la que entro esta conversacion. A alguien limitado
      // a otra sucursal la conversacion le queda filtrada de la bandeja: quedaria a su
      // nombre y fuera de su vista al mismo tiempo.
      if (!(await this.channelAccess.canAccessAccount(dto.assignedUserId, conv.channelAccountId))) {
        throw new BadRequestException(
          'Esa persona no tiene acceso a la línea de esta conversación. Dale acceso desde Equipo o elige a otra.',
        );
      }
    }
    if (dto.assignedUserId !== undefined) {
      updates.assignedUserId = dto.assignedUserId;

      // Se marca el traspaso solo cuando la conversacion cambia de manos hacia OTRA
      // persona. Tomarla uno mismo no se marca (ya sabe que la tiene), y reasignar a
      // quien ya la tenia tampoco: seria hacerle parpadear algo que no cambio.
      const cambiaDeDueno = dto.assignedUserId && dto.assignedUserId !== conv.assignedUserId;
      if (cambiaDeDueno && dto.assignedUserId !== actorId) {
        updates.assignedAt = new Date();
        updates.assignedSeenAt = null;
      } else if (dto.assignedUserId !== conv.assignedUserId) {
        // Se la queda quien la asigna, o se deja sin asignar: no hay traspaso que avisar.
        updates.assignedAt = null;
        updates.assignedSeenAt = null;
      }
    }

    await this.prisma.$transaction(async (tx) => {
      if (Object.keys(updates).length > 0) {
        await tx.conversation.update({ where: { id }, data: updates });
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
    const resultado = await this.prisma.conversation.updateMany({
      where: {
        id,
        tenantId,
        ...(requester?.role === 'AGENT' && { assignedUserId: requester.id }),
      },
      data: { unreadCount: 0 },
    });

    // La marca de traspaso la limpia unicamente quien la tiene asignada, al abrirla.
    // Si la mira un supervisor no se apaga: el aviso es para el destinatario, y
    // apagarselo desde otra pantalla es como perder la conversacion otra vez.
    if (requester?.id) {
      await this.prisma.conversation.updateMany({
        where: { id, tenantId, assignedUserId: requester.id },
        data: { assignedSeenAt: new Date() },
      });
    }
    return resultado;
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
