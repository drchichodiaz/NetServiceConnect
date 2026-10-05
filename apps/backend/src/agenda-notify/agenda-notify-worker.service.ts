import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AgendaNotifierService, NoticeKind } from './agenda-notifier.service';
import { DoctorsService } from '../agenda/doctors.service';
import { addDays, dateColumn, fromLocal, MINUTES_PER_DAY, toLocal } from '../agenda/agenda-time';

const TICK_MS = 60_000;
/** Tope por vuelta y por empresa, para que un atraso no mande todo de golpe. */
const BATCH = 25;
/**
 * Solo se confirman citas creadas o movidas hace poco. Sin esto, prender la
 * confirmacion en una empresa con citas ya cargadas le mandaria una a cada una.
 */
const CONFIRM_WINDOW_MS = 2 * 3600_000;

/**
 * Manda las confirmaciones y los recordatorios de la agenda.
 *
 * Por que un worker y no mandar al guardar la cita: si Meta tarda o falla, la
 * recepcion no tiene que quedarse esperando ni ver un error al agendar. La cita se
 * guarda siempre; el aviso sale en el minuto siguiente, y si no sale, el motivo queda en
 * la cita (notifyError).
 *
 * Como se evita mandar dos veces: cada cita se TOMA marcando la fecha de envio antes de
 * mandar (updateMany condicionado a que siga en null). Si hay dos procesos, o el worker
 * se reinicia a mitad de camino, la cita tomada no la vuelve a tomar nadie. Se prefiere
 * que un aviso se pierda en una caida a que el paciente lo reciba dos veces; el error
 * queda anotado en la cita igual.
 */
