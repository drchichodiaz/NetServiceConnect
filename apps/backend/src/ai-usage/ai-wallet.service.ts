import { Injectable, Logger } from '@nestjs/common';
import { Prisma, AiHold, AiLotKind, AiCreditEntryKind } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

/** Cuanto vive una reserva antes de que el barrido la devuelva. */
const HOLD_TTL_MS = 2 * 60 * 1000;

export type AuthorizeResult =
  | { ok: true; hold: AiHold }
  | { ok: false; reason: 'NO_CREDITS' | 'AI_DISABLED' };

export interface AuthorizeRequest {
  credits: number;
  feature: string;
  model: string;
  conversationId?: string | null;
  userId?: string | null;
}

export interface GrantRequest {
  kind: AiLotKind;
  credits: number;
  expiresAt?: Date | null;
  note?: string | null;
  periodId?: string | null;
  createdByUserId?: string | null;
}

/**
 * El saldo de creditos: autorizar, liquidar, acreditar y devolver lo que quedo colgado.
 *
 * Principio que ordena todo: **el saldo se protege en la autorizacion, no en la
 * liquidacion**. Nunca se autoriza una operacion sin saldo; pero una vez autorizada, se
 * liquida siempre por su costo real, aunque en un caso borde eso deje el saldo
 * levemente negativo. Los tokens ya se gastaron: un ledger que miente para cumplir la
 * regla de "nunca negativo" es peor que un sobregiro de milesimas de dolar.
 */
@Injectable()
export class AiWalletService {
  private readonly logger = new Logger(AiWalletService.name);

  constructor(private prisma: PrismaService) {}

  async ensureWallet(tenantId: string) {
    return this.prisma.aiWallet.upsert({
      where: { tenantId },
      update: {},
      create: { tenantId, balance: 0, reserved: 0, spendable: 0 },
    });
  }

  async getWallet(tenantId: string) {
    return this.prisma.aiWallet.findUnique({ where: { tenantId } });
  }

