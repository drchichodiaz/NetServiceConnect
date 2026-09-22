import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { WhatsAppAccountsService } from '../whatsapp/accounts.service';
import { TemplatesService } from '../templates/templates.service';
import { ContactIdentityService } from '../contacts/contact-identity.service';

/** Cada cuanto despierta el worker. */
const TICK_MS = 10_000;
/** Una fila tomada hace mas de esto quedo colgada por una caida del proceso. */
const STUCK_CLAIM_MS = 15 * 60_000;
/** Reintentos por destinatario antes de darlo por fallado. */
const MAX_ATTEMPTS = 3;
/** Tope por vuelta, para que una campaña rapida no monopolice el tick. */
const MAX_BATCH = 50;

/**
 * Errores de Meta que NO son culpa de un destinatario sino de la cuenta entera.
 * Frente a uno de estos hay que frenar la campaña: seguir intentando empeora las
 * cosas (mas rechazos bajan la calificacion de calidad del numero) y de todas formas
 * los siguientes van a fallar igual.
 */
const CAMPAIGN_STOPPING_CODES: Record<number, string> = {
  130429: 'Meta frenó los envíos por límite de velocidad',
  131048: 'Meta frenó los envíos por límite de spam de la cuenta',
  131031: 'La cuenta de WhatsApp está bloqueada por Meta',
  368: 'Meta bloqueó temporalmente la cuenta por incumplir sus políticas',
  190: 'El token de la línea venció o dejó de ser válido',
  131056: 'Meta frenó los envíos por límite de mensajes hacia el mismo número',
};

/**
 * Manda las campañas, de a poco y sin perder el hilo si el proceso se reinicia.
 *
 * Por que un loop sobre la base y no una cola:
 * este proyecto no tiene ninguna cola ni proceso de background, y el droplet donde
 * corre tiene 1 vCPU compartida con otras apps. Meter una cola significaba una
 * dependencia y un proceso mas. Con el estado por destinatario en la base se consigue
 * lo mismo que importa: al reiniciar, la campaña sigue sola por los PENDING, y el
 * unique (campaignId, contactId) impide mandarle dos veces a la misma persona.
 *
 * Como se evita que dos procesos manden lo mismo:
 * las filas se toman con `FOR UPDATE SKIP LOCKED`, asi que si algun dia corre mas de
 * una instancia de la API (que es justo lo que habilito Redis), cada una agarra filas
 * distintas en vez de duplicar envios.
 *
 * Lo que NO resuelve, dicho en voz alta:
 * si el proceso se cae justo despues de que Meta acepto un mensaje y antes de que lo
 * marquemos, esa fila queda en SENDING y a los 15 minutos vuelve a PENDING — esa
 * persona puede recibir el mensaje dos veces. Se prefiere eso a que no lo reciba
 * nunca, pero es una decision, no un descuido.
 */
