import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Lo que hace falta para valorizar una llamada, ya resuelto contra la tabla de precios. */
export interface PricedUsage {
  /** Costo del proveedor en millonesimas de dolar (1.000.000 = US$1). */
  costMicros: number;
  /** Creditos que corresponden a la operacion, con markup y minimo ya aplicados. */
  credits: number;
  /** Fila de precios con la que se calculo. Null = no habia precio cargado para el modelo. */
  priceId: string | null;
  markupFactor: number;
}

export interface TokenCounts {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

/** Valores de arranque si SystemConfig todavia no existe (instalacion nueva). */
const DEFAULTS = { markupFactor: 2, creditUsdValue: 0.001, minCreditsPerOp: 1 };

/**
 * Traduce tokens a plata: costo real del proveedor y creditos comerciales.
 *
 * Las dos lecturas (precio del modelo y parametros comerciales) se hacen frescas en
 * cada llamada, igual que el bot relee la info del negocio en cada turno: son dos
 * consultas por indice al lado de una llamada de varios segundos a OpenAI, y a cambio
 * un cambio de precio o de markup tiene efecto inmediato en vez de "cuando expire
 * algun cache".
 */
@Injectable()
export class AiPricingService {
  private readonly logger = new Logger(AiPricingService.name);

  constructor(private prisma: PrismaService) {}

  /** Markup, valor del credito y minimo por operacion, tal como estan configurados hoy. */
  async getParams(): Promise<{ markupFactor: number; creditUsdValue: number; minCredits: number }> {
    const config = await this.prisma.systemConfig.findUnique({ where: { id: '1' } });
    return {
      markupFactor: Number(config?.aiMarkupFactor ?? DEFAULTS.markupFactor),
      // Un valor de credito en cero dividiria por cero mas abajo: se cae al default.
      creditUsdValue: Number(config?.aiCreditUsdValue ?? DEFAULTS.creditUsdValue) || DEFAULTS.creditUsdValue,
      minCredits: config?.aiMinCreditsPerOp ?? DEFAULTS.minCreditsPerOp,
    };
  }

  async price(provider: string, model: string, tokens: TokenCounts, at: Date = new Date()): Promise<PricedUsage> {
    const [row, params] = await Promise.all([
      this.prisma.aiPrice.findFirst({
        where: { provider, model, effectiveFrom: { lte: at } },
        orderBy: { effectiveFrom: 'desc' },
      }),
      this.getParams(),
    ]);

    const { markupFactor, creditUsdValue, minCredits } = params;

    if (!row) {
      // Sin precio no se puede valorizar, pero los tokens ya se gastaron: se registra
      // igual con costo cero y queda el aviso. El costo se recalcula despues cargando
      // el precio que faltaba — por eso los tokens son la fuente de verdad y no el costo.
      this.logger.warn(`Sin precio cargado para ${provider}/${model}: el uso se registra sin costo.`);
      return { costMicros: 0, credits: 0, priceId: null, markupFactor };
    }

    // Los tokens servidos desde el cache del proveedor ya vienen incluidos en el total
    // de entrada, asi que se descuentan para no cobrarlos dos veces.
    const freshInput = Math.max(0, tokens.inputTokens - tokens.cachedInputTokens);
    const costUsd =
      (freshInput / 1_000_000) * Number(row.inputPerMTok) +
      (tokens.cachedInputTokens / 1_000_000) * Number(row.cachedInputPerMTok) +
      (tokens.outputTokens / 1_000_000) * Number(row.outputPerMTok);

    const credits = Math.max(minCredits, Math.ceil((costUsd * markupFactor) / creditUsdValue));

    return {
      costMicros: Math.round(costUsd * 1_000_000),
      credits,
      priceId: row.id,
      markupFactor,
    };
  }
}