  /**
   * Retiene creditos antes de llamar al proveedor. Sin saldo no hay llamada.
   *
   * Es UN solo UPDATE condicional sobre la fila de la billetera: descuenta de lo
   * disponible y suma a lo reservado en la misma sentencia, y solo si alcanza. Si dos
   * turnos del mismo tenant llegan a la vez, el segundo ve el saldo ya descontado por el
   * primero — no hay ventana entre leer y decidir. La reserva y el UPDATE van en una
   * transaccion para que no pueda quedar saldo retenido sin una reserva que lo explique.
   */
  async authorize(tenantId: string, req: AuthorizeRequest): Promise<AuthorizeResult> {
    const credits = Math.max(0, Math.ceil(req.credits));

    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.aiWallet.updateMany({
        where: { tenantId, aiEnabled: true, spendable: { gte: credits } },
        data: { spendable: { decrement: credits }, reserved: { increment: credits } },
      });

      if (count === 0) {
        // Distinguir el motivo cuesta una lectura, pero solo ocurre cuando ya se
        // rechazo: el camino feliz sigue siendo una sola escritura.
        const wallet = await tx.aiWallet.findUnique({ where: { tenantId } });
        return { ok: false as const, reason: wallet && !wallet.aiEnabled ? ('AI_DISABLED' as const) : ('NO_CREDITS' as const) };
      }

      const hold = await tx.aiHold.create({
        data: {
          tenantId,
          credits,
          feature: req.feature,
          model: req.model,
          conversationId: req.conversationId ?? null,
          userId: req.userId ?? null,
          expiresAt: new Date(Date.now() + HOLD_TTL_MS),
        },
      });

      return { ok: true as const, hold };
    });
  }

  /**
   * Cierra una operacion: suelta la reserva y descuenta lo que realmente costo.
   *
   * El descuento se hace SIEMPRE, incluso si el barrido ya habia dado la reserva por
   * vencida (la llamada volvio tarde, pero volvio y gasto tokens). En ese caso no se
   * devuelve una reserva que ya no existe — ese es el unico camino por el que el saldo
   * puede quedar negativo, y es el correcto.
   */
  async settle(holdId: string, actualCredits: number, usageId?: string | null) {
    const credits = Math.max(0, Math.ceil(actualCredits));

    return this.prisma.$transaction(async (tx) => {
      const hold = await tx.aiHold.findUnique({ where: { id: holdId } });
      if (!hold) {
        this.logger.warn(`Se intento liquidar una reserva inexistente (${holdId}).`);
        return null;
      }

      // Solo se suelta si seguia viva: si el barrido llego primero, sus creditos ya
      // volvieron y devolverlos otra vez inventaria saldo.
      const { count } = await tx.aiHold.updateMany({
        where: { id: holdId, status: 'HELD' },
        data: { status: 'SETTLED', settledAt: new Date() },
      });

      if (count === 1) {
        await tx.aiWallet.update({
          where: { tenantId: hold.tenantId },
          data: { reserved: { decrement: hold.credits }, spendable: { increment: hold.credits } },
        });
      } else {
        this.logger.warn(
          `La reserva ${holdId} ya no estaba viva al liquidar (estado ${hold.status}): se cobra el consumo real igual.`,
        );
      }

      if (credits > 0) await this.consume(tx, hold.tenantId, credits, usageId ?? null);
      return hold;
    });
  }

  /** Devuelve una reserva entera: la llamada no llego a gastar nada. */
  async release(holdId: string, status: 'RELEASED' | 'EXPIRED' = 'RELEASED') {
    return this.prisma.$transaction(async (tx) => {
      const hold = await tx.aiHold.findUnique({ where: { id: holdId } });
      if (!hold) return null;

      const { count } = await tx.aiHold.updateMany({
        where: { id: holdId, status: 'HELD' },
        data: { status },
      });
      if (count === 0) return hold;

      await tx.aiWallet.update({
        where: { tenantId: hold.tenantId },
        data: { reserved: { decrement: hold.credits }, spendable: { increment: hold.credits } },
      });
      return hold;
    });
  }

  /**
   * Devuelve las reservas que quedaron colgadas.
   *
   * Sin esto, un contenedor reiniciado a mitad de una llamada retiene creditos para
   * siempre: la empresa ve saldo que no puede gastar y nadie puede explicar en que se
   * fue. Lo corre el barrido periodico.
   */
  async sweepExpired(limit = 200): Promise<number> {
    const expired = await this.prisma.aiHold.findMany({
      where: { status: 'HELD', expiresAt: { lt: new Date() } },
      select: { id: true },
      take: limit,
    });

    let freed = 0;
    for (const { id } of expired) {
      try {
        await this.release(id, 'EXPIRED');
        freed++;
      } catch (err) {
        this.logger.error(`No se pudo liberar la reserva vencida ${id}`, err as any);
      }
    }
    if (freed > 0) this.logger.warn(`Se liberaron ${freed} reservas de IA vencidas.`);
    return freed;
  }

  /**
   * Acredita un lote de creditos. Es la unica forma de que entre saldo: siempre deja
   * un movimiento en el libro mayor, nunca se toca el balance a mano.
   */
  async grant(tenantId: string, req: GrantRequest) {
    const credits = Math.max(1, Math.ceil(req.credits));
    await this.ensureWallet(tenantId);

    return this.prisma.$transaction(async (tx) => {
      const wallet = await tx.aiWallet.update({
        where: { tenantId },
        data: { balance: { increment: credits }, spendable: { increment: credits } },
      });

      const lot = await tx.aiCreditLot.create({
        data: {
          tenantId,
          kind: req.kind,
          credits,
          remaining: credits,
          expiresAt: req.expiresAt ?? null,
          periodId: req.periodId ?? null,
          note: req.note ?? null,
          createdByUserId: req.createdByUserId ?? null,
        },
      });

      await tx.aiCreditEntry.create({
        data: {
          tenantId,
          kind: req.kind as unknown as AiCreditEntryKind,
          credits,
          balanceBefore: wallet.balance - credits,
          balanceAfter: wallet.balance,
          lotId: lot.id,
          note: req.note ?? null,
          createdByUserId: req.createdByUserId ?? null,
        },
      });

      return { lot, balance: wallet.balance };
    });
  }

  /**
   * Vence los lotes que llegaron a su fecha. Lo que no se uso del mes no se acumula;
   * lo comprado no vence (expiresAt null) y este barrido no lo toca.
   */
  async expireLots(limit = 500): Promise<number> {
    const due = await this.prisma.aiCreditLot.findMany({
      where: { closedAt: null, remaining: { gt: 0 }, expiresAt: { not: null, lt: new Date() } },
      take: limit,
    });

    let expired = 0;
    for (const lot of due) {
      try {
        await this.prisma.$transaction(async (tx) => {
          const { count } = await tx.aiCreditLot.updateMany({
            where: { id: lot.id, closedAt: null },
            data: { remaining: 0, closedAt: new Date() },
          });
          if (count === 0) return;

          const wallet = await tx.aiWallet.update({
            where: { tenantId: lot.tenantId },
            data: { balance: { decrement: lot.remaining }, spendable: { decrement: lot.remaining } },
          });

          await tx.aiCreditEntry.create({
            data: {
              tenantId: lot.tenantId,
              kind: 'EXPIRATION',
              credits: -lot.remaining,
              balanceBefore: wallet.balance + lot.remaining,
              balanceAfter: wallet.balance,
              lotId: lot.id,
              note: 'Vencimiento de creditos del periodo',
            },
          });
        });
        expired++;
      } catch (err) {
        this.logger.error(`No se pudo vencer el lote ${lot.id}`, err as any);
      }
    }
    return expired;
  }

  /**
   * Descuenta creditos de los lotes vivos, del que vence antes al que no vence nunca.
   *
   * Es la regla de "consumir primero lo que se pierde" de la especificacion, pero
   * expresada como orden de consulta en vez de como una rama del codigo. Si los lotes no
   * alcanzan (una liquidacion tardia contra saldo ya gastado), la diferencia se asienta
   * igual sin lote: el consumo existio.
   */
  private async consume(
    tx: Prisma.TransactionClient,
    tenantId: string,
    credits: number,
    usageId: string | null,
  ) {
    const wallet = await tx.aiWallet.update({
      where: { tenantId },
      data: { balance: { decrement: credits }, spendable: { decrement: credits } },
    });

    const lots = await tx.aiCreditLot.findMany({
      where: { tenantId, closedAt: null, remaining: { gt: 0 } },
      orderBy: [{ expiresAt: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    });

    // El balance va bajando movimiento a movimiento para que la secuencia del libro
    // mayor se pueda auditar sin recalcular nada.
    let running = wallet.balance + credits;
    let pending = credits;

    for (const lot of lots) {
      if (pending <= 0) break;
      const take = Math.min(lot.remaining, pending);

      await tx.aiCreditLot.update({
        where: { id: lot.id },
        data: {
          remaining: { decrement: take },
          ...(lot.remaining === take ? { closedAt: new Date() } : {}),
        },
      });

      await tx.aiCreditEntry.create({
        data: {
          tenantId,
          kind: 'AI_USAGE',
          credits: -take,
          balanceBefore: running,
          balanceAfter: running - take,
          lotId: lot.id,
          usageId,
        },
      });

      running -= take;
      pending -= take;
    }

    if (pending > 0) {
      this.logger.warn(
        `El tenant ${tenantId} consumio ${pending} creditos sin lote que los cubra: la operacion ya estaba autorizada y el saldo queda en ${wallet.balance}.`,
      );
      await tx.aiCreditEntry.create({
        data: {
          tenantId,
          kind: 'AI_USAGE',
          credits: -pending,
          balanceBefore: running,
          balanceAfter: running - pending,
          usageId,
          note: 'Consumo liquidado sin lote disponible',
        },
      });
    }
  }
}
