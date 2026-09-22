import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { AiLotKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/services/crypto.service';
import { AiWalletService } from './ai-wallet.service';
import { AiPricingService } from './ai-pricing.service';
import { getPeriodStart, StatsPeriod } from '../common/period-range';

const round = (n: number, decimals = 6) => Math.round(n * 10 ** decimals) / 10 ** decimals;

/** Los umbrales de aviso de la especificacion. El 100 % es el corte. */
export const ALERT_THRESHOLDS = [50, 75, 90, 100];

/**
 * Lo que las pantallas necesitan saber del saldo: el panel del super admin (costo,
 * margen, carga de creditos) y el de la empresa (su saldo y su consumo).
 *
 * Son dos vistas distintas a proposito: el cliente nunca ve el costo del proveedor ni
 * el margen. Eso es de quien opera el servidor.
 */
@Injectable()
export class AiCreditsService {
  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private wallet: AiWalletService,
    private pricing: AiPricingService,
  ) {}

  // ─── Configuracion de la plataforma (super admin) ───────────────────────────

  async getPlatformSettings() {
    const config = await this.prisma.systemConfig.findUnique({ where: { id: '1' } });
    const key = config?.aiPlatformApiKey ? this.crypto.decrypt(config.aiPlatformApiKey) : null;

    return {
      // Nunca se devuelve la clave: solo si existe y sus ultimos caracteres, igual que
      // en el resto de la configuracion sensible.
      hasPlatformKey: !!key,
      platformKeyPreview: key ? `sk-...${key.slice(-6)}` : null,
      platformModel: config?.aiPlatformModel || 'gpt-4o-mini',
      markupFactor: Number(config?.aiMarkupFactor ?? 2),
      creditUsdValue: Number(config?.aiCreditUsdValue ?? 0.001),
      minCreditsPerOp: config?.aiMinCreditsPerOp ?? 1,
    };
  }

  async updatePlatformSettings(data: {
    platformApiKey?: string;
    platformModel?: string;
    markupFactor?: number;
    creditUsdValue?: number;
    minCreditsPerOp?: number;
  }) {
    const payload: any = {};

    // La clave se guarda cifrada. Un valor que empieza con "sk-..." es el preview que
    // devolvio el GET, no una clave nueva: se ignora para no pisar la buena.
    if (data.platformApiKey !== undefined) {
      const raw = data.platformApiKey.trim();
      if (raw === '') payload.aiPlatformApiKey = null;
      else if (!raw.startsWith('sk-...')) payload.aiPlatformApiKey = this.crypto.encrypt(raw);
    }
    if (data.platformModel) payload.aiPlatformModel = data.platformModel;
    if (data.markupFactor !== undefined) {
      if (data.markupFactor <= 0) throw new BadRequestException('El markup tiene que ser mayor que cero');
      payload.aiMarkupFactor = data.markupFactor;
    }
    if (data.creditUsdValue !== undefined) {
      if (data.creditUsdValue <= 0) throw new BadRequestException('El valor del crédito tiene que ser mayor que cero');
      payload.aiCreditUsdValue = data.creditUsdValue;
    }
    if (data.minCreditsPerOp !== undefined) {
      if (data.minCreditsPerOp < 0) throw new BadRequestException('El mínimo por operación no puede ser negativo');
      payload.aiMinCreditsPerOp = Math.floor(data.minCreditsPerOp);
    }

    await this.prisma.systemConfig.upsert({
      where: { id: '1' },
      create: { id: '1', ...payload },
      update: payload,
    });
    return this.getPlatformSettings();
  }

  // ─── Panel del super admin ──────────────────────────────────────────────────

  /** Todas las empresas con su modo de cobro, su saldo y lo que consumieron. */
  async overview(period: StatsPeriod = 'month') {
    const from = getPeriodStart(period);
    const { creditUsdValue } = await this.pricing.getParams();

    const [tenants, wallets, usage] = await Promise.all([
      this.prisma.tenant.findMany({
        where: { isActive: true },
        select: { id: true, name: true, aiBillingMode: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.aiWallet.findMany(),
      this.prisma.aiUsage.groupBy({
        by: ['tenantId'],
        where: { createdAt: { gte: from } },
        _count: { _all: true },
        _sum: { costMicros: true, credits: true },
      }),
    ]);

    const walletOf = new Map(wallets.map((w) => [w.tenantId, w]));
    const usageOf = new Map(usage.map((u) => [u.tenantId, u]));

    return {
      period,
      from,
      creditUsdValue,
      tenants: tenants.map((t) => {
        const w = walletOf.get(t.id);
        const u = usageOf.get(t.id);
        const costUsd = (u?._sum.costMicros ?? 0) / 1_000_000;
        const credits = u?._sum.credits ?? 0;
        const revenueUsd = credits * creditUsdValue;

        return {
          tenantId: t.id,
          name: t.name,
          billingMode: t.aiBillingMode,
          aiEnabled: w?.aiEnabled ?? true,
          balance: w?.balance ?? 0,
          reserved: w?.reserved ?? 0,
          spendable: w?.spendable ?? 0,
          calls: u?._count._all ?? 0,
          creditsUsed: credits,
          costUsd: round(costUsd),
          revenueUsd: round(revenueUsd),
          marginUsd: round(revenueUsd - costUsd),
        };
      }),
    };
  }

  /** El detalle de una empresa: sus lotes vivos y sus ultimos movimientos. */
  async tenantDetail(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, aiBillingMode: true },
    });
    if (!tenant) throw new NotFoundException('Empresa no encontrada');

    const [wallet, lots, entries] = await Promise.all([
      this.wallet.getWallet(tenantId),
      this.prisma.aiCreditLot.findMany({
        where: { tenantId, closedAt: null },
        orderBy: [{ expiresAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
      }),
      this.prisma.aiCreditEntry.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
    ]);

    return {
      tenant,
      wallet: wallet ?? { tenantId, balance: 0, reserved: 0, spendable: 0, aiEnabled: true },
      lots,
      entries,
    };
  }

  async grant(
    tenantId: string,
    data: { kind?: AiLotKind; credits: number; expiresAt?: string | null; note?: string },
    createdByUserId: string,
  ) {
    if (!data.credits || data.credits < 1) throw new BadRequestException('Indica cuántos créditos acreditar');
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!tenant) throw new NotFoundException('Empresa no encontrada');

    return this.wallet.grant(tenantId, {
      kind: data.kind ?? 'PURCHASE',
      credits: Math.floor(data.credits),
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      note: data.note?.trim() || null,
      createdByUserId,
    });
  }

  /**
   * Cambia como paga la IA una empresa, o le apaga la IA sin tocarle el saldo.
   *
   * Pasar a PLATFORM le crea la billetera si no la tenia, para que el primer intento
   * falle por "sin saldo" (que es cierto) y no por "sin billetera" (que seria un
   * detalle interno filtrandose a la pantalla).
   */
  async updateTenant(tenantId: string, data: { billingMode?: 'BYOK' | 'PLATFORM'; aiEnabled?: boolean }) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!tenant) throw new NotFoundException('Empresa no encontrada');

    if (data.billingMode) {
      await this.prisma.tenant.update({ where: { id: tenantId }, data: { aiBillingMode: data.billingMode } });
      if (data.billingMode === 'PLATFORM') await this.wallet.ensureWallet(tenantId);
    }

    if (data.aiEnabled !== undefined) {
      await this.wallet.ensureWallet(tenantId);
      await this.prisma.aiWallet.update({ where: { tenantId }, data: { aiEnabled: data.aiEnabled } });
    }

    return this.tenantDetail(tenantId);
  }

  // ─── Lo que ve la empresa ───────────────────────────────────────────────────

  /**
   * Cuanto lleva consumido una empresa de lo que tiene, en porcentaje.
   *
   * Lo usan la pantalla del cliente y los avisos por correo, a proposito: si cada uno
   * calculara lo suyo, el correo podria decir 90 % y la pantalla 72 %, y ahi se pierde
   * la confianza en el saldo entero.
   */
  async usageSnapshot(tenantId: string, period: StatsPeriod = 'month') {
    const from = getPeriodStart(period);

    const [wallet, lots, used] = await Promise.all([
      this.wallet.getWallet(tenantId),
      this.prisma.aiCreditLot.findMany({
        where: { tenantId, closedAt: null },
        orderBy: [{ expiresAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
        select: { id: true, kind: true, credits: true, remaining: true, expiresAt: true, createdAt: true },
      }),
      this.prisma.aiUsage.aggregate({
        where: { tenantId, createdAt: { gte: from }, billed: true },
        _sum: { credits: true },
        _count: { _all: true },
      }),
    ]);

    const balance = wallet?.balance ?? 0;
    const creditsUsed = used._sum.credits ?? 0;
    // Lo incluido del periodo, para poder decir "vas por el 27 % de tu plan". Sin
    // asignacion mensual se mide contra lo consumido mas lo que queda, que es lo unico
    // honesto que se puede decir sin un plan detras.
    const included = lots.filter((l) => l.kind === 'MONTHLY_ALLOCATION').reduce((n, l) => n + l.credits, 0);
    const reference = included > 0 ? included : creditsUsed + balance;
    const usagePercent = reference > 0 ? Math.min(100, Math.round((creditsUsed / reference) * 100)) : 0;

    return {
      wallet,
      lots,
      balance,
      creditsUsed,
      calls: used._count._all,
      usagePercent,
      nextExpiration: lots.find((l) => l.expiresAt)?.expiresAt ?? null,
    };
  }

  /**
   * El saldo de la propia empresa. No incluye costo del proveedor ni margen: eso es
   * informacion nuestra, no suya.
   */
  async myCredits(tenantId: string, period: StatsPeriod = 'month') {
    const [tenant, snap, entries] = await Promise.all([
      this.prisma.tenant.findUnique({ where: { id: tenantId }, select: { aiBillingMode: true } }),
      this.usageSnapshot(tenantId, period),
      this.prisma.aiCreditEntry.findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: 20,
        select: { id: true, kind: true, credits: true, balanceAfter: true, note: true, createdAt: true },
      }),
    ]);

    return {
      billingMode: tenant?.aiBillingMode ?? 'BYOK',
      enabled: snap.wallet?.aiEnabled ?? true,
      balance: snap.balance,
      reserved: snap.wallet?.reserved ?? 0,
      creditsUsed: snap.creditsUsed,
      calls: snap.calls,
      usagePercent: snap.usagePercent,
      // La proxima fecha en la que se pierde algo. Null = nada vence.
      nextExpiration: snap.nextExpiration,
      lots: snap.lots,
      entries,
    };
  }
}
