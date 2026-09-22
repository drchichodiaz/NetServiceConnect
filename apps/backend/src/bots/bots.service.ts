import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Bot, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { getPeriodStart, StatsPeriod } from '../common/period-range';

const STATS_ACTIONS = [
  'bot.started',
  'bot.resolved_without_agent',
  'conversation.bot_handoff',
  'conversation.order_lookup_requested',
] as const;

const DEFAULT_BOT_NAME = 'Bot principal';
const NAME_MAX_LENGTH = 60;

export interface BotUpdateDto {
  name?: string;
  aiKnowledgeBase?: string;
  startInAiChat?: boolean;
}

/**
 * Los bots de un tenant y cual atiende cada linea.
 *
 * Reglas que viven aca y en ningun otro lado:
 * - siempre hay exactamente un bot por defecto (se crea solo si falta);
 * - una linea sin bot elegido usa el por defecto, y una con botEnabled=false no tiene bot.
 */
@Injectable()
export class BotsService {
  constructor(private prisma: PrismaService) {}

  /** Lista para el panel, con las lineas que atiende cada bot (ya resuelto el "por defecto"). */
  async list(tenantId: string) {
    await this.getDefault(tenantId);
    const [bots, lines] = await Promise.all([
      this.prisma.bot.findMany({
        where: { tenantId },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
        include: { _count: { select: { menuNodes: true } } },
      }),
      this.prisma.channelAccount.findMany({
        where: { tenantId, channel: 'WHATSAPP', isActive: true },
        select: { id: true, label: true, phoneNumber: true, botId: true, botEnabled: true },
        orderBy: [{ isDefault: 'desc' }, { sortOrder: 'asc' }, { createdAt: 'asc' }],
      }),
    ]);

    const defaultId = bots.find((b) => b.isDefault)?.id;
    const knownIds = new Set(bots.map((b) => b.id));

    return bots.map(({ _count, ...bot }) => ({
      ...bot,
      nodeCount: _count.menuNodes,
      lines: lines
        .filter((l) => l.botEnabled && (l.botId && knownIds.has(l.botId) ? l.botId : defaultId) === bot.id)
        .map(({ id, label, phoneNumber }) => ({ id, label, phoneNumber })),
    }));
  }

  async findOneOrThrow(tenantId: string, id: string) {
    // Sin este guard, un id vacio haria que findFirst devuelva cualquier bot del tenant.
    if (!id) throw new NotFoundException('Bot no encontrado');
    const bot = await this.prisma.bot.findFirst({ where: { id, tenantId } });
    if (!bot) throw new NotFoundException('Bot no encontrado');
    return bot;
  }

  /**
   * El bot por defecto del tenant, creandolo si todavia no existe (tenant nuevo). Si
   * dos mensajes de un tenant recien creado llegan a la vez podrian crearse dos; se
   * usa siempre el mas viejo, asi que el segundo queda como un bot comun y no rompe nada.
   */
  async getDefault(tenantId: string): Promise<Bot> {
    const existing = await this.prisma.bot.findFirst({
      where: { tenantId, isDefault: true },
      orderBy: { createdAt: 'asc' },
    });
    if (existing) return existing;
    return this.prisma.bot.create({ data: { tenantId, name: DEFAULT_BOT_NAME, isDefault: true } });
  }

  /**
   * Que bot atiende una conversacion nueva en esta linea. null = la linea no tiene bot
   * y la conversacion va directo a los agentes.
   */
  async resolveForAccount(tenantId: string, accountId: string): Promise<Bot | null> {
    const account = await this.prisma.channelAccount.findFirst({
      where: { id: accountId, tenantId },
      select: { botEnabled: true, bot: true },
    });
    if (account && !account.botEnabled) return null;
    return account?.bot ?? this.getDefault(tenantId);
  }

  async create(tenantId: string, name: string) {
    await this.getDefault(tenantId);
    return this.prisma.bot.create({ data: { tenantId, name: this.cleanName(name) } });
  }

  async update(tenantId: string, id: string, dto: BotUpdateDto) {
    await this.findOneOrThrow(tenantId, id);
    const data: Prisma.BotUpdateInput = {};
    if (dto.name !== undefined) data.name = this.cleanName(dto.name);
    if (dto.aiKnowledgeBase !== undefined) data.aiKnowledgeBase = dto.aiKnowledgeBase.trim() || null;
    if (dto.startInAiChat !== undefined) data.startInAiChat = !!dto.startInAiChat;
    return this.prisma.bot.update({ where: { id }, data });
  }

