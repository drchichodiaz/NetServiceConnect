import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { clinicName } from '../agenda/agenda-text';
import { GoogleCalendarClient, googleMessage, googleStatus } from './google-calendar.client';

/** Corto a proposito: el doctor esta acostumbrado a ver la cita en Google al instante. */
const TICK_MS = 15_000;
const BATCH = 50;
/** Tras un fallo se espera esto antes de reintentar lo mismo, para no martillar a Google. */
const RETRY_MS = 5 * 60_000;
/** Un "creating:<ms>" mas viejo que esto es de un proceso que murio a mitad de camino. */
const CLAIM_STALE_MS = 2 * 60_000;
/** Los colores de evento de Google van del "1" al "11". */
const GOOGLE_COLORS = 11;

const isReady = (calendarId: string | null): calendarId is string => !!calendarId && !calendarId.startsWith('creating:');

/**
 * El id del evento en Google sale del id de la cita. Google solo acepta 0-9 y a-v, y un
 * cuid puede traer w-z: el hash en hexadecimal cumple siempre.
 */
function eventIdFor(appointmentId: string) {
  return createHash('sha256').update(appointmentId).digest('hex');
}

/**
 * Mantiene en Google Calendar las citas de la agenda, en dos calendarios por cita: el
 * del doctor (compartido con su Gmail) y el de la clinica (compartido con la recepcion).
 * Los dos son de solo lectura para quien los ve: las citas se cambian en Connect.
 *
 * Todo en un worker y no al guardar: las citas se crean y se mueven desde muchos lados
 * (la agenda, el bot, la respuesta al recordatorio) y ninguno tiene que esperar a Google
 * ni fallar si Google falla.
 *
 *  1. Calendarios: crea y comparte el de cada doctor con Gmail y el de cada clinica con
 *     correos cargados; los borra cuando se les quitan.
 *  2. Citas: escribe en esos calendarios toda cita creada, movida o cancelada.
 *
 * Como sabe que una cita cambio: guarda en `googleSyncedAt` el `updatedAt` que tenia al
 * escribirla. Cualquier cambio posterior mueve `updatedAt` y la cita vuelve a estar
 * pendiente, la haya cambiado quien la haya cambiado. Por eso este servicio nunca deja
 * que sus propias marcas muevan `updatedAt`: ademas de volverla pendiente para siempre,
 * el worker de avisos confirma las citas "recien tocadas" y le escribiria al paciente.
 */
