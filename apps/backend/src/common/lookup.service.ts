import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

/** Config que guarda un nodo ORDER_LOOKUP en TenantMenuNode.config. */
export interface LookupConfig {
  apiUrl?: string;
  method?: string;
  headers?: Record<string, string>;
  /** Plantilla del mensaje al cliente. Acepta {{campo}} y {{objeto.campo}} de la respuesta. */
  responseTemplate?: string;
  notFoundText?: string;
  timeoutMs?: number;
}

export interface LookupResult {
  ok: boolean;
  notFound: boolean;
  rendered: string | null;
  status: number | null;
  raw: unknown;
  error: string | null;
}

const DEFAULT_TIMEOUT_MS = 8000;
const MAX_TIMEOUT_MS = 15000;
const MAX_RESPONSE_BYTES = 512 * 1024;
// El valor que escribio el cliente (numero de pedido, de expediente, lo que sea).
const VALUE_TOKEN = /\{\{\s*consulta\s*\}\}/gi;

/**
 * Consulta generica a un sistema externo desde un nodo del menu del bot: el cliente
 * manda un dato, se llama al endpoint que configuro el admin, y la respuesta JSON se
 * arma en un mensaje con una plantilla. Es deliberadamente agnostico del negocio —
 * el mismo nodo sirve para "estado de mi pedido", "mi factura" o "mi expediente".
 */
@Injectable()
export class LookupService {
  private readonly logger = new Logger(LookupService.name);
  private readonly allowPrivateHosts: boolean;

  constructor(config: ConfigService) {
    // Por defecto no se puede apuntar a la red interna del server: la URL la escribe
    // el admin de un tenant, que en un SaaS es un tercero semi-confiable, y sin esto
    // seria una via para escanear la red o pegarle al metadata de la nube. Se puede
    // habilitar con ALLOW_PRIVATE_LOOKUP_URLS=true si la API vive en el mismo host.
    this.allowPrivateHosts = config.get('ALLOW_PRIVATE_LOOKUP_URLS') === 'true';
  }

  /** Un nodo sin URL o sin plantilla no puede responder: el bot deriva a un humano. */
  isConfigured(config?: LookupConfig | null): boolean {
    return !!config?.apiUrl?.trim() && !!config?.responseTemplate?.trim();
  }

  async run(config: LookupConfig, value: string): Promise<LookupResult> {
    const empty: LookupResult = {
      ok: false,
      notFound: false,
      rendered: null,
      status: null,
      raw: null,
      error: null,
    };

    let url: URL;
    try {
      url = new URL(this.fillValue(config.apiUrl ?? '', value, true));
    } catch {
      return { ...empty, error: 'La URL configurada no es válida' };
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { ...empty, error: 'La URL debe ser http o https' };
    }
    const hostError = this.hostProblem(url.hostname);
    if (hostError) return { ...empty, error: hostError };

    const method = (config.method || 'GET').toUpperCase();
    const timeout = Math.min(config.timeoutMs || DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
    const headers: Record<string, string> = {};
    for (const [key, raw] of Object.entries(config.headers ?? {})) {
      if (typeof raw === 'string') headers[key] = this.fillValue(raw, value, false);
    }

    let status: number | null = null;
    let data: unknown = null;
    try {
      const res = await axios.request({
        url: url.toString(),
        method: method as any,
        headers,
        timeout,
        maxContentLength: MAX_RESPONSE_BYTES,
        // Los 4xx se manejan como respuesta, no como excepcion: un 404 es "no existe
        // ese pedido", que para el cliente es una respuesta valida y no un error.
        validateStatus: () => true,
        ...(method === 'POST' && { data: { consulta: value } }),
      });
      status = res.status;
      data = res.data;
    } catch (err: any) {
      const reason =
        err?.code === 'ECONNABORTED'
          ? `La consulta tardó más de ${timeout} ms`
          : err?.message;
      this.logger.warn(`[Lookup] Falló la llamada a ${url.host}: ${reason}`);
      return { ...empty, error: reason || 'No se pudo contactar al sistema externo' };
    }

    if (status === 404) {
      return { ok: true, notFound: true, rendered: null, status, raw: data, error: null };
    }
    if (status >= 400) {
      this.logger.warn(`[Lookup] ${url.host} respondió ${status}`);
      return {
        ok: false,
        notFound: false,
        rendered: null,
        status,
        raw: data,
        error: `El sistema externo respondió ${status}`,
      };
    }

    // Una lista se interpreta como "resultados": se usa el primero, y vacia es "no existe".
    const record = Array.isArray(data) ? data[0] : data;
    if (record === null || record === undefined || (Array.isArray(data) && data.length === 0)) {
      return { ok: true, notFound: true, rendered: null, status, raw: data, error: null };
    }

    const rendered = this.render(config.responseTemplate ?? '', record, value);
    return { ok: true, notFound: false, rendered, status, raw: data, error: null };
  }

  /** Texto de "no encontré nada", con el dato consultado interpolado. */
  renderNotFound(config: LookupConfig, value: string): string {
    const text = config.notFoundText?.trim() || 'No encontré ningún resultado para "{{consulta}}".';
    return this.fillValue(text, value, false);
  }

  private fillValue(text: string, value: string, forUrl: boolean): string {
    return text.replace(VALUE_TOKEN, forUrl ? encodeURIComponent(value) : value);
  }

  /**
   * Reemplaza {{campo}} y {{objeto.campo}} con valores de la respuesta. Un campo que
   * no existe queda vacio en vez de dejar el {{...}} crudo: es preferible una linea
   * incompleta a mandarle al cliente algo que parece un error del sistema.
   */
  private render(template: string, record: unknown, value: string): string {
    return this.fillValue(template, value, false)
      .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_full, path: string) => {
        const resolved = String(path)
          .split('.')
          .reduce<any>((acc, key) => (acc == null ? acc : acc[key]), record);
        if (resolved === null || resolved === undefined) return '';
        return typeof resolved === 'object' ? JSON.stringify(resolved) : String(resolved);
      })
      .trim();
  }

  /**
   * Bloquea loopback y rangos privados. Solo mira el hostname literal: un dominio que
   * resuelve a una IP interna se escapa de este control — cerrarlo del todo requiere
   * resolver DNS y validar la IP antes de conectar.
   */
  private hostProblem(hostname: string): string | null {
    if (this.allowPrivateHosts) return null;
    const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');

    if (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.internal') ||
      host.endsWith('.local')
    ) {
      return 'La URL apunta a la red interna del servidor';
    }
    if (host === '::1' || host.startsWith('fd') || host.startsWith('fe80')) {
      return 'La URL apunta a la red interna del servidor';
    }

    const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (ipv4) {
      const a = Number(ipv4[1]);
      const b = Number(ipv4[2]);
      const isPrivate =
        a === 0 ||
        a === 10 ||
        a === 127 ||
        (a === 169 && b === 254) || // link-local: incluye el metadata de la nube
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168);
      if (isPrivate) return 'La URL apunta a la red interna del servidor';
    }
    return null;
  }
}
