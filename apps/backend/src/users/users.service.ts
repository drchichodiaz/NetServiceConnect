import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ChannelAccessService } from '../common/services/channel-access.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import * as bcrypt from 'bcryptjs';

/**
 * La forma en que un usuario sale de esta API, en TODOS los endpoints. Vive en un solo
 * lugar a proposito: cuando cada metodo tenia su propio select, el de `update` se quedo
 * sin `channelAccess` y devolvia el usuario sin sus lineas. El panel guardaba el cambio
 * y despues pisaba su estado con esa respuesta incompleta, asi que al reabrir la ficha
 * las lineas aparecian sin marcar hasta recargar la pantalla.
 */
const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  channelAccess: { select: { channelAccountId: true } },
} as const;

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private channelAccess: ChannelAccessService,
  ) {}

  async create(tenantId: string, dto: CreateUserDto) {
    // El email es unico en todo el sistema, asi que el choque puede ser con un usuario
    // de otra empresa. El mensaje no dice de cual: seria contar quien mas usa la
    // plataforma a alguien que no tiene por que saberlo.
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('Ese email ya está registrado');

    const hash = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        tenantId,
        email: dto.email,
        password: hash,
        name: dto.name,
        role: (dto.role as any) || 'AGENT',
      },
      select: USER_SELECT,
    });
    return flattenAccess(user);
  }

  async findAll(tenantId: string) {
    const users = await this.prisma.user.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
      select: USER_SELECT,
    });
    return users.map(flattenAccess);
  }

  async findOne(tenantId: string, id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, tenantId },
      select: USER_SELECT,
    });
    if (!user) throw new NotFoundException('User not found');
    return flattenAccess(user);
  }

  async update(tenantId: string, id: string, dto: UpdateUserDto) {
    await this.findOne(tenantId, id);

    // Las lineas van a su propia tabla, no a la fila del usuario. Solo se tocan si el
    // campo vino: mandar [] es "quitarle toda restriccion", no mandarlo es "no cambiar".
    if (dto.channelAccountIds !== undefined) {
      await this.assertAccountsBelongToTenant(tenantId, dto.channelAccountIds);
      await this.channelAccess.setForUser(id, dto.channelAccountIds);
    }
    const { channelAccountIds, ...userDto } = dto;
    dto = userDto as UpdateUserDto;

    if (dto.email) {
      const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
      if (existing && existing.id !== id) throw new ConflictException('Ese email ya está registrado');
    }

    const { password, ...rest } = dto;
    const data: any = { ...rest };
    if (password) {
      data.password = await bcrypt.hash(password, 10);
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data,
      select: USER_SELECT,
    });
    return flattenAccess(updated);
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    return this.prisma.user.update({
      where: { id },
      data: { isActive: false },
    });
  }

  /** Que nadie asigne una linea de otro tenant pasandole el id a mano. */
  private async assertAccountsBelongToTenant(tenantId: string, ids: string[]) {
    if (ids.length === 0) return;
    const count = await this.prisma.channelAccount.count({ where: { tenantId, id: { in: ids } } });
    if (count !== ids.length) {
      throw new BadRequestException('Alguna de las líneas no pertenece a esta empresa');
    }
  }
}

/**
 * Aplana las filas de UserChannelAccount a una lista de ids. Una lista vacia significa
 * "ve todas las lineas", que es el default — no "no ve ninguna".
 */
function flattenAccess<T extends { channelAccess?: { channelAccountId: string }[] }>(user: T) {
  const { channelAccess, ...rest } = user;
  return { ...rest, channelAccountIds: (channelAccess ?? []).map((a) => a.channelAccountId) };
}
