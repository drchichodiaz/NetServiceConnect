import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

export interface AppEvent {
  type: 'new_message' | 'conversation_updated' | 'message_status';
  tenantId: string;
  payload: any;
}

type Handler = (event: AppEvent) => void;

/** Canal unico: el ruteo por empresa se hace en memoria al recibir. */
const CHANNEL = 'netservice:events';

/**
 * Reparte los eventos en vivo (mensaje nuevo, cambio de conversacion, estado de envio)
 * a los paneles conectados por SSE.
 *
 * Dos modos, segun haya REDIS_URL:
 *
 * - **Sin Redis** (default): entrega en memoria. Sirve mientras la API corra en un
 *   solo proceso, que es el caso de un deploy chico.
 * - **Con Redis**: publica en un canal y entrega lo que llega por ahi. Es lo que
 *   permite correr la API en varios procesos — sin esto, un evento generado en un
 *   worker nunca llegaria a los agentes conectados a otro.
 *
 * Los suscriptores se guardan agrupados por empresa en vez de una lista global: antes
 * cada evento se pasaba por TODAS las conexiones abiertas para que cada una descartara
 * las ajenas, lo que ademas obligaba a poner un tope de listeners. Ahora un evento solo
 * toca las conexiones de su empresa y no hay tope.
 */
@Injectable()
export class EventBusService implements OnModuleDestroy {
  private readonly logger = new Logger(EventBusService.name);
  private readonly subscribers = new Map<string, Set<Handler>>();

  private publisher?: Redis;
  private receiver?: Redis;

  constructor(config: ConfigService) {
    const url = config.get<string>('REDIS_URL');
    if (!url) {
      this.logger.log('Eventos en vivo: modo memoria (sin REDIS_URL). Válido con un solo proceso de API.');
      return;
    }
    this.connectRedis(url);
  }

  private connectRedis(url: string) {
    // Redis exige una conexion dedicada para suscribirse: la que esta en modo
    // subscribe no puede ejecutar ningun otro comando.
    this.publisher = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 3 });
    this.receiver = new Redis(url, { lazyConnect: false, maxRetriesPerRequest: 3 });

    for (const [name, conn] of [['publicador', this.publisher], ['receptor', this.receiver]] as const) {
      // ioredis reintenta solo, varias veces por segundo. Loguear cada reintento
      // inunda el log y tapa todo lo demas, asi que se avisa una vez y después
      // como mucho una vez por minuto mientras siga caído.
      conn.on('error', (err) => this.logThrottled(name, err.message));
    }

    this.receiver.subscribe(CHANNEL, (err) => {
      if (err) {
        this.logger.error(`No se pudo suscribir al canal de eventos: ${err.message}`);
        return;
      }
      this.logger.log('Eventos en vivo: modo Redis. La API puede correr en varios procesos.');
    });

    this.receiver.on('message', (channel, raw) => {
      if (channel !== CHANNEL) return;
      try {
        this.deliverLocal(JSON.parse(raw) as AppEvent);
      } catch {
        this.logger.warn('Evento descartado: el mensaje del canal no es JSON válido');
      }
    });
  }

  publish(event: AppEvent) {
    if (!this.publisher) {
      this.deliverLocal(event);
      return;
    }

    // Con Redis no se entrega local acá: este proceso también está suscrito al canal
    // y el evento vuelve por ahí. Entregarlo en los dos lados lo duplicaría.
    this.publisher.publish(CHANNEL, JSON.stringify(event)).catch((err) => {
      this.logger.error(`No se pudo publicar en Redis, se entrega solo localmente: ${err.message}`);
      this.deliverLocal(event);
    });
  }

  /** Devuelve la función para desuscribirse; el llamador la usa al cerrar la conexión. */
  subscribe(tenantId: string, handler: Handler): () => void {
    let forTenant = this.subscribers.get(tenantId);
    if (!forTenant) {
      forTenant = new Set();
      this.subscribers.set(tenantId, forTenant);
    }
    forTenant.add(handler);

    return () => {
      const current = this.subscribers.get(tenantId);
      if (!current) return;
      current.delete(handler);
      // Sin esto el Map crece indefinidamente con entradas vacías de empresas
      // que en algún momento tuvieron a alguien conectado.
      if (current.size === 0) this.subscribers.delete(tenantId);
    };
  }

  private readonly lastLoggedAt = new Map<string, number>();

  /** Un error por conexión y después uno por minuto, mientras el problema persista. */
  private logThrottled(key: string, message: string) {
    const now = Date.now();
    const previous = this.lastLoggedAt.get(key) ?? 0;
    if (now - previous < 60_000) return;
    this.lastLoggedAt.set(key, now);
    this.logger.error(`Redis (${key}): ${message}`);
  }

  /** Conexiones abiertas, para diagnóstico. */
  get connectionCount(): number {
    let total = 0;
    for (const set of this.subscribers.values()) total += set.size;
    return total;
  }

  private deliverLocal(event: AppEvent) {
    const forTenant = this.subscribers.get(event.tenantId);
    if (!forTenant) return;
    for (const handler of forTenant) {
      try {
        handler(event);
      } catch (err) {
        // Una conexión que falla no puede impedir la entrega al resto.
        this.logger.warn(`Un suscriptor falló al recibir el evento: ${(err as Error).message}`);
      }
    }
  }

  async onModuleDestroy() {
    await Promise.allSettled([this.publisher?.quit(), this.receiver?.quit()]);
  }
}
