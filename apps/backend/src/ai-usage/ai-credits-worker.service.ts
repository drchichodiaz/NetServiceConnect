import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { AiWalletService } from './ai-wallet.service';
import { AiAlertsService } from './ai-alerts.service';

/** Cada cuanto despierta. Una reserva vive 2 minutos, asi que un minuto alcanza. */
const TICK_MS = 60_000;

/**
 * Devuelve las reservas que quedaron colgadas, vence los lotes que llegaron a su fecha
 * y avisa a las empresas como va su consumo.
 *
 * Lo primero es lo que importa: si el proceso muere entre reservar y liquidar —un
 * deploy, un reinicio del contenedor, un timeout que nunca vuelve— esos creditos
 * quedarian retenidos para siempre. La empresa veria saldo que no puede gastar y nadie
 * podria explicar en que se fue. La especificacion original no lo contemplaba.
 *
 * Mismo patron que el worker de campañas: un setInterval propio, sin traer un
 * planificador entero para estas tareas.
 */
@Injectable()
export class AiCreditsWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiCreditsWorkerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private wallet: AiWalletService,
    private alerts: AiAlertsService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    // Sin unref, un proceso que termina se quedaria esperando a este intervalo.
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Publico para poder dispararlo desde una prueba sin esperar el intervalo. */
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.wallet.sweepExpired();
      await this.wallet.expireLots();
      // Va despues de vencer lotes: asi un saldo que bajo por vencimiento tambien
      // dispara el aviso, no solo el que bajo por consumo.
      await this.alerts.checkAll();
    } catch (err) {
      this.logger.error('Fallo el barrido de creditos de IA', err as any);
    } finally {
      this.running = false;
    }
  }
}