@Injectable()
export class AgendaGoogleSyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgendaGoogleSyncService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly retryAfter = new Map<string, number>();

  constructor(
    private prisma: PrismaService,
    private google: GoogleCalendarClient,
  ) {}

  onModuleInit() {
    if (!this.google.enabled) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
    this.timer.unref?.();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Publico para dispararlo desde una prueba sin esperar el intervalo. */
  async tick() {
    if (this.running || !this.google.enabled) return;
    this.running = true;
    try {
      await this.doctorCalendars();
      await this.clinicCalendars();
      await this.appointments();
    } catch (err) {
      this.logger.error('Fallo la vuelta de Google Calendar', err as any);
    } finally {
      this.running = false;
    }
  }

  private shouldWait(key: string) {
    const until = this.retryAfter.get(key);
    if (!until) return false;
    if (until > Date.now()) return true;
    this.retryAfter.delete(key);
    return false;
  }

  /** Un "creating:<ms>" vigente es de otro proceso que lo esta creando ahora. */
  private claimedByOther(calendarId: string | null) {
    return !!calendarId && Date.now() - Number(calendarId.split(':')[1]) <= CLAIM_STALE_MS;
  }

  // ─── Calendario de cada doctor ──────────────────────────────────────────────

  private async doctorCalendars() {
    const doctors = await this.prisma.doctor.findMany({
      where: { OR: [{ googleEmail: { not: null } }, { googleCalendarId: { not: null } }] },
      include: { tenant: { select: { name: true, timezone: true } } },
    });

    for (const doctor of doctors) {
      const upToDate = isReady(doctor.googleCalendarId) && doctor.googleSharedEmail === doctor.googleEmail;
      if (upToDate || this.shouldWait(`doctor:${doctor.id}`)) continue;
      try {
        if (!doctor.googleEmail) await this.removeDoctorCalendar(doctor.id, doctor.googleCalendarId);
        else if (isReady(doctor.googleCalendarId)) await this.reshareDoctor(doctor.id, doctor.googleCalendarId, doctor.googleSharedEmail, doctor.googleEmail);
        else await this.createDoctorCalendar(doctor);
      } catch (err) {
        this.retryAfter.set(`doctor:${doctor.id}`, Date.now() + RETRY_MS);
        const message = googleMessage(err);
        this.logger.warn(`Calendario de ${doctor.code} (${doctor.id}): ${message}`);
        await this.prisma.doctor.update({ where: { id: doctor.id }, data: { googleError: message.slice(0, 300) } });
      }
    }
  }

  private async createDoctorCalendar(doctor: {
    id: string;
    name: string;
    googleEmail: string | null;
    googleCalendarId: string | null;
    tenant: { name: string; timezone: string };
  }) {
    // Se toma el doctor antes de crear: si hay dos procesos, solo uno le crea el calendario.
    if (this.claimedByOther(doctor.googleCalendarId)) return;
    const claim = `creating:${Date.now()}`;
    const taken = await this.prisma.doctor.updateMany({
      where: { id: doctor.id, googleCalendarId: doctor.googleCalendarId },
      data: { googleCalendarId: claim },
    });
    if (taken.count === 0) return;

    let calendarId: string | null = null;
    try {
      calendarId = await this.google.createCalendar(`${doctor.tenant.name} · ${doctor.name}`, doctor.tenant.timezone);
      await this.google.share(calendarId, doctor.googleEmail!);
    } catch (err) {
      // Sin calendario a medias: uno creado y sin compartir no le sirve a nadie.
      if (calendarId) await this.google.deleteCalendar(calendarId).catch(() => {});
      await this.prisma.doctor.updateMany({ where: { id: doctor.id, googleCalendarId: claim }, data: { googleCalendarId: null } });
      throw err;
    }
    // googleLinkSentAt en null: el worker de avisos le manda el enlace por WhatsApp.
    await this.prisma.doctor.update({
      where: { id: doctor.id },
      data: { googleCalendarId: calendarId, googleSharedEmail: doctor.googleEmail, googleError: null, googleLinkSentAt: null },
    });
  }

  /** El doctor cambio de Gmail: mismo calendario, con las citas que ya tiene, para la cuenta nueva. */
  private async reshareDoctor(doctorId: string, calendarId: string, previous: string | null, email: string) {
    await this.google.share(calendarId, email);
    if (previous) await this.google.unshare(calendarId, previous);
    await this.prisma.doctor.update({
      where: { id: doctorId },
      data: { googleSharedEmail: email, googleError: null, googleLinkSentAt: null },
    });
  }

  /** Le sacaron el Gmail: el calendario se borra, y con el sus eventos. */
  private async removeDoctorCalendar(doctorId: string, calendarId: string | null) {
    if (isReady(calendarId)) {
      await this.google.deleteCalendar(calendarId);
      await this.forgetCalendar(calendarId);
    }
    await this.prisma.doctor.update({
      where: { id: doctorId },
      data: { googleCalendarId: null, googleSharedEmail: null, googleError: null, googleLinkSentAt: null },
    });
  }

  // ─── Calendario de cada clinica ─────────────────────────────────────────────

  private async clinicCalendars() {
    const rows = await this.prisma.clinicGoogleCalendar.findMany({
      include: { channelAccount: true, tenant: { select: { name: true, timezone: true } } },
    });

    for (const row of rows) {
      const wanted = [...new Set(row.emails)].sort();
      const shared = [...row.sharedEmails].sort();
      const upToDate = wanted.length > 0 && isReady(row.calendarId) && wanted.join() === shared.join();
      if (upToDate || this.shouldWait(`clinic:${row.id}`)) continue;
      try {
        if (wanted.length === 0) {
          // Sin correos no hay con quien compartirlo: se borra el calendario y la fila.
          if (isReady(row.calendarId)) {
            await this.google.deleteCalendar(row.calendarId);
            await this.forgetCalendar(row.calendarId);
          }
          await this.prisma.clinicGoogleCalendar.delete({ where: { id: row.id } });
          continue;
        }

        let calendarId = row.calendarId;
        if (!isReady(calendarId)) {
          if (this.claimedByOther(calendarId)) continue;
          const claim = `creating:${Date.now()}`;
          const taken = await this.prisma.clinicGoogleCalendar.updateMany({ where: { id: row.id, calendarId }, data: { calendarId: claim } });
          if (taken.count === 0) continue;
          try {
            calendarId = await this.google.createCalendar(`${row.tenant.name} · ${clinicName(row.channelAccount)}`, row.tenant.timezone);
          } catch (err) {
            await this.prisma.clinicGoogleCalendar.updateMany({ where: { id: row.id, calendarId: claim }, data: { calendarId: null } });
            throw err;
          }
          await this.prisma.clinicGoogleCalendar.update({ where: { id: row.id }, data: { calendarId, sharedEmails: [] } });
          shared.length = 0;
        }

        // De a uno y guardando cada paso: si Google rechaza un correo, los anteriores ya
        // quedaron compartidos y anotados, y el error dice cual fallo.
        const current = new Set(shared);
        for (const email of wanted) {
          if (current.has(email)) continue;
          await this.google.share(calendarId!, email);
          current.add(email);
          await this.prisma.clinicGoogleCalendar.update({ where: { id: row.id }, data: { sharedEmails: [...current] } });
        }
        for (const email of shared) {
          if (wanted.includes(email)) continue;
          await this.google.unshare(calendarId!, email);
          current.delete(email);
          await this.prisma.clinicGoogleCalendar.update({ where: { id: row.id }, data: { sharedEmails: [...current] } });
        }
        await this.prisma.clinicGoogleCalendar.update({ where: { id: row.id }, data: { error: null } });
      } catch (err) {
        this.retryAfter.set(`clinic:${row.id}`, Date.now() + RETRY_MS);
        const message = googleMessage(err);
        this.logger.warn(`Calendario de la clinica ${row.channelAccountId}: ${message}`);
        await this.prisma.clinicGoogleCalendar.updateMany({ where: { id: row.id }, data: { error: message.slice(0, 300) } });
      }
    }
  }

  /** Las citas dejan de figurar como escritas ahi. En SQL para no mover su updatedAt. */
  private async forgetCalendar(calendarId: string) {
    await this.prisma.$executeRaw`UPDATE "Appointment" SET "googleCalendarId" = NULL WHERE "googleCalendarId" = ${calendarId}`;
    await this.prisma.$executeRaw`UPDATE "Appointment" SET "googleClinicCalendarId" = NULL WHERE "googleClinicCalendarId" = ${calendarId}`;
  }

  // ─── Citas ──────────────────────────────────────────────────────────────────

  private async appointments() {
    // Pendiente es una de dos cosas:
    //  - ya esta escrita en algun calendario y cambio desde entonces (la que sea: movida,
    //    cancelada, pasada a otro doctor);
    //  - esta vigente y le falta estar en un calendario que hoy le toca: cita nueva, o
    //    calendario recien creado para su doctor o su clinica. Al crear un calendario no
    //    se vuelca el historial, y una cancelada que nunca estuvo no se manda.
    const pending = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT a.id
      FROM "Appointment" a
      JOIN "Doctor" d ON d.id = a."doctorId"
      LEFT JOIN "ClinicGoogleCalendar" c ON c."channelAccountId" = a."channelAccountId"
      WHERE (
          (a."googleCalendarId" IS NOT NULL OR a."googleClinicCalendarId" IS NOT NULL)
          AND (a."googleSyncedAt" IS NULL OR a."googleSyncedAt" < a."updatedAt")
        )
        OR (
          a.status::text <> 'CANCELLED'
          AND a."endsAt" > now() - interval '1 day'
          AND (
            (d."googleCalendarId" IS NOT NULL AND d."googleCalendarId" NOT LIKE 'creating:%'
              AND a."googleCalendarId" IS DISTINCT FROM d."googleCalendarId")
            OR (c."calendarId" IS NOT NULL AND c."calendarId" NOT LIKE 'creating:%'
              AND a."googleClinicCalendarId" IS DISTINCT FROM c."calendarId")
          )
        )
      ORDER BY a."updatedAt" ASC
      LIMIT ${BATCH}`;
    if (pending.length === 0) return;

    const colors = await this.doctorColors();
    for (const { id } of pending) {
      if (this.shouldWait(`appointment:${id}`)) continue;
      try {
        await this.syncAppointment(id, colors);
      } catch (err) {
        this.retryAfter.set(`appointment:${id}`, Date.now() + RETRY_MS);
        this.logger.warn(`Cita ${id}: ${googleMessage(err)}`);
      }
    }
  }

  /**
   * El color de cada doctor en el calendario de la clinica: su posicion entre los
   * doctores de la empresa, por orden de alta. No cambia nunca, porque un doctor se
   * desactiva y no se borra. Con mas de 11, los colores se repiten.
   */
  private async doctorColors() {
    const doctors = await this.prisma.doctor.findMany({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, tenantId: true },
    });
    const seen = new Map<string, number>();
    const colors = new Map<string, string>();
    for (const d of doctors) {
      const index = seen.get(d.tenantId) ?? 0;
      seen.set(d.tenantId, index + 1);
      colors.set(d.id, String((index % GOOGLE_COLORS) + 1));
    }
    return colors;
  }

  private async syncAppointment(id: string, colors: Map<string, string>) {
    const appt = await this.prisma.appointment.findUnique({
      where: { id },
      include: {
        doctor: { select: { id: true, code: true, googleCalendarId: true } },
        contact: { select: { name: true } },
        channelAccount: { include: { googleCalendar: true } },
      },
    });
    if (!appt) return;

    const eventId = eventIdFor(appt.id);
    const active = appt.status !== 'CANCELLED';
    const clinic = appt.channelAccount.googleCalendar;
    const doctorTarget = active && isReady(appt.doctor.googleCalendarId) ? appt.doctor.googleCalendarId : null;
    const clinicTarget = active && clinic && isReady(clinic.calendarId) ? clinic.calendarId : null;

    // Cambio de doctor, de clinica o se cancelo: sale del calendario donde estaba.
    if (appt.googleCalendarId && appt.googleCalendarId !== doctorTarget) {
      await this.google.deleteEvent(appt.googleCalendarId, eventId);
    }
    if (appt.googleClinicCalendarId && appt.googleClinicCalendarId !== clinicTarget) {
      await this.google.deleteEvent(appt.googleClinicCalendarId, eventId);
    }

    // Lo mismo que ve el doctor en su enlace del dia: sin telefonos ni notas internas.
    const patient = appt.contact.name?.trim() || 'Paciente';
    const event = {
      location: clinicName(appt.channelAccount),
      description: appt.reason?.trim() || null,
      startsAt: appt.startsAt,
      endsAt: appt.endsAt,
    };

    if (doctorTarget) {
      await this.write(doctorTarget, () => this.google.upsertEvent(doctorTarget, eventId, { ...event, summary: patient }), async () => {
        await this.prisma.doctor.updateMany({
          where: { id: appt.doctor.id, googleCalendarId: doctorTarget },
          data: { googleCalendarId: null, googleSharedEmail: null },
        });
      });
    }
    if (clinicTarget) {
      // En el de la clinica estan todos los doctores: el codigo adelante y un color por doctor.
      const summary = `${appt.doctor.code} · ${patient}`;
      await this.write(clinicTarget, () => this.google.upsertEvent(clinicTarget, eventId, { ...event, summary, colorId: colors.get(appt.doctor.id) }), async () => {
        await this.prisma.clinicGoogleCalendar.updateMany({
          where: { calendarId: clinicTarget },
          data: { calendarId: null, sharedEmails: [] },
        });
      });
    }

    // Se marca con el updatedAt LEIDO y solo si sigue siendo ese: si la cita cambio
    // mientras se escribia, queda pendiente y se escribe de nuevo en la proxima vuelta.
    // `updatedAt` va explicito para que Prisma no lo mueva (ver el comentario de la clase).
    await this.prisma.appointment.updateMany({
      where: { id: appt.id, updatedAt: appt.updatedAt },
      data: {
        googleCalendarId: doctorTarget,
        googleClinicCalendarId: clinicTarget,
        googleSyncedAt: appt.updatedAt,
        updatedAt: appt.updatedAt,
      },
    });
  }

  /**
   * Escribe en un calendario. Si el calendario ya no existe (lo borraron desde Google),
   * se lo olvida: en la proxima vuelta se crea otro y sus citas se vuelven a escribir ahi.
   */
  private async write(calendarId: string, action: () => Promise<void>, forgetOwner: () => Promise<void>) {
    try {
      await action();
    } catch (err) {
      if (googleStatus(err) === 404) {
        await this.forgetCalendar(calendarId);
        await forgetOwner();
      }
      throw err;
    }
  }
}
