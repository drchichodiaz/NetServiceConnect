import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { getPeriodStart, StatsPeriod } from '../common/period-range';

@Injectable()
export class StatsService {
  constructor(private prisma: PrismaService) {}

  async getStats(tenantId: string, period: StatsPeriod) {
    const since = getPeriodStart(period);

    const [
      conversations,
      messages,
      chartMessages,
      agentData,
      tagData,
      users,
      lineConvData,
      lineBotData,
      lineMsgData,
      accounts,
    ] = await Promise.all([
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
          where: { tenantId, createdAt: { gte: getPeriodStart('week') } },
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

        // ── Comparativa por linea (sucursal) ─────────────────────────────────
        // Conversaciones del periodo por linea y estado.
        this.prisma.conversation.groupBy({
          by: ['whatsappAccountId', 'status'],
          where: { tenantId, createdAt: { gte: since } },
          _count: { _all: true },
        }),

        // Conversaciones que el bot cerro sin pasar por un humano.
        this.prisma.conversation.groupBy({
          by: ['whatsappAccountId'],
          where: { tenantId, createdAt: { gte: since }, closedReason: 'BOT_RESOLVED' },
          _count: { _all: true },
        }),

        // Mensajes por linea y direccion. Va en SQL crudo porque Message no guarda
        // la linea (la tiene la conversacion) y Prisma no agrupa por campo de relacion.
        this.prisma.$queryRaw<Array<{ accountId: string | null; direction: string; count: number }>>`
          SELECT c."whatsappAccountId" AS "accountId", m."direction", COUNT(*)::int AS "count"
          FROM "Message" m
          JOIN "Conversation" c ON c."id" = m."conversationId"
          WHERE m."tenantId" = ${tenantId} AND m."createdAt" >= ${since}
          GROUP BY 1, 2
        `,

        this.prisma.whatsAppAccount.findMany({
          where: { tenantId },
          select: { id: true, label: true, phoneNumber: true, isActive: true },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
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

    // ── Comparativa por linea ────────────────────────────────────────────────
    // Se incluye una fila "Sin linea" si quedaron conversaciones sin asignar (previas
    // al multi-numero, o huerfanas al desconectar una linea): preferimos que los
    // numeros cierren contra el total a que desaparezcan sin explicacion.
    const lineRows = new Map<
      string | null,
      { conversations: number; open: number; closed: number; botResolved: number; inbound: number; outbound: number }
    >();
    const emptyRow = () => ({ conversations: 0, open: 0, closed: 0, botResolved: 0, inbound: 0, outbound: 0 });
    const rowFor = (id: string | null) => {
      if (!lineRows.has(id)) lineRows.set(id, emptyRow());
      return lineRows.get(id)!;
    };

    for (const r of lineConvData) {
      const row = rowFor(r.whatsappAccountId);
      row.conversations += r._count._all;
      if (r.status === 'OPEN') row.open += r._count._all;
      if (r.status === 'CLOSED') row.closed += r._count._all;
    }
    for (const r of lineBotData) {
      rowFor(r.whatsappAccountId).botResolved += r._count._all;
    }
    for (const r of lineMsgData) {
      const row = rowFor(r.accountId);
      if (r.direction === 'INBOUND') row.inbound += Number(r.count);
      else if (r.direction === 'OUTBOUND') row.outbound += Number(r.count);
    }

    const lines = [...lineRows.entries()]
      .map(([accountId, row]) => {
        const account = accountId ? accounts.find((a) => a.id === accountId) : null;
        return {
          id: accountId ?? 'none',
          name: account?.label?.trim() || account?.phoneNumber || 'Sin línea',
          phoneNumber: account?.phoneNumber ?? null,
          isActive: account?.isActive ?? false,
          ...row,
          // Que porcentaje de las conversaciones de esa linea resolvio el bot solo.
          botRate: row.conversations > 0 ? Math.round((row.botResolved / row.conversations) * 100) : 0,
        };
      })
      .sort((a, b) => b.conversations - a.conversations);

    // Lineas activas sin nada de actividad en el periodo: se agregan en cero para que
    // una sucursal muda se vea como tal en vez de faltar de la comparativa.
    for (const account of accounts) {
      if (!account.isActive) continue;
      if (lines.some((l) => l.id === account.id)) continue;
      lines.push({
        id: account.id,
        name: account.label?.trim() || account.phoneNumber || 'Sin nombre',
        phoneNumber: account.phoneNumber ?? null,
        isActive: true,
        ...emptyRow(),
        botRate: 0,
      });
    }

    return {
      period,
      conversations: convTotals,
      messages: messages._count,
      chart,
      agents,
      tags,
      lines,
    };
  }
}
