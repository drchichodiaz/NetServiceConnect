import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type Period = 'today' | 'week' | 'month';

@Injectable()
export class StatsService {
  constructor(private prisma: PrismaService) {}

  async getStats(tenantId: string, period: Period) {
    const since = this.periodStart(period);

    const [conversations, messages, chartMessages, agentData, tagData, users] =
      await Promise.all([
        // Conversations summary
        this.prisma.conversation.findMany({
          where: { tenantId, createdAt: { gte: since } },
          select: { status: true, assignedUserId: true },
        }),

        // Message totals for the period
        this.prisma.message.aggregate({
          where: { tenantId, createdAt: { gte: since } },
          _count: true,
        }),

        // Messages for chart (always last 7 days)
        this.prisma.message.findMany({
          where: { tenantId, createdAt: { gte: this.periodStart('week') } },
          select: { direction: true, createdAt: true },
        }),

        // Agent conversation counts (ALL open, not filtered by period)
        this.prisma.conversation.findMany({
          where: { tenantId, assignedUserId: { not: null } },
          select: { assignedUserId: true, status: true, createdAt: true },
        }),

        // Tag stats
        this.prisma.conversationTag.groupBy({
          by: ['tagId'],
          where: { conversation: { tenantId } },
          _count: { tagId: true },
          orderBy: { _count: { tagId: 'desc' } },
          take: 6,
        }),

        // Users list
        this.prisma.user.findMany({
          where: { tenantId },
          select: { id: true, name: true },
        }),
      ]);

    // ── Conversation totals ──────────────────────────────────────────────────
    const convTotals = {
      total:   conversations.length,
      open:    conversations.filter((c) => c.status === 'OPEN').length,
      pending: conversations.filter((c) => c.status === 'PENDING').length,
      closed:  conversations.filter((c) => c.status === 'CLOSED').length,
    };

    // ── Chart: last 7 days ───────────────────────────────────────────────────
    const chart = Array.from({ length: 7 }, (_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - (6 - i));

      const dayMsgs = chartMessages.filter((m) => {
        const md = new Date(m.createdAt);
        return (
          md.getFullYear() === date.getFullYear() &&
          md.getMonth()    === date.getMonth() &&
          md.getDate()     === date.getDate()
        );
      });

      const label =
        i === 6
          ? 'Hoy'
          : date.toLocaleDateString('es', { weekday: 'short' }).replace('.', '');

      return {
        dia:       label,
        entrantes: dayMsgs.filter((m) => m.direction === 'INBOUND').length,
        salientes: dayMsgs.filter((m) => m.direction === 'OUTBOUND').length,
      };
    });

    // ── Agent stats ──────────────────────────────────────────────────────────
    const agents = users
      .map((u) => {
        const mine = agentData.filter((c) => c.assignedUserId === u.id);
        const open   = mine.filter((c) => c.status === 'OPEN').length;
        const closed = mine.filter(
          (c) => c.status === 'CLOSED' && new Date(c.createdAt) >= since,
        ).length;
        const total = open + closed;
        return {
          id:         u.id,
          name:       u.name,
          openChats:  open,
          resolved:   closed,
          total,
          rate:       total > 0 ? Math.round((closed / total) * 100) : 0,
        };
      })
      .filter((a) => a.total > 0)
      .sort((a, b) => b.total - a.total);

    // ── Tag stats ────────────────────────────────────────────────────────────
    const tagIds = tagData.map((t) => t.tagId);
    const tagDetails = tagIds.length
      ? await this.prisma.tag.findMany({
          where: { id: { in: tagIds } },
          select: { id: true, name: true, color: true },
        })
      : [];

    const maxTagCount = tagData[0]?._count.tagId ?? 1;
    const tags = tagData.map((t) => {
      const detail = tagDetails.find((d) => d.id === t.tagId);
      return {
        id:    t.tagId,
        name:  detail?.name  ?? 'Etiqueta',
        color: detail?.color ?? '#25D366',
        count: t._count.tagId,
        pct:   Math.round((t._count.tagId / maxTagCount) * 100),
      };
    });

    return {
      period,
      conversations: convTotals,
      messages: messages._count,
      chart,
      agents,
      tags,
    };
  }

  private periodStart(period: Period): Date {
    const d = new Date();
    if (period === 'today') {
      d.setHours(0, 0, 0, 0);
    } else if (period === 'week') {
      d.setDate(d.getDate() - 6);
      d.setHours(0, 0, 0, 0);
    } else {
      d.setDate(d.getDate() - 29);
      d.setHours(0, 0, 0, 0);
    }
    return d;
  }
}
