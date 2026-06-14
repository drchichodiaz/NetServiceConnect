import { config } from '../config';
import { prisma } from '../lib/prisma';
import { WaPayload } from './WhatsAppFormatter';

const BASE_URL = `https://graph.facebook.com/${config.META_API_VERSION}`;

// ─── Retry helper con backoff exponencial ────────────────────────────────────
// Reintenta `fn` hasta `maxAttempts` veces. Entre intentos espera:
//   intento 1→2: baseDelayMs * 2^0  (ej: 1 000ms)
//   intento 2→3: baseDelayMs * 2^1  (ej: 2 000ms)
//   intento 3→4: baseDelayMs * 2^2  (ej: 4 000ms)
// Solo reintenta si el error es de red o 5xx. Los errores 4xx (token inválido,
// número no existe) son definitivos y se lanzan inmediatamente.
async function withRetry<T>(
  fn: () => Promise<T>,
  {
    maxAttempts = 3,
    baseDelayMs = 1000,
    label       = 'operation',
  }: { maxAttempts?: number; baseDelayMs?: number; label?: string } = {},
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;

      // Errores 4xx son definitivos — no reintentar
      const msg = String(err);
      if (msg.includes('Meta API error: 4')) {
        console.error(`[Retry:${label}] Error definitivo (4xx) en intento ${attempt}. No se reintentará.`);
        throw err;
      }

      if (attempt < maxAttempts) {
        const delay = baseDelayMs * Math.pow(2, attempt - 1);
        console.warn(
          `[Retry:${label}] Intento ${attempt}/${maxAttempts} falló. Reintentando en ${delay}ms...`,
          err,
        );
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  console.error(`[Retry:${label}] Todos los ${maxAttempts} intentos fallaron.`);
  throw lastError;
}

export interface WhatsAppConfig {
  tenantId: string;
  phoneNumberId: string;
  accessToken: string;
  displayPhone: string | null;
  wabaId: string | null;
  isActive: boolean;
}

export class WhatsAppService {

  // ── Enviar payload tipado (text / interactive) con reintentos ───────────────
  async sendPayload(
    phoneNumberId: string,
    accessToken: string,
    to: string,
    payload: WaPayload,
  ): Promise<void> {
    await withRetry(
      () => this._doSendPayload(phoneNumberId, accessToken, to, payload),
      { maxAttempts: 3, baseDelayMs: 1000, label: `sendPayload→${to}` },
    );
  }

  /** Fallback conveniente para mensajes de texto plano (sin formato). */
  async sendMessage(
    phoneNumberId: string,
    accessToken: string,
    to: string,
    text: string,
  ): Promise<void> {
    const payload: WaPayload = {
      type: 'text',
      text: { body: text, preview_url: false },
    };
    await this.sendPayload(phoneNumberId, accessToken, to, payload);
  }

  private async _doSendPayload(
    phoneNumberId: string,
    accessToken: string,
    to: string,
    payload: WaPayload,
  ): Promise<void> {
    const url = `${BASE_URL}/${phoneNumberId}/messages`;

    const body = {
      messaging_product: 'whatsapp',
      recipient_type:    'individual',
      to,
      ...payload,               // spreads type + text|interactive
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error(`[WhatsAppService] Error ${res.status} al enviar a ${to}:`, errBody);
      throw new Error(`Meta API error: ${res.status} — ${errBody}`);
    }
  }

  // ── Marcar mensaje como leído ─────────────────────────────────────────────
  async markAsRead(
    phoneNumberId: string,
    accessToken: string,
    messageId: string,
  ): Promise<void> {
    const url = `${BASE_URL}/${phoneNumberId}/messages`;
    await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        status:            'read',
        message_id:        messageId,
      }),
    }).catch(() => {/* silencioso — no bloquear el flujo */});
  }

  // ── Obtener config de WhatsApp por tenant ─────────────────────────────────
  async getConfig(tenantId: string): Promise<WhatsAppConfig | null> {
    const cfg = await prisma.whatsAppConfig.findUnique({ where: { tenantId } });
    if (!cfg || !cfg.isActive) return null;
    return cfg;
  }

  // ── Obtener tenant por phone_number_id (para el webhook entrante) ─────────
  async getTenantByPhoneNumberId(phoneNumberId: string): Promise<string | null> {
    const cfg = await prisma.whatsAppConfig.findFirst({
      where: { phoneNumberId, isActive: true },
    });
    return cfg?.tenantId ?? null;
  }

  // ── Guardar / actualizar config ───────────────────────────────────────────
  async saveConfig(params: {
    tenantId: string;
    phoneNumberId: string;
    accessToken: string;
    displayPhone?: string;
    wabaId?: string;
  }): Promise<WhatsAppConfig> {
    const data = {
      phoneNumberId: params.phoneNumberId,
      accessToken:   params.accessToken,
      displayPhone:  params.displayPhone ?? null,
      wabaId:        params.wabaId ?? null,
      isActive:      true,
      updatedAt:     new Date(),
    };

    const result = await prisma.whatsAppConfig.upsert({
      where:  { tenantId: params.tenantId },
      update: data,
      create: { tenantId: params.tenantId, ...data },
    });

    return result;
  }

  // ── Desconectar (marcar inactivo) ─────────────────────────────────────────
  async disconnect(tenantId: string): Promise<void> {
    await prisma.whatsAppConfig.updateMany({
      where: { tenantId },
      data:  { isActive: false, updatedAt: new Date() },
    });
  }

  // ── Validar token llamando a Meta API ─────────────────────────────────────
  async validateToken(phoneNumberId: string, accessToken: string): Promise<{
    valid: boolean;
    displayPhone?: string;
    wabaId?: string;
    error?: string;
  }> {
    try {
      const url = `${BASE_URL}/${phoneNumberId}?fields=display_phone_number,verified_name&access_token=${accessToken}`;
      const res  = await fetch(url);
      const data = await res.json() as Record<string, string>;

      if (!res.ok || data.error) {
        return { valid: false, error: (data.error as unknown as { message: string })?.message ?? 'Token inválido' };
      }

      return {
        valid:        true,
        displayPhone: data.display_phone_number,
      };
    } catch (err) {
      return { valid: false, error: String(err) };
    }
  }
}

export const whatsAppService = new WhatsAppService();