  /** Marca un bot como el predeterminado y desmarca el resto, en una transaccion. */
  async setDefault(tenantId: string, id: string) {
    await this.findOneOrThrow(tenantId, id);
    await this.prisma.$transaction([
      this.prisma.bot.updateMany({ where: { tenantId }, data: { isDefault: false } }),
      this.prisma.bot.update({ where: { id }, data: { isDefault: true } }),
    ]);
    return this.list(tenantId);
  }

  /**
   * Copia el bot con todo su arbol de menu. La copia no queda asignada a ninguna linea:
   * es para armar uno nuevo partiendo de otro, no para cambiar lo que atiende hoy.
   */
  async duplicate(tenantId: string, id: string, name?: string) {
    const source = await this.findOneOrThrow(tenantId, id);
    const nodes = await this.prisma.tenantMenuNode.findMany({ where: { botId: source.id } });

    // Los ids nuevos se generan aca para poder reescribir parentId antes de insertar.
    const newIds = new Map(nodes.map((n) => [n.id, randomUUID()]));
    const copyId = randomUUID();

    // Padres antes que hijos: la FK de parentId se valida fila por fila.
    const byParent = new Map<string | null, typeof nodes>();
    for (const n of nodes) {
      const siblings = byParent.get(n.parentId) ?? [];
      siblings.push(n);
      byParent.set(n.parentId, siblings);
    }
    const ordered: typeof nodes = [];
    const queue: (string | null)[] = [null];
    while (queue.length) {
      const parentId = queue.shift()!;
      for (const child of byParent.get(parentId) ?? []) {
        ordered.push(child);
        queue.push(child.id);
      }
    }

    await this.prisma.$transaction([
      this.prisma.bot.create({
        data: {
          id: copyId,
          tenantId,
          name: this.cleanName(name?.trim() || `${source.name} (copia)`),
          aiKnowledgeBase: source.aiKnowledgeBase,
          startInAiChat: source.startInAiChat,
          isDefault: false,
        },
      }),
      this.prisma.tenantMenuNode.createMany({
        data: ordered.map((n) => ({
          id: newIds.get(n.id)!,
          tenantId,
          botId: copyId,
          parentId: n.parentId ? newIds.get(n.parentId)! : null,
          type: n.type,
          title: n.title,
          subtitle: n.subtitle,
          bodyText: n.bodyText,
          promptText: n.promptText,
          config: n.config ?? undefined,
          active: n.active,
          sortOrder: n.sortOrder,
        })),
      }),
    ]);

    return this.findOneOrThrow(tenantId, copyId);
  }

  /**
   * Borra el bot y su arbol. Las lineas que lo usaban pasan al predeterminado (FK SET
   * NULL); el predeterminado no se puede borrar, porque esas lineas se quedarian sin
   * a quien caer.
   */
  async remove(tenantId: string, id: string) {
    const bot = await this.findOneOrThrow(tenantId, id);
    if (bot.isDefault) {
      throw new BadRequestException('No se puede eliminar el bot predeterminado. Marca otro como predeterminado primero.');
    }
    await this.prisma.bot.delete({ where: { id } });
    return this.list(tenantId);
  }

  // ─── Métricas ──────────────────────────────────────────────────────────────

  /** Sin botId, las de todos los bots juntos. */
  async getStats(tenantId: string, period: StatsPeriod, botId?: string) {
    const since = getPeriodStart(period);

    const counts = await this.prisma.auditLog.groupBy({
      by: ['action'],
      where: {
        tenantId,
        action: { in: STATS_ACTIONS as unknown as string[] },
        createdAt: { gte: since },
        ...(botId && { conversation: { botId } }),
      },
      _count: { _all: true },
    });

    const byAction = new Map(counts.map((c) => [c.action, c._count._all]));
    const started = byAction.get('bot.started') ?? 0;
    const resolvedByBot = byAction.get('bot.resolved_without_agent') ?? 0;
    const handedOff = byAction.get('conversation.bot_handoff') ?? 0;
    const orderLookups = byAction.get('conversation.order_lookup_requested') ?? 0;

    return {
      period,
      botId: botId ?? null,
      started,
      resolvedByBot,
      handedOff,
      orderLookups,
      resolutionRate: started > 0 ? Math.round((resolvedByBot / started) * 1000) / 10 : 0,
    };
  }

  private cleanName(name: string | undefined) {
    const clean = name?.trim();
    if (!clean) throw new BadRequestException('El bot necesita un nombre');
    return clean.slice(0, NAME_MAX_LENGTH);
  }
}
