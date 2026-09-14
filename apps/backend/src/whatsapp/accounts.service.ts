import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Channel } from '@prisma/client';

/** Lo minimo que necesita cualquier llamada a la Cloud API de Meta. */
export interface WhatsAppAccountCreds {
  id: string;
  phoneNumberId: string;
  accessToken: string;
  wabaId: string;
}

/**
 * Punto unico de resolucion de "por que linea de WhatsApp sale esto".
 *
 * Antes del multi-numero cada servicio hacia su propio
 * `channelAccount.findUnique({ where: { tenantId } })`; ahora todos pasan por aca,
 * asi que la regla de que un envio siempre sale por la misma linea por la que entro
 * la conversacion vive en un solo lugar.
 *
 * Tambien es el punto de enganche para un futuro scoping por sucursal (limitar que
 * lineas ve cada agente): hoy el pool de agentes es compartido y todas las lineas
 * son visibles para todo el tenant, pero el filtro iria aca y en
 * ConversationsService.findAll, no desperdigado por los servicios de envio.
 */
@Injectable()
export class WhatsAppAccountsService {
  private readonly logger = new Logger(WhatsAppAccountsService.name);

  constructor(private prisma: PrismaService) {}

  /** Campos seguros para el frontend — nunca incluye accessToken. */
  private static readonly PUBLIC_FIELDS = {
    id: true,
    wabaId: true,
    phoneNumberId: true,
    phoneNumber: true,
    displayName: true,
    businessName: true,
    label: true,
    isDefault: true,
    sortOrder: true,
    platformStatus: true,
    statusCheckedAt: true,
    signupStatus: true,
    isActive: true,
    webhookVerifyToken: true,
    createdAt: true,
    updatedAt: true,
  } as const;

