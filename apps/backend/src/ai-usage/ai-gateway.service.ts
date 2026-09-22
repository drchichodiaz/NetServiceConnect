import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { OpenAiClientService } from './openai-client.service';
import { AiPricingService } from './ai-pricing.service';

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

export type AiChatResult =
  | { ok: true; text: string; credits: number }
  | { ok: false; reason: 'NOT_CONFIGURED' | 'PROVIDER_ERROR' | 'EMPTY_RESPONSE' };

/**
 * El unico lugar del sistema donde se gasta IA.
 *
 * Existe para que no haya forma de llamar al proveedor sin que quede medido: el cliente
 * de OpenAI se resuelve aca adentro y no se expone a nadie mas. Si manana alguien
 * agrega una funcionalidad con IA, o pasa por este servicio o no compila.
 *
 * Hoy solo mide (AiUsage.billed = false): calcula los creditos que corresponderian pero
 * no descuenta saldo de nadie. El cobro se enchufa aca mismo — autorizar antes de
 * llamar, liquidar despues — sin tocar ninguna de las funcionalidades que la usan.
 */
@Injectable()
export class AiGatewayService {
  private readonly logger = new Logger(AiGatewayService.name);

  constructor(
    private prisma: PrismaService,
    private openaiClient: OpenAiClientService,
    private pricing: AiPricingService,
  ) {}

  /**
   * Si el tenant tiene con que usar IA. Para los guards que deciden ANTES de armar una
   * conversacion, sin gastar una llamada.
   */
  async isConfigured(tenantId: string): Promise<boolean> {
    return (await this.openaiClient.getClient(tenantId)) !== null;
  }

  async chat(tenantId: string, req: AiChatRequest): Promise<AiChatResult> {
    const resolved = await this.openaiClient.getClient(tenantId);
    if (!resolved) return { ok: false, reason: 'NOT_CONFIGURED' };

    const { client, model } = resolved;
    const requestId = req.requestId ?? randomUUID();

    let completion: Awaited<ReturnType<typeof client.chat.completions.create>> & {
      _request_id?: string | null;
    };
    try {
      completion = (await client.chat.completions.create({
        model,
        messages: req.messages,
        max_tokens: req.maxTokens,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      })) as any;
    } catch (err) {
      const message = (err as any)?.response?.data?.error?.message || (err as any)?.message || 'error desconocido';
      this.logger.error(`Fallo la llamada a ${model} (${req.feature}, tenant ${tenantId}): ${message}`);
      await this.record(tenantId, req, requestId, model, null, String(message).slice(0, 500));
      return { ok: false, reason: 'PROVIDER_ERROR' };
    }

    const text = (completion as any)?.choices?.[0]?.message?.content?.trim();
    const credits = await this.record(tenantId, req, requestId, model, completion, text ? null : 'respuesta vacia');

    if (!text) return { ok: false, reason: 'EMPTY_RESPONSE' };
    return { ok: true, text, credits };
  }

  /**
   * Deja la fila de consumo. Nunca hace fallar la operacion: si la medicion se rompe,
   * el cliente igual recibe su respuesta y el problema queda en el log. Cuando el cobro
   * este activo esta decision se invierte para la autorizacion (sin saldo no hay
   * llamada), pero no para el registro: lo que ya se gasto se registra o se pierde.
   */
  private async record(
    tenantId: string,
    req: AiChatRequest,
    requestId: string,
    model: string,
    completion: any | null,
    error: string | null,
  ): Promise<number> {
    try {
      const usage = completion?.usage;
      const tokens = {
        inputTokens: usage?.prompt_tokens ?? 0,
        cachedInputTokens: usage?.prompt_tokens_details?.cached_tokens ?? 0,
        outputTokens: usage?.completion_tokens ?? 0,
      };

      // Una llamada fallida no consumio tokens facturables: se registra para poder ver
      // la tasa de error del proveedor, pero sin costo ni creditos. Valorizarla daria
      // el minimo por operacion, que seria cobrarle al cliente un error nuestro.
      const priced = completion
        ? await this.pricing.price('openai', model, tokens)
        : { costMicros: 0, credits: 0, priceId: null, markupFactor: (await this.pricing.getParams()).markupFactor };

      await this.prisma.aiUsage.create({
        data: {
          tenantId,
          feature: req.feature,
          provider: 'openai',
          model,
          ...tokens,
          costMicros: priced.costMicros,
          priceId: priced.priceId,
          markupFactor: priced.markupFactor,
          credits: priced.credits,
          billed: false,
          requestId,
          providerRequestId: completion?._request_id ?? null,
          conversationId: req.conversationId ?? null,
          userId: req.userId ?? null,
          error,
        },
      });

      return priced.credits;
    } catch (err) {
      this.logger.error(`No se pudo registrar el consumo de IA (tenant ${tenantId}, ${req.feature})`, err as any);
      return 0;
    }
  }
}
