import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { EmbeddedSignupDto } from './dto/embedded-signup.dto';
import { randomUUID } from 'crypto';

@Injectable()
export class EmbeddedSignupService {
  private readonly logger = new Logger(EmbeddedSignupService.name);

  constructor(
    private prisma: PrismaService,
    private systemConfig: SystemConfigService,
  ) {}

  private base(apiVersion: string) {
    return `https://graph.facebook.com/${apiVersion}`;
  }

  // ─── Flujo principal: código OAuth → cuenta guardada ──────────────────────

  async processSignup(tenantId: string, dto: EmbeddedSignupDto) {
    const { code, wabaId: sessionWabaId, phoneNumberId: sessionPhoneId } = dto;
    const cfg = await this.systemConfig.get();

    // 1. Intercambiar código por token de corta duración
    const shortToken = await this.exchangeCode(code, cfg);

    // 2. Extender a token de larga duración (~60 días)
    const longToken = await this.extendToken(shortToken, cfg);

    // 3. Resolver wabaId y phoneNumberId
    //    Si el frontend los envió desde el postMessage, los usamos directamente.
    //    Si no, los obtenemos desde los granular_scopes de Meta.
    let wabaId = sessionWabaId;
    let phoneId = sessionPhoneId;
    let displayPhone = '';

    if (!wabaId || !phoneId) {
      const resolved = await this.resolveWabaAndPhone(longToken, cfg.metaApiVersion);
      wabaId = wabaId ?? resolved.wabaId;
      phoneId = phoneId ?? resolved.phoneId;
      displayPhone = resolved.displayPhone;
    } else {
      displayPhone = await this.fetchDisplayPhone(phoneId, longToken, cfg.metaApiVersion);
    }

    // 4. Suscribir webhook al WABA
    await this.subscribeWebhook(wabaId, longToken, cfg.metaApiVersion);

    // 5. Guardar configuración ANTES de registrar (para no perder el token si falla)
    const account = await this.upsertAccount({
      tenantId,
      wabaId,
      phoneId,
      longToken,
      displayPhone,
    });

    // 6. Registrar el número en la Cloud API (Pending → activo)
    const registerResult = await this.registerPhone(phoneId, longToken, cfg.metaApiVersion);

    if (!registerResult.ok && !registerResult.alreadyRegistered) {
      this.logger.warn(
        `[EmbeddedSignup] Número ${phoneId} guardado pero registro pendiente`,
        registerResult,
      );
      // Se cachea igual el estado: la linea queda visible en el panel como pendiente
      // en vez de aparecer sin verificar.
      await this.refreshPlatformStatus(account.id);
      return {
        ok: true,
        accountId: account.id,
        displayPhone: account.phoneNumber,
        phoneNumberId: account.phoneNumberId,
        needsPin: registerResult.needsPin,
        registerError: registerResult.needsPin ? null : registerResult.error,
      };
    }

    this.logger.log(`[EmbeddedSignup] Tenant ${tenantId} conectado — número ${displayPhone}`);
    await this.refreshPlatformStatus(account.id);
    return {
      ok: true,
      accountId: account.id,
      displayPhone: account.phoneNumber,
      phoneNumberId: account.phoneNumberId,
      needsPin: false,
    };
  }

  // ─── Conexión directa con token (para desarrollo con número de prueba de Meta) ─

  async connectDirect(tenantId: string, accessToken: string, phoneNumberId: string, wabaId?: string) {
    const cfg = await this.systemConfig.get();
    const displayPhone = await this.fetchDisplayPhone(phoneNumberId, accessToken, cfg.metaApiVersion);

    let resolvedWabaId = wabaId;
    if (!resolvedWabaId) {
      const resolved = await this.resolveWabaAndPhone(accessToken, cfg.metaApiVersion);
      resolvedWabaId = resolved.wabaId;
    }

    await this.subscribeWebhook(resolvedWabaId, accessToken, cfg.metaApiVersion);

    const account = await this.upsertAccount({
      tenantId,
      wabaId: resolvedWabaId,
      phoneId: phoneNumberId,
      longToken: accessToken,
      displayPhone,
    });

    // Igual que processSignup: guardar la linea no alcanza, hay que registrarla en la
    // Cloud API o no puede enviar. Antes este camino se saltaba el registro (se hizo
    // para el numero de prueba de Meta, que ya viene registrado) y con un numero real
    // la linea quedaba muda sin ninguna senal en el panel.
    const registerResult = await this.registerPhone(phoneNumberId, accessToken, cfg.metaApiVersion);
    await this.refreshPlatformStatus(account.id);

    this.logger.log(
      `[ConnectDirect] Tenant ${tenantId} conectado — ${displayPhone || phoneNumberId}` +
        (registerResult.ok ? '' : ' (pendiente de registro en la Cloud API)'),
    );

    return {
      ok: true,
      accountId: account.id,
      displayPhone: account.phoneNumber,
      phoneNumberId: account.phoneNumberId,
      needsPin: registerResult.needsPin ?? false,
      registerError: registerResult.needsPin ? null : registerResult.error ?? null,
    };
  }

