import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LookupService, LookupConfig } from '../common/lookup.service';
import { BotsService } from '../bots/bots.service';
import { LocationConfig, resolveMapsLink } from '../common/maps-link';

const NODE_TYPES = ['MENU', 'TEXT', 'ORDER_LOOKUP', 'AGENT', 'AI_CHAT', 'LOCATION'] as const;
type NodeType = (typeof NODE_TYPES)[number];

export interface MenuNodeDto {
  // Bot al que pertenece. Obligatorio si no hay parentId (una opción de la raíz);
  // con parentId se hereda del padre.
  botId?: string;
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
  constructor(
    private prisma: PrismaService,
    private lookup: LookupService,
    private bots: BotsService,
  ) {}

  /**
   * Corre la consulta del nodo con un valor de prueba y devuelve tanto el JSON crudo
   * como el mensaje ya armado. Sin esto, configurar la plantilla seria a ciegas:
   * habria que probar cada cambio mandandose un WhatsApp a uno mismo.
   */
  async testLookup(tenantId: string, id: string, value: string) {
    const node = await this.prisma.tenantMenuNode.findFirst({ where: { id, tenantId } });
    if (!node) throw new NotFoundException('Opción no encontrada');

    const config = (node.config ?? {}) as LookupConfig;
    if (!config.apiUrl?.trim()) {
      throw new BadRequestException('Configurá primero la URL del sistema externo');
    }

    const result = await this.lookup.run(config, value?.trim() || '');
    return {
      ...result,
      // Si no hay plantilla todavia, igual sirve ver que devolvio la API para poder
      // escribirla mirando los campos reales.
      rendered: result.rendered,
      notFoundText: result.notFound ? this.lookup.renderNotFound(config, value?.trim() || '') : null,
    };
  }

  /**
   * Coordenadas de un link de Google Maps, para que el panel las muestre antes de
   * guardar. Un error aca es una respuesta normal (link sin coordenadas, link ajeno),
   * no una excepcion: el panel lo muestra al lado del campo.
   */
  resolveLocation(url: string) {
    return resolveMapsLink(url);
  }

  async getTree(tenantId: string, botId: string) {
    if (!botId) throw new BadRequestException('Falta indicar el bot');
    await this.bots.findOneOrThrow(tenantId, botId);
    return this.prisma.tenantMenuNode.findMany({
      where: { tenantId, botId },
      orderBy: [{ parentId: 'asc' }, { sortOrder: 'asc' }],
    });
  }

  async create(tenantId: string, dto: MenuNodeDto) {
    if (!dto.title?.trim()) throw new BadRequestException('El título es obligatorio');
    const type = dto.type ?? 'TEXT';
    if (!NODE_TYPES.includes(type)) throw new BadRequestException('Tipo de opción inválido');

    const parentId = dto.parentId ?? null;
    const parent = await this.assertParentIsMenu(tenantId, parentId);
    const botId = parent?.botId ?? dto.botId;
    if (!botId) throw new BadRequestException('Falta indicar el bot');
    if (parent && dto.botId && dto.botId !== parent.botId) {
      throw new BadRequestException('La opción padre es de otro bot');
    }
    await this.bots.findOneOrThrow(tenantId, botId);

    const siblingCount = await this.prisma.tenantMenuNode.count({ where: { tenantId, botId, parentId } });

    return this.prisma.tenantMenuNode.create({
      data: {
        tenantId,
        botId,
        parentId,
        type,
        title: dto.title.trim(),
        subtitle: dto.subtitle?.trim() || null,
        bodyText: dto.bodyText?.trim() || null,
        promptText: dto.promptText?.trim() || null,
        config: (type === 'LOCATION' && dto.config ? cleanLocationConfig(dto.config) : dto.config) ?? undefined,
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
        ...(dto.config !== undefined && {
          config: existing.type === 'LOCATION' && dto.config ? cleanLocationConfig(dto.config) : dto.config,
        }),
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

    // Mover entre bots no existe: el arbol de un bot solo se reordena adentro de ese bot.
    const parent = await this.assertParentIsMenu(tenantId, dto.parentId);
    if (parent && parent.botId !== node.botId) {
      throw new BadRequestException('No se puede mover una opción a otro bot');
    }
    if (dto.parentId) await this.assertNoCycle(tenantId, id, dto.parentId);

    const siblings = await this.prisma.tenantMenuNode.findMany({
      where: { tenantId, botId: node.botId, id: { in: dto.orderedSiblingIds } },
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

    return this.getTree(tenantId, node.botId);
  }

  private async assertParentIsMenu(tenantId: string, parentId: string | null) {
    if (!parentId) return null;
    const parent = await this.prisma.tenantMenuNode.findFirst({ where: { id: parentId, tenantId } });
    if (!parent) throw new NotFoundException('Nodo padre no encontrado');
    if (parent.type !== 'MENU') throw new BadRequestException('Solo una opción de tipo Submenú puede tener opciones adentro');
    return parent;
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

/**
 * Deja la config de un nodo LOCATION con solo lo que usa el bot, y las coordenadas como
 * numeros. Unas coordenadas fuera de rango se rechazan aca: si se guardaran, el error
 * aparece recien cuando un cliente toca la opcion y Meta rechaza el mensaje.
 */
function cleanLocationConfig(raw: any): LocationConfig {
  const text = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
  const num = (v: unknown) => (v === null || v === undefined || v === '' ? undefined : Number(v));

  const latitude = num(raw?.latitude);
  const longitude = num(raw?.longitude);
  if ((latitude === undefined) !== (longitude === undefined)) {
    throw new BadRequestException('Faltan la latitud o la longitud');
  }
  if (latitude !== undefined && longitude !== undefined) {
    if (!Number.isFinite(latitude) || Math.abs(latitude) > 90) throw new BadRequestException('La latitud tiene que estar entre -90 y 90');
    if (!Number.isFinite(longitude) || Math.abs(longitude) > 180) throw new BadRequestException('La longitud tiene que estar entre -180 y 180');
  }

  return {
    mapsUrl: text(raw?.mapsUrl, 1000),
    latitude,
    longitude,
    // WhatsApp no documenta un tope, pero la tarjeta muestra una o dos lineas: mas
    // largo que esto no se lee.
    name: text(raw?.name, 100),
    address: text(raw?.address, 200),
  };
}
