import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Que lineas puede ver un usuario.
 *
 * Es uno de los dos ejes de visibilidad y son independientes:
 *
 *   - el ROL decide QUE conversaciones ve: un AGENT solo las asignadas a el,
 *     ADMIN y SUPERVISOR todas las del tenant (ConversationsService);
 *   - esto decide DE QUE LINEAS, sin importar el rol.
 *
 * Se combinan, asi que un agente puede quedar limitado a sus propias conversaciones
 * y ademas a una sola sucursal.
 *
 * `null` significa "sin restriccion" y NO es lo mismo que una lista vacia: un usuario
 * sin ninguna fila en UserChannelAccount ve todas las lineas. Eso hace que limitar a
 * alguien sea siempre una accion explicita, y que nadie pierda acceso por omision.
 */
@Injectable()
export class ChannelAccessService {
  constructor(private prisma: PrismaService) {}

  /** Ids de las lineas que puede ver, o null si puede verlas todas. */
  async allowedAccountIds(userId: string): Promise<string[] | null> {
    const rows = await this.prisma.userChannelAccount.findMany({
      where: { userId },
      select: { channelAccountId: true },
    });
    if (rows.length === 0) return null;
    return rows.map((r) => r.channelAccountId);
  }

  /**
   * Clausula `where` de Prisma para filtrar conversaciones por linea. Devuelve `{}`
   * cuando el usuario no tiene restriccion, asi el llamador la puede esparcir siempre
   * sin preguntar.
   *
   * Incluye `channelAccountId: null` a proposito: las conversaciones anteriores al
   * multi-numero, y las que quedaron huerfanas al desconectar una linea (FK SET NULL),
   * no tienen linea. Dejarlas afuera las volveria invisibles para todos los usuarios
   * limitados, sin que nadie entienda por que faltan.
   */
  async conversationFilter(userId: string): Promise<Record<string, unknown>> {
    const allowed = await this.allowedAccountIds(userId);
    if (!allowed) return {};
    return { OR: [{ channelAccountId: { in: allowed } }, { channelAccountId: null }] };
  }

  /** Si puede operar sobre una conversacion de esa linea. Una conversacion sin linea
   *  es visible para todos, por el mismo motivo que arriba. */
  async canAccessAccount(userId: string, channelAccountId: string | null): Promise<boolean> {
    if (channelAccountId === null) return true;
    const allowed = await this.allowedAccountIds(userId);
    if (!allowed) return true;
    return allowed.includes(channelAccountId);
  }

  /** Reemplaza las lineas asignadas a un usuario. Lista vacia = sin restriccion. */
  async setForUser(userId: string, channelAccountIds: string[]) {
    await this.prisma.$transaction([
      this.prisma.userChannelAccount.deleteMany({ where: { userId } }),
      this.prisma.userChannelAccount.createMany({
        data: channelAccountIds.map((channelAccountId) => ({ userId, channelAccountId })),
        skipDuplicates: true,
      }),
    ]);
  }
}
