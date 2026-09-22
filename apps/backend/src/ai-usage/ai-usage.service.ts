import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiPricingService } from './ai-pricing.service';
import { getPeriodStart, StatsPeriod } from '../common/period-range';

const round = (n: number, decimals = 6) => Math.round(n * 10 ** decimals) / 10 ** decimals;

/**
 * Lo que la medicion contesta: cuanto nos cuesta la IA de cada cliente y cuanto
 * valdria comercialmente lo que consume.
 *
 * Es la pregunta que hoy nadie puede responder, y la razon por la que esta fase existe
 * antes de cobrar: ponerle precio a los paquetes sin este numero es adivinar.
 */
@Injectable()
export class AiUsageService {
  constructor(
    private prisma: PrismaService,
    private pricing: AiPricingService,
  ) {}

  async summary(period: StatsPeriod = 'month') {
    const from = getPeriodStart(period);
    const where = { createdAt: { gte: from } };
    const { creditUsdValue, markupFactor } = await this.pricing.getParams();

    const [byTenant, byFeature, errors, tenants] = await Promise.all([
      this.prisma.aiUsage.groupBy({
        by: ['tenantId'],
        where,
        _count: { _all: true },
        _sum: { inputTokens: true, cachedInputTokens: true, outputTokens: true, costMicros: true, credits: true },
      }),
      this.prisma.aiUsage.groupBy({
        by: ['feature'],
        where,
        _count: { _all: true },
        _sum: { costMicros: true, credits: true },
      }),
      this.prisma.aiUsage.groupBy({
        by: ['tenantId'],
        where: { ...where, error: { not: null } },
        _count: { _all: true },
      }),
      this.prisma.tenant.findMany({ select: { id: true, name: true } }),
    ]);

    const nameOf = new Map(tenants.map((t) => [t.id, t.name]));
    const errorsOf = new Map(errors.map((e) => [e.tenantId, e._count._all]));

    // Importes sin redondear. El redondeo va SOLO al salir: redondeando antes, los
    // totales sumarian valores ya recortados y con consumo chico el costo se convierte
    // en cero y el margen aparece como 100 % — justo la clase de numero que haria fijar
    // mal un precio.
    const raw = byTenant
      .map((r) => {
        const credits = r._sum.credits ?? 0;
        return {
          tenantId: r.tenantId,
          name: nameOf.get(r.tenantId) ?? '(empresa eliminada)',
          calls: r._count._all,
          errors: errorsOf.get(r.tenantId) ?? 0,
          inputTokens: r._sum.inputTokens ?? 0,
          cachedInputTokens: r._sum.cachedInputTokens ?? 0,
          outputTokens: r._sum.outputTokens ?? 0,
          credits,
          costUsd: (r._sum.costMicros ?? 0) / 1_000_000,
          /** Lo que se le habria facturado al cliente por ese consumo. */
          revenueUsd: credits * creditUsdValue,
        };
      })
      .sort((a, b) => b.costUsd - a.costUsd);

    const sum = (pick: (r: (typeof raw)[number]) => number) => raw.reduce((acc, r) => acc + pick(r), 0);
    const totalCost = sum((r) => r.costUsd);
    const totalRevenue = sum((r) => r.revenueUsd);
    const margin = (revenue: number, cost: number) => ({
      marginUsd: round(revenue - cost),
      marginPercent: revenue > 0 ? round(((revenue - cost) / revenue) * 100, 1) : 0,
    });

    return {
      period,
      from,
      // Con que parametros se valorizo. Van en la respuesta para que el margen se pueda
      // leer sin ir a buscar la configuracion a otra pantalla.
      creditUsdValue,
      markupFactor,
      totals: {
        calls: sum((r) => r.calls),
        errors: sum((r) => r.errors),
        inputTokens: sum((r) => r.inputTokens),
        outputTokens: sum((r) => r.outputTokens),
        credits: sum((r) => r.credits),
        costUsd: round(totalCost),
        revenueUsd: round(totalRevenue),
        ...margin(totalRevenue, totalCost),
      },
      tenants: raw.map((r) => ({
        ...r,
        costUsd: round(r.costUsd),
        revenueUsd: round(r.revenueUsd),
        ...margin(r.revenueUsd, r.costUsd),
      })),
      features: byFeature.map((f) => ({
        feature: f.feature,
        calls: f._count._all,
        credits: f._sum.credits ?? 0,
        costUsd: round((f._sum.costMicros ?? 0) / 1_000_000),
      })),
    };
  }

  /** El detalle de un cliente, para cuando el total no alcanza y hay que mirar adentro. */
  async byTenant(tenantId: string, period: StatsPeriod = 'month', limit = 100) {
    const from = getPeriodStart(period);
    return this.prisma.aiUsage.findMany({
      where: { tenantId, createdAt: { gte: from } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 500),
      select: {
        id: true, feature: true, model: true, inputTokens: true, cachedInputTokens: true,
        outputTokens: true, costMicros: true, credits: true, error: true,
        conversationId: true, userId: true, createdAt: true,
      },
    });
  }
}