@Injectable()
export class AgendaNotifyWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgendaNotifyWorkerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private prisma: PrismaService,
    private notifier: AgendaNotifierService,
    private doctors: DoctorsService,
  ) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Publico para dispararlo desde una prueba sin esperar el intervalo. */
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const tenants = await this.prisma.agendaSettings.findMany({
        where: { enabled: true },
        include: { tenant: { select: { timezone: true } } },
      });
      for (const s of tenants) {
        if (s.confirmationTemplateId) await this.confirmations(s.tenantId);
        if (s.reminderTemplateId) await this.reminders(s.tenantId, s.reminderHoursBefore, s.reminderTemplateId, s.tenant.timezone);
        if (s.doctorSummaryTemplateId) await this.doctorSummaries(s.tenantId, s.doctorSummaryHour, s.tenant.timezone);
        if (s.doctorCalendarTemplateId) await this.calendarLinks(s.tenantId, s.doctorCalendarTemplateId);
      }
    } catch (err) {
      this.logger.error('Fallo la vuelta de avisos de la agenda', err as any);
    } finally {
      this.running = false;
    }
  }

  private async confirmations(tenantId: string) {
    const now = new Date();
    const due = await this.prisma.appointment.findMany({
      where: {
        tenantId,
        status: 'SCHEDULED',
        confirmationSentAt: null,
        startsAt: { gt: now },
        updatedAt: { gte: new Date(now.getTime() - CONFIRM_WINDOW_MS) },
      },
      orderBy: { createdAt: 'asc' },
      take: BATCH,
      select: { id: true },
    });
    for (const a of due) await this.deliver(a.id, 'CONFIRMATION', { confirmationSentAt: now }, 'confirmationSentAt', 'confirmationMessageId');
  }

  /**
   * El recordatorio sale cuando falta `hours` para la cita. No sale si la cita se
   * agendo (o se confirmo el horario nuevo) ya dentro de esa ventana: el paciente acaba
   * de recibir la confirmacion y un segundo mensaje minutos despues es ruido.
   */
  private async reminders(tenantId: string, hours: number, templateId: string, timeZone: string) {
    const now = new Date();
    const windowMs = hours * 3600_000;
    // Si el texto dice "mañana", solo sale para citas que son mañana. Si no, una cita de
    // esta noche que entra en la ventana (se prendio la agenda, se reinicio el server)
    // recibiria "le recordamos su cita de mañana" y el paciente vendria un dia tarde.
    const template = await this.prisma.messageTemplate.findUnique({ where: { id: templateId }, select: { bodyText: true } });
    const saysTomorrow = /mañana/i.test(template?.bodyText ?? '');
    const tomorrow = addDays(toLocal(now, timeZone).date, 1);
    const due = await this.prisma.appointment.findMany({
      where: {
        tenantId,
        status: 'SCHEDULED',
        reminderSentAt: null,
        startsAt: { gt: now, lte: new Date(now.getTime() + windowMs) },
      },
      orderBy: { startsAt: 'asc' },
      take: BATCH,
      select: { id: true, startsAt: true, confirmationSentAt: true },
    });
    for (const a of due) {
      const windowOpensAt = a.startsAt.getTime() - windowMs;
      if (a.confirmationSentAt && a.confirmationSentAt.getTime() > windowOpensAt) continue;
      if (saysTomorrow && toLocal(a.startsAt, timeZone).date !== tomorrow) continue;
      await this.deliver(a.id, 'REMINDER', { reminderSentAt: now }, 'reminderSentAt', 'reminderMessageId');
    }
  }

  /**
   * El resumen de la mañana a cada doctor que atiende hoy. Sale desde la hora elegida
   * (7:00 por defecto) y hasta el mediodia: si el server estuvo caido a las 7 igual sale
   * a las 9, pero no a las 5 de la tarde, cuando ya no sirve.
   *
   * Una vez por doctor y por dia: la fila de DoctorDailySummary tiene unique (doctor, dia)
   * y se crea ANTES de mandar, asi que un reinicio o un segundo proceso no lo repiten.
   */
  private async doctorSummaries(tenantId: string, hour: number, timeZone: string) {
    const now = toLocal(new Date(), timeZone);
    if (now.minute < hour * 60 || now.minute >= 12 * 60) return;
    const date = now.date;

    const counts = await this.prisma.appointment.groupBy({
      by: ['doctorId'],
      where: {
        tenantId,
        status: { not: 'CANCELLED' },
        startsAt: { lt: new Date(fromLocal(date, MINUTES_PER_DAY, timeZone)) },
        endsAt: { gt: new Date(fromLocal(date, 0, timeZone)) },
      },
      _count: { _all: true },
    });
    if (counts.length === 0) return;

    const doctors = await this.prisma.doctor.findMany({
      where: { id: { in: counts.map((c) => c.doctorId) }, isActive: true, phone: { not: null } },
      select: { id: true },
    });
    for (const d of doctors) {
      let summaryId: string;
      try {
        summaryId = (await this.prisma.doctorDailySummary.create({ data: { tenantId, doctorId: d.id, date: dateColumn(date) } })).id;
      } catch {
        continue; // ya se mando (o se esta mandando) hoy
      }
      try {
        const messageId = await this.notifier.sendDoctorSummary(d.id, date);
        await this.prisma.doctorDailySummary.update({ where: { id: summaryId }, data: { messageId } });
      } catch (err: any) {
        const reason = err?.response?.message || err?.message || 'Error desconocido';
        this.logger.warn(`[agenda] no salio el resumen del doctor ${d.id}: ${reason}`);
        await this.prisma.doctorDailySummary.update({ where: { id: summaryId }, data: { error: String(reason).slice(0, 300) } });
      }
    }
  }

  /**
   * El enlace para agregar su calendario de Google, a cada doctor al que se le acaba de
   * compartir (AgendaGoogleSyncService deja googleLinkSentAt en null). Una sola vez: se
   * marca antes de mandar, como los demas avisos.
   *
   * Mientras Meta no apruebe la plantilla no se toma a nadie: asi el enlace sale solo el
   * dia que la aprueban, en vez de perderse por haberlo intentado antes de tiempo.
   */
  private async calendarLinks(tenantId: string, templateId: string) {
    const due = await this.prisma.doctor.findMany({
      where: { tenantId, isActive: true, phone: { not: null }, googleSharedEmail: { not: null }, googleLinkSentAt: null },
      take: BATCH,
      select: { id: true, googleCalendarId: true },
    });
    if (due.length === 0) return;

    const chosen = await this.prisma.messageTemplate.findFirst({ where: { id: templateId, tenantId }, select: { name: true, language: true } });
    if (!chosen) return;
    const approved = await this.prisma.messageTemplate.count({
      where: { tenantId, name: chosen.name, language: chosen.language, status: 'APPROVED' },
    });
    if (approved === 0) return;

    for (const d of due) {
      if (!d.googleCalendarId || d.googleCalendarId.startsWith('creating:')) continue;
      const taken = await this.prisma.doctor.updateMany({ where: { id: d.id, googleLinkSentAt: null }, data: { googleLinkSentAt: new Date() } });
      if (taken.count === 0) continue;
      try {
        const { token } = await this.doctors.calendarToken(tenantId, d.id);
        await this.notifier.sendDoctorCalendarLink(d.id, token);
      } catch (err: any) {
        const reason = err?.response?.message || err?.message || 'Error desconocido';
        this.logger.warn(`[agenda] no salio el enlace del calendario del doctor ${d.id}: ${reason}`);
        await this.prisma.doctor.update({
          where: { id: d.id },
          data: { googleError: `No se le pudo enviar el enlace por WhatsApp: ${String(reason).slice(0, 220)}` },
        });
      }
    }
  }

  private async deliver(
    id: string,
    kind: NoticeKind,
    claim: Record<string, Date>,
    claimField: 'confirmationSentAt' | 'reminderSentAt',
    messageField: 'confirmationMessageId' | 'reminderMessageId',
  ) {
    const taken = await this.prisma.appointment.updateMany({ where: { id, [claimField]: null }, data: claim });
    if (taken.count === 0) return;
    try {
      const messageId = await this.notifier.send(id, kind);
      await this.prisma.appointment.update({ where: { id }, data: { [messageField]: messageId, notifyError: null } });
    } catch (err: any) {
      const reason = err?.response?.message || err?.message || 'Error desconocido';
      this.logger.warn(`[agenda] no salio el aviso ${kind} de la cita ${id}: ${reason}`);
      await this.prisma.appointment.update({ where: { id }, data: { notifyError: String(reason).slice(0, 300) } });
    }
  }
}
