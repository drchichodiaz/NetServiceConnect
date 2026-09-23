import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { AiCreditsService } from './ai-credits.service';
import { formatCredits } from './format-credits';

/** Los umbrales de la especificacion. El 100 % no avisa "vas a quedarte": ya se quedo. */
const THRESHOLDS = [50, 75, 90, 100];

/** A partir de aca el aviso tambien nos llega a nosotros: es una señal de venta. */
const NOTIFY_OPERATOR_FROM = 90;

interface AlertCopy {
  subject: string;
  headline: string;
  body: string;
}

/**
 * Avisa a la empresa como va su consumo de IA: 50 %, 75 %, 90 % y 100 %.
 *
 * Corre en el barrido y no en el camino de cada respuesta, por dos razones: no le suma
 * ni un milisegundo a lo que espera un cliente en WhatsApp, y ademas asi tambien se
 * entera cuando el saldo baja por un vencimiento y no por consumo. Un minuto de retraso
 * en un aviso de saldo no le importa a nadie.
 *
 * El porcentaje sale del mismo calculo que muestra la pantalla del cliente, a
 * proposito: un correo que dice 90 % y una pantalla que dice 72 % destruyen la confianza
 * en el saldo entero.
 */
@Injectable()
export class AiAlertsService {
  private readonly logger = new Logger(AiAlertsService.name);

  constructor(
    private prisma: PrismaService,
    private mail: MailService,
    private systemConfig: SystemConfigService,
    private credits: AiCreditsService,
  ) {}

  async checkAll(limit = 200): Promise<number> {
    const wallets = await this.prisma.aiWallet.findMany({
      where: { tenant: { aiBillingMode: 'PLATFORM', isActive: true } },
      select: { tenantId: true, lastAlertThreshold: true, tenant: { select: { name: true } } },
      take: limit,
    });

    let sent = 0;
    for (const wallet of wallets) {
      try {
        const snap = await this.credits.usageSnapshot(wallet.tenantId);
        // Sin nada acreditado todavia no hay de que avisar: el 0 % de nada es 0.
        if (snap.balance <= 0 && snap.creditsUsed <= 0) continue;

        const crossed = [...THRESHOLDS].reverse().find((t) => snap.usagePercent >= t) ?? 0;
        if (crossed === wallet.lastAlertThreshold) continue;

        // Si el porcentaje BAJO —una recarga, un ajuste— la escalera baja con el, en
        // silencio. Asi el aviso vuelve a estar disponible para cuando el consumo suba
        // otra vez, sin mandar un "usaste la mitad" en el momento mismo de recargar,
        // que es lo que pasaba reiniciando el umbral a cero al acreditar.
        if (crossed < wallet.lastAlertThreshold) {
          await this.prisma.aiWallet.update({
            where: { tenantId: wallet.tenantId },
            data: { lastAlertThreshold: crossed },
          });
          continue;
        }

        await this.notify(wallet.tenantId, wallet.tenant.name, crossed, snap.balance);

        // Se marca como avisado aunque el correo falle. Si no, un SMTP caido haria que
        // el barrido reintentara cada minuto para siempre y despues llegaran todos
        // juntos. El fallo queda en el log, que es donde se mira cuando alguien dice
        // "no me avisaron".
        await this.prisma.aiWallet.update({
          where: { tenantId: wallet.tenantId },
          data: { lastAlertThreshold: crossed, lastAlertAt: new Date() },
        });
        sent++;
      } catch (err) {
        this.logger.error(`No se pudo procesar el aviso de creditos de ${wallet.tenantId}`, err as any);
      }
    }
    return sent;
  }