  listForTenant(tenantId: string) {
    return this.prisma.channelAccount.findMany({
      where: { tenantId },
      select: WhatsAppAccountsService.PUBLIC_FIELDS,
      orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /**
   * Solo las lineas que sirven para operar — alimentan el filtro y el badge del inbox.
   * Lo lee cualquier agente, asi que devuelve lo minimo para mostrar una linea: sin
   * webhookVerifyToken ni ids de Meta, que son cosa del admin.
   */
  listActiveForTenant(tenantId: string) {
    return this.prisma.channelAccount.findMany({
      where: { tenantId, isActive: true },
      select: { id: true, label: true, phoneNumber: true, isDefault: true, sortOrder: true },
      orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async findOneOrThrow(tenantId: string, id: string) {
    const account = await this.prisma.channelAccount.findFirst({ where: { id, tenantId } });
    if (!account) throw new NotFoundException('Linea de WhatsApp no encontrada');
    return account;
  }

  /** Como findOneOrThrow pero exige que la linea siga conectada — para enviar. */
  async findActiveOrThrow(tenantId: string, id: string) {
    const account = await this.findOneOrThrow(tenantId, id);
    if (!account.isActive) {
      throw new BadRequestException('Esa línea de WhatsApp está desconectada');
    }
    return account;
  }

  /**
   * Credenciales de la Cloud API de una linea elegida a mano por el agente. Falla si la
   * cuenta existe pero es de otro canal: mandar una plantilla de WhatsApp por una pagina
   * de Facebook no es algo que se pueda intentar y ver que pasa.
   */
  async findActiveCredsOrThrow(tenantId: string, id: string): Promise<WhatsAppAccountCreds> {
    const account = await this.findActiveOrThrow(tenantId, id);
    const creds = this.toCreds(account);
    if (!creds) {
      throw new BadRequestException('Esa cuenta no es una línea de WhatsApp');
    }
    return creds;
  }

  /**
   * Linea a usar cuando no hay conversacion de la cual deducirla (alta de plantillas,
   * conversacion saliente sin linea elegida). Prefiere la marcada como default; si
   * ninguna lo esta (ej: se desconecto), cae a la primera activa por orden.
   */
  async getDefault(tenantId: string): Promise<WhatsAppAccountCreds | null> {
    const account = await this.prisma.channelAccount.findFirst({
      // El filtro por canal importa: la default de un tenant que ya tenga una pagina
      // de Facebook podria ser esa, y estas credenciales son para la Cloud API.
      where: { tenantId, isActive: true, channel: 'WHATSAPP' },
      orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return account ? this.toCreds(account) : null;
  }

  /**
   * Linea por la que hay que responder una conversacion. El fallback a la default
   * cubre las conversaciones anteriores al multi-numero cuyo backfill no encontro
   * cuenta, y las que quedaron huerfanas al desconectar una linea (FK SET NULL):
   * es preferible responder por la linea equivocada a dejar al cliente sin respuesta.
   */
  async getForConversation(conversationId: string): Promise<WhatsAppAccountCreds | null> {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { tenantId: true, channelAccount: true },
    });
    if (!conv) return null;

    const account = conv.channelAccount;
    if (account?.isActive) {
      const creds = this.toCreds(account);
      if (creds) return creds;
      // La conversacion entro por otro canal. Caer a la linea de WhatsApp por defecto
      // seria responderle al cliente por un canal distinto al que uso: mejor nada.
      this.logger.warn(`Conversacion ${conversationId} es de ${account.channel}, no de WhatsApp`);
      return null;
    }

    const fallback = await this.getDefault(conv.tenantId);
    if (!fallback) {
      this.logger.warn(`Tenant ${conv.tenantId} no tiene ninguna linea de WhatsApp activa`);
      return null;
    }
    this.logger.warn(
      `Conversacion ${conversationId} sin linea propia activa — se responde por la linea por defecto ${fallback.phoneNumberId}`,
    );
    return fallback;
  }

  /**
   * Devuelve null si la cuenta no es de WhatsApp. Desde que ChannelAccount tambien
   * guarda paginas de Facebook y cuentas de Instagram, wabaId y phoneNumberId son
   * nullable — y sin ellos no hay forma de llamar a la Cloud API. Preferimos null a
   * unas credenciales con campos vacios que fallarian recien contra Meta.
   */
  private toCreds(account: {
    id: string;
    channel: Channel;
    phoneNumberId: string | null;
    accessToken: string;
    wabaId: string | null;
  }): WhatsAppAccountCreds | null {
    if (account.channel !== 'WHATSAPP' || !account.phoneNumberId || !account.wabaId) return null;
    return {
      id: account.id,
      phoneNumberId: account.phoneNumberId,
      accessToken: account.accessToken,
      wabaId: account.wabaId,
    };
  }

  /** Renombrar la linea (el label que ve el agente en el inbox) y reordenarla. */
  async update(tenantId: string, id: string, data: { label?: string | null; sortOrder?: number }) {
    await this.findOneOrThrow(tenantId, id);
    await this.prisma.channelAccount.update({
      where: { id },
      data: {
        ...(data.label !== undefined && { label: data.label?.trim() || null }),
        ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
      },
    });
    return this.prisma.channelAccount.findUnique({
      where: { id },
      select: WhatsAppAccountsService.PUBLIC_FIELDS,
    });
  }

  /** Marca una linea como default y desmarca el resto — en una transaccion, hay a lo sumo una. */
  async setDefault(tenantId: string, id: string) {
    await this.findOneOrThrow(tenantId, id);
    await this.prisma.$transaction([
      this.prisma.channelAccount.updateMany({ where: { tenantId }, data: { isDefault: false } }),
      this.prisma.channelAccount.update({ where: { id }, data: { isDefault: true } }),
    ]);
    return this.listForTenant(tenantId);
  }

  /**
   * Desconecta una linea sin borrarla: el historial de sus conversaciones se conserva
   * y el numero se puede volver a conectar despues sin perder nada.
   */
  async disconnect(tenantId: string, id: string) {
    const account = await this.findOneOrThrow(tenantId, id);
    await this.prisma.channelAccount.update({
      where: { id },
      data: { signupStatus: 'DISCONNECTED', isActive: false, isDefault: false },
    });

    // Si era la default, promover otra activa para no dejar al tenant sin linea
    // de referencia para plantillas y conversaciones salientes.
    if (account.isDefault) {
      const next = await this.prisma.channelAccount.findFirst({
        where: { tenantId, isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      });
      if (next) {
        await this.prisma.channelAccount.update({ where: { id: next.id }, data: { isDefault: true } });
      }
    }

    return this.listForTenant(tenantId);
  }
}
