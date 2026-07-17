import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getPeriodStart, StatsPeriod } from '../common/period-range';

const STATS_ACTIONS = [
  'bot.started',
  'bot.resolved_without_agent',
  'conversation.bot_handoff',
  'conversation.order_lookup_requested',
] as const;

@Injectable()
export class BotConfigService {
  constructor(private prisma: PrismaService) {}

  async getConfig(tenantId: string) {
    const config = await this.prisma.tenantBotConfig.findUnique({ where: { tenantId } });
    return { orderStatusApiUrl: config?.orderStatusApiUrl ?? '' };
  }

  async updateConfig(tenantId: string, dto: { orderStatusApiUrl?: string }) {
    const data: any = {};
    if (dto.orderStatusApiUrl !== undefined) data.orderStatusApiUrl = dto.orderStatusApiUrl.trim() || null;

    await this.prisma.tenantBotConfig.upsert({
      where: { tenantId },
      update: data,
      create: { tenantId, ...data },
    });

    return this.getConfig(tenantId);
  }

  // ─── Métricas básicas del bot ──────────────────────────────────────────────

  async getStats(tenantId: string, period: StatsPeriod) {
    const since = getPeriodStart(period);

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
      period,
      started,
      resolvedByBot,
      handedOff,
      orderLookups,
      resolutionRate: started > 0 ? Math.round((resolvedByBot / started) * 1000) / 10 : 0,
    };
  }
}