  private async notify(tenantId: string, tenantName: string, threshold: number, balance: number) {
    const admins = await this.prisma.user.findMany({
      where: { tenantId, role: 'ADMIN', isActive: true },
      select: { email: true, name: true },
    });

    if (admins.length === 0) {
      this.logger.warn(`${tenantName} llego al ${threshold} % de sus creditos de IA y no tiene ningun admin activo a quien avisarle.`);
      return;
    }

    const copy = this.copyFor(threshold, balance);
    for (const admin of admins) {
      const result = await this.mail.send({
        to: admin.email,
        subject: copy.subject,
        text: `${copy.headline}\n\n${copy.body}`,
        html:
          `<div style="font-family:sans-serif;font-size:14px;color:#101819;line-height:1.5">` +
          `<p style="font-size:16px;font-weight:600;margin:0 0 12px">${copy.headline}</p>` +
          `<p style="margin:0 0 12px">${copy.body}</p>` +
          `<p style="margin:0;color:#6B7280;font-size:12px">` +
          `Podés ver tu saldo y tus movimientos en Configuración → IA.</p></div>`,
      });

      if (!result.sent) {
        this.logger.warn(`No salio el aviso de creditos al ${threshold} % para ${admin.email}: ${result.error}`);
      }
    }

    this.logger.log(`${tenantName} llego al ${threshold} % de sus creditos de IA. Avisados: ${admins.length}.`);

    if (threshold >= NOTIFY_OPERATOR_FROM) await this.notifyOperator(tenantName, threshold, balance);
  }

  /**
   * El mismo aviso, para nosotros.
   *
   * Hasta ahora el cliente se enteraba de que se estaba quedando sin creditos y nosotros
   * no: justo la informacion que sirve para venderle la recarga antes de que su bot deje
   * de responder. Va a la misma direccion que los reportes de soporte, que es de quien
   * opera este servidor y no del cliente.
   */
  private async notifyOperator(tenantName: string, threshold: number, balance: number) {
    const to = (await this.systemConfig.getSupportEmail())?.trim();
    if (!to) return;

    const agotado = threshold >= 100;
    const detalle = agotado
      ? `${tenantName} se quedo sin creditos de IA. Su asistente dejo de responder y las consultas pasan a sus agentes.`
      : `${tenantName} uso el ${threshold} % de sus creditos de IA. Le quedan ${formatCredits(balance)}.`;

    const result = await this.mail.send({
      to,
      subject: `[Connect · ${tenantName}] ${agotado ? 'Se quedó sin créditos de IA' : `Va por el ${threshold} % de sus créditos`}`,
      text: `${detalle}

Acreditá desde Créditos de IA, con el pago confirmado.`,
      html:
        '<div style="font-family:sans-serif;font-size:14px;color:#101819;line-height:1.6">' +
        `<p style="margin:0 0 8px">${detalle}</p>` +
        '<p style="margin:0;color:#6B7280;font-size:12px">Acreditá desde Créditos de IA, con el pago confirmado.</p></div>',
    });

    if (!result.sent) this.logger.warn(`No salio el aviso interno de ${tenantName} al ${threshold} %: ${result.error}`);
  }

  private copyFor(threshold: number, balance: number): AlertCopy {
    const quedan = `Te quedan ${formatCredits(balance)} créditos.`;

    if (threshold >= 100) {
      return {
        subject: 'Se agotaron tus créditos de IA',
        headline: 'Se agotaron tus créditos de IA',
        body:
          'El asistente con IA dejó de responder y las consultas pasan directamente a un agente. ' +
          'El resto del sistema —conversaciones, campañas, plantillas— sigue funcionando normalmente. ' +
          'Escribinos para recargar y que el asistente vuelva a atender.',
      };
    }
    if (threshold >= 90) {
      return {
        subject: 'Te queda poco saldo de IA',
        headline: 'Te queda poco saldo de IA',
        body:
          `Usaste el 90 % de tus créditos de IA. ${quedan} ` +
          'Cuando lleguen a cero, el asistente deja de responder y las consultas pasan a un agente. ' +
          'Escribinos si querés recargar antes de que eso pase.',
      };
    }
    if (threshold >= 75) {
      return {
        subject: 'Vas por el 75 % de tus créditos de IA',
        headline: 'Vas por el 75 % de tus créditos de IA',
        body: `${quedan} Todavía no hay nada que hacer, pero conviene saberlo por si el mes viene movido.`,
      };
    }
    return {
      subject: 'Usaste la mitad de tus créditos de IA',
      headline: 'Usaste la mitad de tus créditos de IA',
      body: `${quedan} Es solo para que lo tengas presente: el asistente sigue atendiendo con normalidad.`,
    };
  }
}
