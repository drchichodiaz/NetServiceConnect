import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface BranchDto {
  name: string;
  address: string;
  scheduleText?: string;
  phone?: string;
  mapsUrl?: string;
  servicesText?: string;
  active?: boolean;
  sortOrder?: number;
}

const STATS_ACTIONS = [
  'bot.started',
  'bot.resolved_without_agent',
  'conversation.bot_handoff',
  'conversation.order_lookup_requested',
] as const;

const RANGE_TO_MS: Record<string, number> = {
  today: 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

@Injectable()
export class BotConfigService {
  constructor(private prisma: PrismaService) {}

  async getConfig(tenantId: string) {
    const config = await this.prisma.tenantBotConfig.findUnique({ where: { tenantId } });

    return {
      horariosText: config?.horariosText ?? '',
      sucursalesText: config?.sucursalesText ?? '',
      serviciosText: config?.serviciosText ?? '',
      orderStatusApiUrl: config?.orderStatusApiUrl ?? '',
    };
  }

  async updateConfig(
    tenantId: string,
    dto: { horariosText?: string; sucursalesText?: string; serviciosText?: string; orderStatusApiUrl?: string },
  ) {
    const data: any = {};
    if (dto.horariosText !== undefined) data.horariosText = dto.horariosText.trim() || null;
    if (dto.sucursalesText !== undefined) data.sucursalesText = dto.sucursalesText.trim() || null;
    if (dto.serviciosText !== undefined) data.serviciosText = dto.serviciosText.trim() || null;
    if (dto.orderStatusApiUrl !== undefined) data.orderStatusApiUrl = dto.orderStatusApiUrl.trim() || null;

    await this.prisma.tenantBotConfig.upsert({
      where: { tenantId },
      update: data,
      create: { tenantId, ...data },
    });

    return this.getConfig(tenantId);
  }

  // ─── Sucursales ────────────────────────────────────────────────────────────

  listBranches(tenantId: string) {
    return this.prisma.tenantBranch.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  createBranch(tenantId: string, dto: BranchDto) {
    return this.prisma.tenantBranch.create({
      data: {
        tenantId,
        name: dto.name.trim(),
        address: dto.address.trim(),
        scheduleText: dto.scheduleText?.trim() || null,
        phone: dto.phone?.trim() || null,
        mapsUrl: dto.mapsUrl?.trim() || null,
        servicesText: dto.servicesText?.trim() || null,
        active: dto.active ?? true,
        sortOrder: dto.sortOrder ?? 0,
      },
    });
  }

  async updateBranch(tenantId: string, id: string, dto: Partial<BranchDto>) {
    const existing = await this.prisma.tenantBranch.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Sucursal no encontrada');

    return this.prisma.tenantBranch.update({
      where: { id },
      data: {
        ...(dto.name !== undefined && { name: dto.name.trim() }),
        ...(dto.address !== undefined && { address: dto.address.trim() }),
        ...(dto.scheduleText !== undefined && { scheduleText: dto.scheduleText.trim() || null }),
        ...(dto.phone !== undefined && { phone: dto.phone.trim() || null }),
        ...(dto.mapsUrl !== undefined && { mapsUrl: dto.mapsUrl.trim() || null }),
        ...(dto.servicesText !== undefined && { servicesText: dto.servicesText.trim() || null }),
        ...(dto.active !== undefined && { active: dto.active }),
        ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      },
    });
  }

  async removeBranch(tenantId: string, id: string) {
    const existing = await this.prisma.tenantBranch.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Sucursal no encontrada');
    return this.prisma.tenantBranch.delete({ where: { id } });
  }

  // ─── Métricas básicas del bot ──────────────────────────────────────────────

  async getStats(tenantId: string, range: string) {
    const windowMs = RANGE_TO_MS[range] ?? RANGE_TO_MS['today'];
    const since = new Date(Date.now() - windowMs);

    const counts = await this.prisma.auditLog.groupBy({
      by: ['action'],
      where: { tenantId, action: { in: STATS_ACTIONS as unknown as string[] }, createdAt: { gte: since } },
      _count: { _all: true },
    });

    const byAction = new Map(counts.map((c) => [c.action, c._count._all]));
    const started = byAction.get('bot.started') ?? 0;
    const resolvedByBot = byAction.get('bot.resolved_without_agent') ?? 0;
    const handedOff = byAction.get('conversation.bot_handoff') ?? 0;
    const orderLookups = byAction.get('conversation.order_lookup_requested') ?? 0;

    return {
      range,
      started,
      resolvedByBot,
      handedOff,
      orderLookups,
      resolutionRate: started > 0 ? Math.round((resolvedByBot / started) * 1000) / 10 : 0,
    };
  }
}