  // ─── Activar número con PIN 2FA ───────────────────────────────────────────

  async registerPhoneWithPin(tenantId: string, pin: string, accountId?: string) {
    // Sin accountId se asume el caso de un tenant con una sola linea (o la recien
    // conectada, que queda como la mas nueva).
    const account = accountId
      ? await this.prisma.whatsAppAccount.findFirst({ where: { id: accountId, tenantId } })
      : await this.prisma.whatsAppAccount.findFirst({ where: { tenantId }, orderBy: { createdAt: 'desc' } });
    if (!account) throw new BadRequestException('No hay configuración de WhatsApp para este tenant');
    const cfg = await this.systemConfig.get();

    const url = `${this.base(cfg.metaApiVersion)}/${account.phoneNumberId}/register`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${account.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ messaging_product: 'whatsapp', pin }),
    });

    const data = (await res.json()) as { success?: boolean; error?: { message: string; code?: number } };
    // 80007 = ya estaba registrado; no es un error desde el punto de vista del admin.
    if (!res.ok && data.error?.code !== 80007) {
      throw new BadRequestException(data.error?.message ?? 'Error al registrar con PIN');
    }

    const status = await this.refreshPlatformStatus(account.id);
    return { ok: true, alreadyRegistered: data.error?.code === 80007, platformStatus: status };
  }

  /**
   * Relee el estado del numero en Meta y lo cachea. Es la unica fuente de verdad sobre
   * si la linea puede enviar: un numero registrado a mano en el panel de Meta figura
   * como CONNECTED aunque el registro no haya pasado por aca.
   */
  async refreshPlatformStatus(accountId: string): Promise<string | null> {
    const account = await this.prisma.whatsAppAccount.findUnique({ where: { id: accountId } });
    if (!account) return null;
    const cfg = await this.systemConfig.get();

    let status: string | null = null;
    try {
      const res = await fetch(
        `${this.base(cfg.metaApiVersion)}/${account.phoneNumberId}?fields=status,display_phone_number,verified_name,quality_rating&access_token=${account.accessToken}`,
      );
      const data = (await res.json()) as {
        status?: string;
        display_phone_number?: string;
        verified_name?: string;
        error?: { message: string };
      };
      if (data.error) throw new Error(data.error.message);
      status = data.status ?? null;

      await this.prisma.whatsAppAccount.update({
        where: { id: accountId },
        data: {
          platformStatus: status,
          statusCheckedAt: new Date(),
          // Meta es la autoridad sobre el numero y el nombre verificado; el `label`
          // operativo que puso el admin no se toca.
          ...(data.display_phone_number && { phoneNumber: data.display_phone_number }),
          ...(data.verified_name && { displayName: data.verified_name }),
        },
      });
    } catch (err) {
      this.logger.warn(`[PlatformStatus] No se pudo leer el estado del número ${account.phoneNumberId}`, err);
      await this.prisma.whatsAppAccount.update({
        where: { id: accountId },
        data: { platformStatus: null, statusCheckedAt: new Date() },
      });
    }
    return status;
  }

  // ─── Leer / desconectar ───────────────────────────────────────────────────

  /**
   * Importa de una sola vez todos los numeros del/los WABA que el tenant ya tiene
   * conectados. Es lo que evita repetir el signup 15 veces cuando una empresa tiene
   * una linea por sucursal: se conecta una, se sincroniza, y aparecen las demas.
   * Reusa el token ya guardado de cada WABA — no pide nada nuevo al usuario.
   */
  async syncNumbers(tenantId: string) {
    const existing = await this.prisma.whatsAppAccount.findMany({ where: { tenantId } });
    if (existing.length === 0) {
      throw new BadRequestException('Primero conecta una cuenta de WhatsApp para poder sincronizar sus números');
    }
    const cfg = await this.systemConfig.get();

    // Un tenant puede tener lineas de mas de un WABA; se consulta cada uno una vez
    // con el token de la cuenta mas nueva de ese WABA (la de token menos vencido).
    const tokenByWaba = new Map<string, string>();
    for (const acc of [...existing].sort((a, b) => +a.createdAt - +b.createdAt)) {
      tokenByWaba.set(acc.wabaId, acc.accessToken);
    }

    const knownPhoneIds = new Set(existing.map((a) => a.phoneNumberId));
    let imported = 0;
    const failedWabas: string[] = [];

    for (const [wabaId, token] of tokenByWaba) {
      let phones: Array<{ id: string; display_phone_number?: string; verified_name?: string }> = [];
      try {
        const res = await fetch(
          `${this.base(cfg.metaApiVersion)}/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name&access_token=${token}`,
        );
        const data = (await res.json()) as { data?: typeof phones; error?: { message: string } };
        if (data.error) throw new Error(data.error.message);
        phones = data.data ?? [];
      } catch (err) {
        this.logger.warn(`[SyncNumbers] No se pudieron leer los números del WABA ${wabaId}`, err);
        failedWabas.push(wabaId);
        continue;
      }

      for (const phone of phones) {
        if (knownPhoneIds.has(phone.id)) continue;
        await this.upsertAccount({
          tenantId,
          wabaId,
          phoneId: phone.id,
          longToken: token,
          displayPhone: phone.display_phone_number ?? '',
          // El nombre verificado de Meta suele ser el de la sucursal — sirve como
          // label inicial para que el admin no tenga que nombrar 15 lineas a mano.
          label: phone.verified_name || phone.display_phone_number || null,
        });
        knownPhoneIds.add(phone.id);
        imported++;
      }
    }

    this.logger.log(`[SyncNumbers] Tenant ${tenantId}: ${imported} número(s) nuevo(s) importado(s)`);
    return { ok: failedWabas.length === 0, imported, failedWabas };
  }

  // ─── Helpers privados ─────────────────────────────────────────────────────

  private async exchangeCode(code: string, cfg: { metaAppId: string; metaAppSecret: string }): Promise<string> {
    const url = `https://graph.facebook.com/oauth/access_token?client_id=${cfg.metaAppId}&client_secret=${cfg.metaAppSecret}&code=${code}`;
    const res = await fetch(url);
    const data = (await res.json()) as { access_token?: string; error?: { message: string } };

    if (!data.access_token) {
      this.logger.error('[EmbeddedSignup] Token exchange failed', data.error);
      throw new BadRequestException(data.error?.message ?? 'Error al obtener token de Meta');
    }
    return data.access_token;
  }

  private async extendToken(shortToken: string, cfg: { metaAppId: string; metaAppSecret: string }): Promise<string> {
    const url = `https://graph.facebook.com/oauth/access_token?grant_type=fb_exchange_token&client_id=${cfg.metaAppId}&client_secret=${cfg.metaAppSecret}&fb_exchange_token=${shortToken}`;
    const res = await fetch(url);
    const data = (await res.json()) as { access_token?: string };
    return data.access_token ?? shortToken;
  }

  private async resolveWabaAndPhone(token: string, apiVersion: string): Promise<{
    wabaId: string;
    phoneId: string;
    displayPhone: string;
  }> {
    const scopesRes = await fetch(`${this.base(apiVersion)}/me?fields=granular_scopes&access_token=${token}`);
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
    const phonesRes = await fetch(`${this.base(apiVersion)}/${wabaId}/phone_numbers?access_token=${token}`);
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

  private async fetchDisplayPhone(phoneId: string, token: string, apiVersion: string): Promise<string> {
    try {
      const res = await fetch(
        `${this.base(apiVersion)}/${phoneId}?fields=display_phone_number,verified_name&access_token=${token}`,
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

  private async subscribeWebhook(wabaId: string, token: string, apiVersion: string) {
    try {
      await fetch(`${this.base(apiVersion)}/${wabaId}/subscribed_apps`, {
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
    apiVersion: string,
  ): Promise<{ ok: boolean; alreadyRegistered?: boolean; needsPin?: boolean; error?: string }> {
    try {
      const res = await fetch(`${this.base(apiVersion)}/${phoneId}/register`, {
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
    label?: string | null;
  }) {
    const { tenantId, wabaId, phoneId, longToken, displayPhone, label } = params;

    // La clave es (tenant, numero): reconectar un numero que ya existe lo refresca
    // — renueva el token — en vez de pisar la linea de otra sucursal.
    const isFirst = (await this.prisma.whatsAppAccount.count({ where: { tenantId } })) === 0;

    return this.prisma.whatsAppAccount.upsert({
      where: { tenantId_phoneNumberId: { tenantId, phoneNumberId: phoneId } },
      update: {
        wabaId,
        accessToken: longToken,
        phoneNumber: displayPhone,
        signupStatus: 'CONNECTED',
        isActive: true,
        // `label` a propósito NO se actualiza: es un nombre que puso el admin
        // ("Sucursal Palermo") y reconectar el número no debe pisarlo con el
        // verified_name de Meta.
      },
      create: {
        tenantId,
        wabaId,
        phoneNumberId: phoneId,
        accessToken: longToken,
        phoneNumber: displayPhone,
        label: label ?? null,
        isDefault: isFirst,
        webhookVerifyToken: randomUUID(),
        signupStatus: 'CONNECTED',
      },
    });
  }
}
