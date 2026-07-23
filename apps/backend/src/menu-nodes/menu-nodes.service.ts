import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const NODE_TYPES = ['MENU', 'TEXT', 'ORDER_LOOKUP', 'AGENT', 'AI_CHAT'] as const;
type NodeType = (typeof NODE_TYPES)[number];

export interface MenuNodeDto {
  parentId?: string | null;
  type?: NodeType;
  title: string;
  subtitle?: string;
  bodyText?: string;
  promptText?: string;
  config?: any;
}

export interface MenuNodeUpdateDto {
  title?: string;
  subtitle?: string;
  bodyText?: string;
  promptText?: string;
  config?: any;
  active?: boolean;
}

export interface ReparentDto {
  parentId: string | null;
  orderedSiblingIds: string[];
}

@Injectable()
export class MenuNodesService {
  constructor(private prisma: PrismaService) {}

  getTree(tenantId: string) {
    return this.prisma.tenantMenuNode.findMany({
      where: { tenantId },
      orderBy: [{ parentId: 'asc' }, { sortOrder: 'asc' }],
    });
  }

  async create(tenantId: string, dto: MenuNodeDto) {
    if (!dto.title?.trim()) throw new BadRequestException('El título es obligatorio');
    const type = dto.type ?? 'TEXT';
    if (!NODE_TYPES.includes(type)) throw new BadRequestException('Tipo de opción inválido');

    const parentId = dto.parentId ?? null;
    await this.assertParentIsMenu(tenantId, parentId);

    const siblingCount = await this.prisma.tenantMenuNode.count({ where: { tenantId, parentId } });

    return this.prisma.tenantMenuNode.create({
      data: {
        tenantId,
        parentId,
        type,
        title: dto.title.trim(),
        subtitle: dto.subtitle?.trim() || null,
        bodyText: dto.bodyText?.trim() || null,
        promptText: dto.promptText?.trim() || null,
        config: dto.config ?? undefined,
        sortOrder: siblingCount,
      },
    });
  }

  async update(tenantId: string, id: string, dto: MenuNodeUpdateDto) {
    const existing = await this.prisma.tenantMenuNode.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Opción de menú no encontrada');

    return this.prisma.tenantMenuNode.update({
      where: { id },
      data: {
        ...(dto.title !== undefined && { title: dto.title.trim() }),
        ...(dto.subtitle !== undefined && { subtitle: dto.subtitle.trim() || null }),
        ...(dto.bodyText !== undefined && { bodyText: dto.bodyText.trim() || null }),
        ...(dto.promptText !== undefined && { promptText: dto.promptText.trim() || null }),
        ...(dto.config !== undefined && { config: dto.config }),
        ...(dto.active !== undefined && { active: dto.active }),
      },
    });
  }

  async remove(tenantId: string, id: string) {
    const existing = await this.prisma.tenantMenuNode.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Opción de menú no encontrada');
    return this.prisma.tenantMenuNode.delete({ where: { id } });
  }

  /**
   * Único endpoint que dispara el drag & drop: mueve `id` bajo `parentId` (o a la
   * raíz si es null) y reasigna sortOrder para todos los hermanos en ese nivel
   * según el orden final que ya calculó el frontend.
   */
  async reparent(tenantId: string, id: string, dto: ReparentDto) {
    const node = await this.prisma.tenantMenuNode.findFirst({ where: { id, tenantId } });
    if (!node) throw new NotFoundException('Opción de menú no encontrada');
    if (dto.parentId === id) throw new BadRequestException('Un nodo no puede ser padre de sí mismo');
    if (!dto.orderedSiblingIds.includes(id)) {
      throw new BadRequestException('orderedSiblingIds debe incluir el propio nodo');
    }

    await this.assertParentIsMenu(tenantId, dto.parentId);
    if (dto.parentId) await this.assertNoCycle(tenantId, id, dto.parentId);

    const siblings = await this.prisma.tenantMenuNode.findMany({
      where: { tenantId, id: { in: dto.orderedSiblingIds } },
      select: { id: true },
    });
    if (siblings.length !== dto.orderedSiblingIds.length) {
      throw new BadRequestException('orderedSiblingIds contiene ids inválidos');
    }

    await this.prisma.$transaction([
      this.prisma.tenantMenuNode.update({ where: { id }, data: { parentId: dto.parentId } }),
      ...dto.orderedSiblingIds.map((siblingId, index) =>
        this.prisma.tenantMenuNode.update({ where: { id: siblingId }, data: { sortOrder: index } }),
      ),
    ]);

    return this.getTree(tenantId);
  }

  private async assertParentIsMenu(tenantId: string, parentId: string | null) {
    if (!parentId) return;
    const parent = await this.prisma.tenantMenuNode.findFirst({ where: { id: parentId, tenantId } });
    if (!parent) throw new NotFoundException('Nodo padre no encontrado');
    if (parent.type !== 'MENU') throw new BadRequestException('Solo una opción de tipo Submenú puede tener opciones adentro');
  }

  private async assertNoCycle(tenantId: string, nodeId: string, newParentId: string) {
    let current: string | null = newParentId;
    const visited = new Set<string>();
    while (current) {
      if (current === nodeId) throw new BadRequestException('Ese movimiento crearía un ciclo en el árbol de menú');
      if (visited.has(current)) break;
      visited.add(current);
      const parentNode = await this.prisma.tenantMenuNode.findFirst({
        where: { id: current, tenantId },
        select: { parentId: true },
      });
      current = parentNode?.parentId ?? null;
    }
  }
}
