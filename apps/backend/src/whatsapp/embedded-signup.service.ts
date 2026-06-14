import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddedSignupDto } from './dto/embedded-signup.dto';
import { randomUUID } from 'crypto';

@Injectable()
export class EmbeddedSignupService {
  private readonly logger = new Logger(EmbeddedSignupService.name);
  private readonly apiVersion: string;
  private readonly appId: string;
  private readonly appSecret: string;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {
    this.apiVersion = config.get('META_API_VERSION') || 'v19.0';
    this.appId = config.get('META_APP_ID') || '';
    this.appSecret = config.get('META_APP_SECRET') || '';
  }

  private get base() {
    return `https://graph.facebook.com/${this.apiVersion}`;
  }

  // ─── Flujo principal: código OAuth → cuenta guardada ──────────────────────

  async processSignup(tenantId: string, dto: EmbeddedSignupDto) {
    const { code, wabaId: sessionWabaId, phoneNumberId: sessionPhoneId } = dto;

    // 1. Intercambiar código por token de corta duración
    const shortToken = await this.exchangeCode(code);

    // 2. Extender a token de larga duración (~60 días)
    const longToken = await this.extendToken(shortToken);

    // 3. Resolver wabaId y phoneNumberId
    //    Si el frontend los envió desde el postMessage, los usamos directamente.
    //    Si no, los obtenemos desde los granular_scopes de Meta.
    let wabaId = sessionWabaId;
    let phoneId = sessionPhoneId;
    let displayPhone = '';

    if (!wabaId || !phoneId) {
      const resolved = await this.resolveWabaAndPhone(longToken);
      wabaId = wabaId ?? resolved.wabaId;
      phoneId = phoneId ?? resolved.phoneId;
      displayPhone = resolved.displayPhone;
    } else {
      // Tenemos session info — obtener displayPhone pero no fallar si no se puede
      displayPhone = await this.fetchDisplayPhone(phoneId, longToken);
    }

    // 4. Suscribir webhook al WABA
    await this.subscribeWebhook(wabaId, longToken);

    // 5. Guardar configuración ANTES de registrar (para no perder el token si falla)
    const account = await this.upsertAccount({
      tenantId,
      wabaId,
      phoneId,
      longToken,
      displayPhone,
    });

    // 6. Registrar el número en la Cloud API (Pending → activo)
    const registerResult = await this.registerPhone(phoneId, longToken);

    if (!registerResult.ok && !registerResult.alreadyRegistered) {
      this.logger.warn(
        `[EmbeddedSignup] Número ${phoneId} guardado pero registro pendiente`,
        registerResult,
      );
      return {
        ok: true,
        displayPhone: account.phoneNumber,
        phoneNumberId: account.phoneNumberId,
        needsPin: registerResult.needsPin,
        registerError: registerResult.needsPin ? null : registerResult.error,
      };
    }

    this.logger.log(`[EmbeddedSignup] Tenant ${tenantId} conectado — número ${displayPhone}`);
    return {
      ok: true,
      displayPhone: account.phoneNumber,
      phoneNumberId: account.phoneNumberId,
      needsPin: false,
    };
  }

  // ─── Conexión directa con token (para desarrollo con número de prueba de Meta) ─

  async connectDirect(tenantId: string, accessToken: string, phoneNumberId: string, wabaId?: string) {
    // Validar el token consultando la info del número
    const displayPhone = await this.fetchDisplayPhone(phoneNumberId, accessToken);

    // Si no se proporcionó wabaId, resolverlo desde los granular_scopes del token
    let resolvedWabaId = wabaId;
    if (!resolvedWabaId) {
      const resolved = await this.resolveWabaAndPhone(accessToken);
      resolvedWabaId = resolved.wabaId;
    }

    await this.subscribeWebhook(resolvedWabaId, accessToken);

    const account = await this.upsertAccount({
      tenantId,
      wabaId: resolvedWabaId,
      phoneId: phoneNumberId,
      longToken: accessToken,
      displayPhone,
    });

    this.logger.log(`[ConnectDirect] Tenant ${tenantId} conectado — ${displayPhone || phoneNumberId}`);

    return {
      ok: true,
      displayPhone: account.phoneNumber,
      phoneNumberId: account.phoneNumberId,
    };
  }

  // ─── Activar número con PIN 2FA ───────────────────────────────────────────

  async registerPhoneWithPin(tenantId: string, pin: string) {
    const account = await this.prisma.whatsAppAccount.findUnique({ where: { tenantId } });
    if (!account) throw new BadRequestException('No hay configuración de WhatsApp para este tenant');

    const url = `${this.base}/${account.phoneNumberId}/register`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${account.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
    });

    const data = (await res.json()) as { success?: boolean; error?: { message: string } };
    if (!res.ok) {
      throw new BadRequestException(data.error?.message ?? 'Error al registrar con PIN');
    }

