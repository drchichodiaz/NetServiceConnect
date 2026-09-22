import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { OpenAiClientService } from './openai-client.service';
import { AiPricingService } from './ai-pricing.service';
import { AiWalletService } from './ai-wallet.service';

/** Para que se uso la IA. Se guarda tal cual en AiUsage.feature. */
export type AiFeature = 'bot_ai_chat' | 'agent_suggestion';

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AiChatRequest {
  feature: AiFeature;
  messages: AiChatMessage[];
  maxTokens: number;
  temperature?: number;
  /** Quien lo origino. Uno de los dos, segun la funcionalidad. */
  conversationId?: string | null;
  userId?: string | null;
  /** Para reintentar una operacion sin registrarla (ni cobrarla) dos veces. */
  requestId?: string;
}

export type AiUnavailableReason =
  | 'NOT_CONFIGURED'
  | 'NO_CREDITS'
  | 'AI_DISABLED'
  | 'PROVIDER_ERROR'
  | 'EMPTY_RESPONSE';

export type AiChatResult =
  | { ok: true; text: string; credits: number }
  | { ok: false; reason: AiUnavailableReason };

/**
 * El unico lugar del sistema donde se gasta IA.
 *
 * Existe para que no haya forma de llamar al proveedor sin que quede medido y cobrado:
 * el cliente de OpenAI se resuelve aca adentro y no se expone a nadie mas. Si manana
 * alguien agrega una funcionalidad con IA, o pasa por este servicio o no compila.
 *
 * En modo PLATFORM el orden es autorizar → llamar → liquidar: **sin saldo no hay
 * llamada**. En modo BYOK paga el tenant con su clave, asi que se mide pero no se cobra.
 */
@Injectable()
export class AiGatewayService {
  private readonly logger = new Logger(AiGatewayService.name);

  constructor(
    private prisma: PrismaService,
    private openaiClient: OpenAiClientService,
    private pricing: AiPricingService,
    private wallet: AiWalletService,
  ) {}

  /**
   * Si el tenant tiene con que usar IA. Para los guards que deciden ANTES de armar una
   * conversacion, sin gastar una llamada. No mira el saldo: eso lo decide la
   * autorizacion, que es lo unico que puede hacerlo sin carreras.
   */
  async isConfigured(tenantId: string): Promise<boolean> {
    return (await this.openaiClient.getClient(tenantId)) !== null;
  }