@Injectable()
export class CampaignRunnerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CampaignRunnerService.name);
  private timer?: NodeJS.Timeout;
  /** Evita que dos ticks se pisen si una vuelta tarda mas que el intervalo. */
  private ticking = false;

  constructor(
    private prisma: PrismaService,
    private whatsapp: WhatsAppService,
    private accounts: WhatsAppAccountsService,
    private templates: TemplatesService,
    private identities: ContactIdentityService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_MS);
    // Sin unref, el timer mantiene vivo el proceso y un shutdown se queda colgado.
    this.timer.unref?.();
    this.logger.log(`Worker de campañas activo (cada ${TICK_MS / 1000}s)`);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.releaseStuckClaims();

      const running = await this.prisma.campaign.findMany({
        where: { status: 'RUNNING' },
        orderBy: { startedAt: 'asc' },
      });

      for (const campaign of running) {
        try {
          await this.advance(campaign);
        } catch (err: any) {
          this.logger.error(`[campaña ${campaign.id}] error inesperado: ${err?.message}`, err?.stack);
        }
      }
    } catch (err: any) {
      this.logger.error(`Fallo el tick del worker de campañas: ${err?.message}`);
    } finally {
      this.ticking = false;
    }
  }

  /**
   * Devuelve a la cola las filas que quedaron tomadas por un proceso que ya no esta.
   * Solo las que no llegaron a tener mensaje: si tienen messageId, el envio si salio.
   */
  private async releaseStuckClaims() {
    const cutoff = new Date(Date.now() - STUCK_CLAIM_MS);
    const { count } = await this.prisma.campaignRecipient.updateMany({
      where: { status: 'SENDING', claimedAt: { lt: cutoff }, messageId: null },
      data: { status: 'PENDING', claimedAt: null },
    });
    if (count > 0) {
      this.logger.warn(`Se devolvieron a pendiente ${count} destinatario(s) que quedaron tomados por un proceso caído`);
    }
  }

  private async advance(campaign: { id: string; tenantId: string; templateId: string; channelAccountId: string; ratePerMinute: number }) {
    const budget = await this.budgetFor(campaign);
    if (budget <= 0) return;

    const claimed = await this.claim(campaign.id, budget);
    if (claimed.length === 0) {
      await this.finishIfDone(campaign.id);
      return;
    }

    // La linea y la plantilla se resuelven una vez por vuelta, no por destinatario.
    const account = await this.accounts.findActiveCredsOrThrow(campaign.tenantId, campaign.channelAccountId).catch(() => null);
    if (!account) {
      await this.stop(campaign.id, 'La línea de esta campaña ya no está activa', claimed);
      return;
    }

    let template;
    try {
      template = await this.templates.findApprovedOrThrow(campaign.tenantId, campaign.templateId, account.wabaId);
    } catch (err: any) {
      await this.stop(campaign.id, err?.message || 'La plantilla dejó de estar disponible', claimed);
      return;
    }

    for (const id of claimed) {
      const stop = await this.sendOne(campaign, id, account, template);
      if (stop) {
        // Se frena la campaña y se devuelven a pendiente los que quedaban de este lote.
        await this.stop(campaign.id, stop, claimed.slice(claimed.indexOf(id) + 1));
        return;
      }
    }

    await this.finishIfDone(campaign.id);
  }

  /**
   * Cuantos se pueden mandar en esta vuelta.
   *
   * Se calcula mirando cuantos salieron de verdad en el ultimo minuto, en vez de
   * repartir el ritmo entre ticks: asi el ritmo se respeta aunque haya mas de un
   * proceso mandando, y aunque una vuelta tarde mas de lo previsto.
   */
  private async budgetFor(campaign: { id: string; ratePerMinute: number }) {
    const sentLastMinute = await this.prisma.campaignRecipient.count({
      where: { campaignId: campaign.id, sentAt: { gte: new Date(Date.now() - 60_000) } },
    });
    return Math.max(0, Math.min(campaign.ratePerMinute - sentLastMinute, MAX_BATCH));
  }

  /**
   * Toma un lote de pendientes marcandolos SENDING en la misma sentencia.
   * `FOR UPDATE SKIP LOCKED` es lo que hace que dos procesos no agarren lo mismo.
   */
  private async claim(campaignId: string, limit: number): Promise<string[]> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE "CampaignRecipient"
      SET status = 'SENDING', "claimedAt" = NOW()
      WHERE id IN (
        SELECT id FROM "CampaignRecipient"
        WHERE "campaignId" = ${campaignId} AND status = 'PENDING'
        ORDER BY id
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id
    `;
    return rows.map((r) => r.id);
  }

  /** Devuelve el motivo por el que hay que frenar la campaña, o null si siguio bien. */
  private async sendOne(
    campaign: { id: string; tenantId: string },
    recipientId: string,
    account: any,
    template: any,
  ): Promise<string | null> {
    const item = await this.prisma.campaignRecipient.findUnique({
      where: { id: recipientId },
      include: { contact: true },
    });
    if (!item) return null;

    // Se vuelve a chequear la baja: alguien pudo pedirla DESPUES de armar la campaña,
    // que es justo lo que pasa cuando el primer lote ya salio y la gente responde BAJA.
    if (item.contact.optedOutAt) {
      await this.mark(recipientId, 'SKIPPED', { error: 'El contacto pidió no recibir envíos' });
      await this.bump(campaign.id, 'skippedCount');
      return null;
    }

    const recipient = await this.identities.findExternalId(item.contactId, 'WHATSAPP');
    if (!recipient) {
      await this.mark(recipientId, 'SKIPPED', { error: 'El contacto no tiene número de WhatsApp' });
      await this.bump(campaign.id, 'skippedCount');
      return null;
    }

    const variables = (item.variables as any) ?? {};

    try {
      const { message, conversation } = await this.whatsapp.sendTemplateToContact({
        tenantId: campaign.tenantId,
        account,
        template,
        contact: item.contact,
        recipient,
        variables: { body: variables.body ?? [], header: variables.header ?? [], buttons: variables.buttons ?? [] },
        // Nadie lo escribio a mano y nadie queda a cargo del hilo: aparece sin asignar
        // y alguien lo toma si la persona responde.
        senderId: null,
        assignTo: null,
      });

      await this.mark(recipientId, 'SENT', {
        messageId: message.id,
        conversationId: conversation.id,
        sentAt: new Date(),
        error: null,
      });
      await this.bump(campaign.id, 'sentCount');
      return null;
    } catch (err: any) {
      const code = err?.response?.data?.error?.code ?? err?.metaCode;
      const stopReason = typeof code === 'number' ? CAMPAIGN_STOPPING_CODES[code] : undefined;
      if (stopReason) {
        this.logger.warn(`[campaña ${campaign.id}] frenada: ${stopReason} (código ${code})`);
        return stopReason;
      }

      const attempts = item.attempts + 1;
      const reason = err?.message || 'Error desconocido al enviar';
      if (attempts < MAX_ATTEMPTS) {
        // Vuelve a la cola: puede ser un corte de red o un 5xx pasajero.
        await this.mark(recipientId, 'PENDING', { attempts, error: reason, claimedAt: null });
        return null;
      }

      await this.mark(recipientId, 'FAILED', { attempts, error: reason });
      await this.bump(campaign.id, 'failedCount');
      return null;
    }
  }

  private async mark(id: string, status: 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED', data: Record<string, unknown>) {
    await this.prisma.campaignRecipient.update({ where: { id }, data: { status, ...data } as any });
  }

  private async bump(campaignId: string, field: 'sentCount' | 'failedCount' | 'skippedCount') {
    await this.prisma.campaign.update({ where: { id: campaignId }, data: { [field]: { increment: 1 } } });
  }

  /** Frena la campaña y devuelve a pendiente lo que habia tomado y no mando. */
  private async stop(campaignId: string, reason: string, unsentIds: string[]) {
    if (unsentIds.length > 0) {
      await this.prisma.campaignRecipient.updateMany({
        where: { id: { in: unsentIds }, status: 'SENDING' },
        data: { status: 'PENDING', claimedAt: null },
      });
    }
    await this.prisma.campaign.update({
      where: { id: campaignId },
      data: { status: 'PAUSED', pausedReason: reason },
    });
  }

  private async finishIfDone(campaignId: string) {
    const pending = await this.prisma.campaignRecipient.count({
      where: { campaignId, status: { in: ['PENDING', 'SENDING'] } },
    });
    if (pending > 0) return;

    await this.prisma.campaign.updateMany({
      where: { id: campaignId, status: 'RUNNING' },
      data: { status: 'DONE', finishedAt: new Date() },
    });
    this.logger.log(`[campaña ${campaignId}] terminada`);
  }
}