    return { ok: true };
  }

  // ─── Leer / desconectar ───────────────────────────────────────────────────

  async getAccount(tenantId: string) {
    return this.prisma.whatsAppAccount.findUnique({
      where: { tenantId },
      select: {
        id: true,
        wabaId: true,
        phoneNumber: true,
        displayName: true,
        businessName: true,
        signupStatus: true,
        isActive: true,
        webhookVerifyToken: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async disconnect(tenantId: string) {
    return this.prisma.whatsAppAccount.update({
      where: { tenantId },
      data: { signupStatus: 'DISCONNECTED', isActive: false },
    });
  }

  // ─── Helpers privados ─────────────────────────────────────────────────────

  private async exchangeCode(code: string): Promise<string> {
    const url = `https://graph.facebook.com/oauth/access_token?client_id=${this.appId}&client_secret=${this.appSecret}&code=${code}`;
    const res = await fetch(url);
    const data = (await res.json()) as { access_token?: string; error?: { message: string } };

    if (!data.access_token) {
      this.logger.error('[EmbeddedSignup] Token exchange failed', data.error);
      throw new BadRequestException(data.error?.message ?? 'Error al obtener token de Meta');
    }
    return data.access_token;
  }

  private async extendToken(shortToken: string): Promise<string> {
    const url = `https://graph.facebook.com/oauth/access_token?grant_type=fb_exchange_token&client_id=${this.appId}&client_secret=${this.appSecret}&fb_exchange_token=${shortToken}`;
    const res = await fetch(url);
    const data = (await res.json()) as { access_token?: string };
    // Si falla la extensión, usar el token corto (mejor que nada)
    return data.access_token ?? shortToken;
  }

  private async resolveWabaAndPhone(token: string): Promise<{
    wabaId: string;
    phoneId: string;
    displayPhone: string;
  }> {
    // Obtener WABA ID desde granular_scopes
    const scopesRes = await fetch(`${this.base}/me?fields=granular_scopes&access_token=${token}`);
    const scopesData = (await scopesRes.json()) as {
      granular_scopes?: Array<{ scope: string; target_ids: string[] }>;
    };

    const wabaId = scopesData.granular_scopes?.find(
      (s) => s.scope === 'whatsapp_business_management',
    )?.target_ids?.[0];

    if (!wabaId) {
      throw new BadRequestException(
        'No se encontró una cuenta de WhatsApp Business en la autorización',
      );
    }

    // Obtener números del WABA
    const phonesRes = await fetch(`${this.base}/${wabaId}/phone_numbers?access_token=${token}`);
    const phonesData = (await phonesRes.json()) as {
      data?: Array<{ id: string; display_phone_number: string }>;
    };

    const phones = phonesData.data ?? [];
    if (phones.length === 0) {
      throw new BadRequestException(
        'No hay números de teléfono registrados en esta cuenta de WhatsApp Business',
      );
    }

    return {
      wabaId,
      phoneId: phones[0].id,
      displayPhone: phones[0].display_phone_number,
    };
  }

  private async fetchDisplayPhone(phoneId: string, token: string): Promise<string> {
    try {
      const res = await fetch(
        `${this.base}/${phoneId}?fields=display_phone_number,verified_name&access_token=${token}`,
      );
      const data = (await res.json()) as {
        display_phone_number?: string;
        verified_name?: string;
      };
      return data.display_phone_number ?? '';
    } catch {
      return '';
    }
  }

  private async subscribeWebhook(wabaId: string, token: string) {
    try {
      await fetch(`${this.base}/${wabaId}/subscribed_apps`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      this.logger.log(`[EmbeddedSignup] Webhook suscrito a WABA ${wabaId}`);
    } catch (err) {
      this.logger.warn('[EmbeddedSignup] Webhook subscription failed', err);
    }
  }

  private async registerPhone(
    phoneId: string,
    token: string,
  ): Promise<{ ok: boolean; alreadyRegistered?: boolean; needsPin?: boolean; error?: string }> {
    try {
      const res = await fetch(`${this.base}/${phoneId}/register`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp' }),
      });

      const data = (await res.json()) as {
        success?: boolean;
        error?: { message: string; code: number };
      };

      // 80007 = ya estaba registrado (OK)
      if (res.ok || data.error?.code === 80007) {
        return { ok: true, alreadyRegistered: data.error?.code === 80007 };
      }

      const needsPin =
        data.error?.message?.toLowerCase().includes('pin') ||
        data.error?.code === 80008;

      return { ok: false, needsPin, error: needsPin ? undefined : data.error?.message };
    } catch (err) {
      this.logger.warn('[EmbeddedSignup] Phone registration failed', err);
      return { ok: false, error: String(err) };
    }
  }

  private async upsertAccount(params: {
    tenantId: string;
    wabaId: string;
    phoneId: string;
    longToken: string;
    displayPhone: string;
  }) {
    const { tenantId, wabaId, phoneId, longToken, displayPhone } = params;

    return this.prisma.whatsAppAccount.upsert({
      where: { tenantId },
      update: {
        wabaId,
        phoneNumberId: phoneId,
        accessToken: longToken,
        phoneNumber: displayPhone,
        signupStatus: 'CONNECTED',
        isActive: true,
      },
      create: {
        tenantId,
        wabaId,
        phoneNumberId: phoneId,
        accessToken: longToken,
        phoneNumber: displayPhone,
        webhookVerifyToken: randomUUID(),
        signupStatus: 'CONNECTED',
      },
    });
  }
}