  /**
   * Si hoy podria pagar una operacion. Es un vistazo, no una autorizacion: sirve para
   * no meter a un cliente en un chat de IA que no va a poder contestarle. Lo que
   * decide de verdad es authorize(), que es lo unico sin carreras.
   */
  async hasCredits(tenantId: string): Promise<boolean> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { aiBillingMode: true },
    });
    if (tenant?.aiBillingMode !== 'PLATFORM') return true;

    const wallet = await this.wallet.getWallet(tenantId);
    return !!wallet && wallet.aiEnabled && wallet.spendable > 0;
  }

  async chat(tenantId: string, req: AiChatRequest): Promise<AiChatResult> {
    const resolved = await this.openaiClient.getClient(tenantId);
    if (!resolved) return { ok: false, reason: 'NOT_CONFIGURED' };

    const { client, model, mode } = resolved;
    const requestId = req.requestId ?? randomUUID();

    // Autorizar contra el saldo, ANTES de llamar. Lo que se reserva es el PEOR caso:
    // asi el consumo real nunca supera lo reservado y el saldo no se va a negativo por
    // el camino normal.
    let holdId: string | null = null;
    if (mode === 'PLATFORM') {
      const estimate = await this.estimateCredits(model, req);
      const auth = await this.wallet.authorize(tenantId, {
        credits: estimate,
        feature: req.feature,
        model,
        conversationId: req.conversationId,
        userId: req.userId,
      });

      if (!auth.ok) {
        this.logger.warn(`Sin saldo de IA para el tenant ${tenantId} (${req.feature}, motivo ${auth.reason}).`);
        return { ok: false, reason: auth.reason };
      }
      holdId = auth.hold.id;
    }

    let completion: any;
    try {
      completion = await client.chat.completions.create({
        model,
        messages: req.messages,
        max_tokens: req.maxTokens,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      });
    } catch (err) {
      const message = (err as any)?.response?.data?.error?.message || (err as any)?.message || 'error desconocido';
      this.logger.error(`Fallo la llamada a ${model} (${req.feature}, tenant ${tenantId}): ${message}`);
      // No gasto nada: la reserva vuelve entera.
      if (holdId) await this.wallet.release(holdId);
      await this.record(tenantId, req, requestId, model, null, String(message).slice(0, 500), holdId, false);
      return { ok: false, reason: 'PROVIDER_ERROR' };
    }

    const text = completion?.choices?.[0]?.message?.content?.trim();
    // Una respuesta vacia es una falla, no un servicio. Desde donde esta parado el
    // cliente no se distingue de un error del proveedor, y ese ya no se cobra: cobrar
    // una y la otra no seria una diferencia que pueda entender. Los tokens igual se
    // gastaron, asi que el costo queda registrado y la perdida se ve en el margen.
    const failed = !text;

    const { credits, usageId } = await this.record(
      tenantId,
      req,
      requestId,
      model,
      completion,
      failed ? 'respuesta vacia' : null,
      holdId,
      mode === 'PLATFORM' && !failed,
    );

    if (holdId) {
      if (failed) await this.wallet.release(holdId);
      // Liquidar por el costo REAL, que nunca supera lo reservado.
      else await this.wallet.settle(holdId, credits, usageId);
    }

    if (failed) return { ok: false, reason: 'EMPTY_RESPONSE' };
    return { ok: true, text: text as string, credits };
  }

  /**
   * El techo de lo que puede costar esta operacion, en creditos.
   *
   * Se estima la entrada por el largo del texto (una regla gruesa de 4 caracteres por
   * token, con 20 % de margen) y se asume la salida COMPLETA, que ya viene acotada por
   * maxTokens. Tampoco se asume descuento por cache. Todo tira para arriba a proposito:
   * si la estimacion fuera un promedio, el consumo real la superaria la mitad de las
   * veces y el saldo negativo dejaria de ser un caso borde.
   */
  private async estimateCredits(model: string, req: AiChatRequest): Promise<number> {
    const chars = req.messages.reduce((total, m) => total + m.content.length, 0);
    const inputTokens = Math.ceil((chars / 4) * 1.2);
    const priced = await this.pricing.price('openai', model, {
      inputTokens,
      cachedInputTokens: 0,
      outputTokens: req.maxTokens,
    });
    return priced.credits;
  }

  /**
   * Deja la fila de consumo. Nunca hace fallar la operacion: si la medicion se rompe, el
   * cliente igual recibe su respuesta y el problema queda en el log. Lo que ya se gasto
   * se registra o se pierde.
   */
  private async record(
    tenantId: string,
    req: AiChatRequest,
    requestId: string,
    model: string,
    completion: any | null,
    error: string | null,
    holdId: string | null,
    billed: boolean,
  ): Promise<{ credits: number; usageId: string | null }> {
    try {
      const usage = completion?.usage;
      const tokens = {
        inputTokens: usage?.prompt_tokens ?? 0,
        cachedInputTokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
        outputTokens: usage?.completion_tokens ?? 0,
      };

      // Una llamada fallida no consumio tokens facturables: se registra para poder ver
      // la tasa de error del proveedor, pero sin costo ni creditos. Valorizarla daria el
      // minimo por operacion, que seria cobrarle al cliente un error nuestro.
      const priced = completion
        ? await this.pricing.price('openai', model, tokens)
        : { costMicros: 0, credits: 0, priceId: null, markupFactor: (await this.pricing.getParams()).markupFactor };

      // Lo que falló no se cobra: creditos en cero, pero el costo queda anotado. Asi el
      // panel muestra costo sin ingreso, que es exactamente lo que paso.
      const chargeable = !error;

      const row = await this.prisma.aiUsage.create({
        data: {
          tenantId,
          feature: req.feature,
          provider: 'openai',
          model,
          ...tokens,
          costMicros: priced.costMicros,
          priceId: priced.priceId,
          markupFactor: priced.markupFactor,
          credits: chargeable ? priced.credits : 0,
          billed: billed && chargeable && priced.credits > 0,
          holdId,
          requestId,
          providerRequestId: completion?._request_id ?? null,
          conversationId: req.conversationId ?? null,
          userId: req.userId ?? null,
          error,
        },
      });

      return { credits: chargeable ? priced.credits : 0, usageId: row.id };
    } catch (err) {
      this.logger.error(`No se pudo registrar el consumo de IA (tenant ${tenantId}, ${req.feature})`, err as any);
      return { credits: 0, usageId: null };
    }
  }
}
