import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ChannelAccessService } from '../common/services/channel-access.service';
import { AgendaSettingsService } from './agenda-settings.service';
import { addDays, dateColumn, fromDateColumn, fromLocal, isValidDate, MINUTES_PER_DAY, toLocal, weekdayOf } from './agenda-time';
import { doctorDayWindows, fitsInside, freeStarts, Interval, overlaps, WorkWindow } from './availability';

interface DayAppointment {
  id: string;
  doctorId: string;
  channelAccountId: string;
  startsAt: Date;
  endsAt: Date;
}

/** Minutos del dia local que ocupa una cita, recortados al dia pedido. */
function appointmentInterval(a: { startsAt: Date; endsAt: Date }, date: string, timeZone: string): Interval {
  const s = toLocal(a.startsAt, timeZone);
  const e = toLocal(a.endsAt, timeZone);
  return {
    start: s.date < date ? 0 : s.minute,
    end: e.date > date ? MINUTES_PER_DAY : e.minute,
  };
}

/**
 * Quien atiende donde y cuando, y quien esta libre.
 *
 * La disponibilidad de un doctor es UNA sola para todas las clinicas: las citas que
 * tiene en cualquier clinica lo ocupan. Por eso siempre se cargan sus citas del dia
 * sin filtrar por clinica, aunque la pantalla muestre una sola.
 */
@Injectable()
export class AvailabilityService {
  constructor(
    private prisma: PrismaService,
    private settings: AgendaSettingsService,
    private channelAccess: ChannelAccessService,
  ) {}

  /**
   * El dia de una clinica: los doctores que atienden ahi (con sus tramos), las citas
   * de la clinica, y lo que tienen ocupado en otras clinicas ese dia, sin datos del
   * paciente — la recepcion de una clinica no tiene por que ver los de otra.
   */
  async day(tenantId: string, user: { id: string }, channelAccountId: string, date: string) {
    const settings = await this.settings.requireEnabled(tenantId);
    if (!isValidDate(date)) throw new BadRequestException('Fecha inválida');
    await this.assertClinicAccess(tenantId, user, channelAccountId);

    const tz = settings.timezone;
    const plan = await this.loadDay(tenantId, date, tz);

    const clinicAppointments = await this.prisma.appointment.findMany({
      where: { tenantId, channelAccountId, status: { not: 'CANCELLED' }, ...this.dayRange(date, tz) },
      orderBy: { startsAt: 'asc' },
      include: {
        contact: { select: { id: true, name: true, phone: true } },
        doctor: { select: { id: true, code: true, name: true } },
      },
    });

    // En la grilla va todo doctor que atiende hoy aca, y tambien el que tiene una cita
    // aca aunque ya no figure en el turno (le cargaron una ausencia despues de agendar):
    // si no, esa cita desapareceria de la pantalla sin que nadie la haya movido.
    const withAppointmentsHere = new Set(clinicAppointments.map((a) => a.doctorId));
    const doctors = plan.doctors
      .map((d) => ({ ...d, clinicWindows: d.windows.filter((w) => w.channelAccountId === channelAccountId) }))
      .filter((d) => d.clinicWindows.length > 0 || withAppointmentsHere.has(d.id));

    // Citas de doctores inactivos que siguen en la agenda.
    const missing = [...withAppointmentsHere].filter((id) => !doctors.some((d) => d.id === id));
    const extra = missing.length
      ? await this.prisma.doctor.findMany({ where: { id: { in: missing } }, select: { id: true, code: true, name: true, isSpecialist: true, specialty: true } })
      : [];

    return {
      date,
      timezone: tz,
      slotMinutes: settings.slotMinutes,
      channelAccountId,
      doctors: [
        ...doctors.map((d) => ({
          id: d.id,
          code: d.code,
          name: d.name,
          isSpecialist: d.isSpecialist,
          specialty: d.specialty,
          windows: d.clinicWindows.map(({ start, end }) => ({ start, end })),
          busyElsewhere: plan.appointments
            .filter((a) => a.doctorId === d.id && a.channelAccountId !== channelAccountId)
            .map((a) => appointmentInterval(a, date, tz)),
        })),
        ...extra.map((d) => ({ ...d, windows: [], busyElsewhere: [] })),
      ].sort((a, b) => a.code.localeCompare(b.code)),
      appointments: clinicAppointments.map((a) => {
        const i = appointmentInterval(a, date, tz);
        return { ...a, startMinute: i.start, endMinute: i.end };
      }),
    };
  }

  /**
   * Los doctores que pueden atender [startsAt, startsAt + minutes) en esa clinica,
   * ordenados por quien tiene menos citas ese dia (para repartir el trabajo) y despues
   * por codigo. El primero es el que asigna el sistema.
   *
   * `excludeAppointmentId` es para mover o alargar una cita: su propio horario no la
   * ocupa a si misma.
   *
   * Los especialistas solo vienen con `includeSpecialists`, al final y nunca primeros:
   * no se les asigna nada solo. Para ellos el turno no es requisito (se los llama cuando
   * hace falta); alcanza con que no tengan otra cita a esa hora en ninguna clinica ni una
   * ausencia cargada. `inShift` dice si ademas cae en su turno de esta clinica.
   */
  async freeDoctors(
    tenantId: string,
    channelAccountId: string,
    startsAt: Date,
    minutes: number,
    excludeAppointmentId?: string,
    includeSpecialists = false,
  ) {
    const settings = await this.settings.requireEnabled(tenantId);
    const tz = settings.timezone;
    const endsAt = new Date(startsAt.getTime() + minutes * 60000);
    const start = toLocal(startsAt, tz);
    const end = toLocal(endsAt, tz);
    const sameDay = end.date === start.date || (end.minute === 0 && addDays(start.date, 1) === end.date);
    if (!sameDay) throw new BadRequestException('La cita tiene que terminar el mismo día');

    const slot: Interval = { start: start.minute, end: end.date === start.date ? end.minute : MINUTES_PER_DAY };
    const plan = await this.loadDay(tenantId, start.date, tz);

    const notBusy = (d: { id: string }) =>
      plan.appointments.every(
        (a) => a.doctorId !== d.id || a.id === excludeAppointmentId || !overlaps(appointmentInterval(a, start.date, tz), slot),
      );
    const inShift = (d: { windows: WorkWindow[] }) => fitsInside(d.windows.filter((w) => w.channelAccountId === channelAccountId), slot);
    const row = (d: (typeof plan.doctors)[number]) => ({
      id: d.id,
      code: d.code,
      name: d.name,
      isSpecialist: d.isSpecialist,
      specialty: d.specialty,
      inShift: inShift(d),
      appointmentsToday: plan.appointments.filter((a) => a.doctorId === d.id && a.id !== excludeAppointmentId).length,
    });

    const general = plan.doctors
      .filter((d) => d.isActive && !d.isSpecialist && inShift(d) && notBusy(d))
      .map(row)
      .sort((a, b) => a.appointmentsToday - b.appointmentsToday || a.code.localeCompare(b.code));
    if (!includeSpecialists) return general;

    const specialists = plan.doctors
      .filter((d) => d.isActive && d.isSpecialist && notBusy(d) && !d.absences.some((i) => overlaps(i, slot)))
      .map(row)
      .sort((a, b) => a.code.localeCompare(b.code));
    return [...general, ...specialists];
  }

  /**
   * El mes de una clinica, dia por dia: cuantas citas hay y que tan lleno esta.
   *
   * "Lleno" es minutos agendados sobre minutos de atencion de los doctores en esa
   * clinica ese dia (turnos menos ausencias). Es la cuenta que dice si un dia tiene lugar;
   * contar citas sola no alcanza, porque 10 citas es mucho con un doctor y poco con cuatro.
   *
   * Se cargan turnos, excepciones y citas del mes de una sola vez y se calcula en
   * memoria: pedir el dia 30 veces serian 90 consultas por cada vista del mes.
   */
  async month(tenantId: string, user: { id: string }, channelAccountId: string, month: string) {
    const settings = await this.settings.requireEnabled(tenantId);
    if (!/^\d{4}-\d{2}$/.test(month) || !isValidDate(`${month}-01`)) throw new BadRequestException('Mes inválido');
    await this.assertClinicAccess(tenantId, user, channelAccountId);

    const tz = settings.timezone;
    const first = `${month}-01`;
    const dates: string[] = [];
    for (let d = first; d.startsWith(month); d = addDays(d, 1)) dates.push(d);
    const last = dates[dates.length - 1];

    // La ocupacion es la de los doctores generales: los especialistas vienen cuando se
    // los llama, no tienen horas "disponibles" contra las que medirlos. Sus citas si se
    // cuentan en la cantidad del dia.
    const [doctors, exceptions, appointments] = await Promise.all([
      this.prisma.doctor.findMany({ where: { tenantId, isActive: true, isSpecialist: false }, include: { shifts: true } }),
      this.prisma.doctorException.findMany({ where: { tenantId, date: { gte: dateColumn(first), lte: dateColumn(last) } } }),
      this.prisma.appointment.findMany({
        where: {
          tenantId,
          channelAccountId,
          status: { not: 'CANCELLED' },
          startsAt: { lt: fromLocal(last, MINUTES_PER_DAY, tz) },
          endsAt: { gt: fromLocal(first, 0, tz) },
        },
        select: { startsAt: true, endsAt: true, doctor: { select: { isSpecialist: true } } },
      }),
    ]);

    const byDate = new Map<string, { count: number; booked: number }>();
    for (const a of appointments) {
      const date = toLocal(a.startsAt, tz).date;
      const i = appointmentInterval(a, date, tz);
      const row = byDate.get(date) ?? { count: 0, booked: 0 };
      row.count++;
      if (!a.doctor.isSpecialist) row.booked += i.end - i.start;
      byDate.set(date, row);
    }

    return {
      month,
      timezone: tz,
      days: dates.map((date) => {
        const weekday = weekdayOf(date);
        const exOfDay = exceptions.filter((e) => fromDateColumn(e.date) === date);
        const available = doctors.reduce((sum, d) => {
          const windows = doctorDayWindows(weekday, d.shifts, exOfDay.filter((e) => e.doctorId === d.id));
          return sum + windows.filter((w) => w.channelAccountId === channelAccountId).reduce((s, w) => s + (w.end - w.start), 0);
        }, 0);
        const row = byDate.get(date) ?? { count: 0, booked: 0 };
        return {
          date,
          appointments: row.count,
          availableMinutes: available,
          bookedMinutes: row.booked,
          // Sin atencion ese dia no hay porcentaje: null, no 0 ("vacio" y "cerrado" no son lo mismo).
          occupancy: available > 0 ? Math.min(1, row.booked / available) : null,
        };
      }),
    };
  }

  /**
   * Lo que se le ofrece al paciente que reserva por WhatsApp: los dias desde `fromDate`
   * (inclusive, `days` dias) con los horarios en que algun doctor de la clinica tiene
   * libre una cita entera de `minutes`. Solo vienen los dias que tienen algun horario.
   *
   * Nada que empiece antes de `notBefore` (ahora mas la anticipacion minima). Como en
   * month(), se carga el rango de una vez y se calcula en memoria; las citas son las de
   * todas las clinicas, porque un doctor que rota esta ocupado donde sea que atienda.
   *
   * `excludeAppointmentId`: al cambiar una cita de horario, la cita no se ocupa a si misma.
   */
  async bookableStarts(
    tenantId: string,
    channelAccountId: string,
    fromDate: string,
    days: number,
    minutes: number,
    notBefore: Date,
    excludeAppointmentId?: string,
  ) {
    const settings = await this.settings.requireEnabled(tenantId);
    const tz = settings.timezone;
    const limit = toLocal(notBefore, tz);
    const dates: string[] = [];
    for (let i = 0; i < days; i++) {
      const date = addDays(fromDate, i);
      if (date >= limit.date) dates.push(date);
    }
    if (dates.length === 0) return [];
    const first = dates[0];
    const last = dates[dates.length - 1];

    // Solo doctores generales: con un especialista se agenda a mano.
    const [doctors, exceptions, appointments] = await Promise.all([
      this.prisma.doctor.findMany({ where: { tenantId, isActive: true, isSpecialist: false }, include: { shifts: true } }),
      this.prisma.doctorException.findMany({ where: { tenantId, date: { gte: dateColumn(first), lte: dateColumn(last) } } }),
      this.prisma.appointment.findMany({
        where: {
          tenantId,
          status: { not: 'CANCELLED' },
          startsAt: { lt: fromLocal(last, MINUTES_PER_DAY, tz) },
          endsAt: { gt: fromLocal(first, 0, tz) },
          ...(excludeAppointmentId && { id: { not: excludeAppointmentId } }),
        },
        select: { doctorId: true, startsAt: true, endsAt: true },
      }),
    ]);

    const result: { date: string; starts: number[] }[] = [];
    for (const date of dates) {
      const weekday = weekdayOf(date);
      const exOfDay = exceptions.filter((e) => fromDateColumn(e.date) === date);
      const dayStart = fromLocal(date, 0, tz).getTime();
      const dayEnd = fromLocal(date, MINUTES_PER_DAY, tz).getTime();
      const perDoctor = doctors.map((d) => ({
        windows: doctorDayWindows(weekday, d.shifts, exOfDay.filter((e) => e.doctorId === d.id)).filter(
          (w) => w.channelAccountId === channelAccountId,
        ),
        busy: appointments
          .filter((a) => a.doctorId === d.id && a.startsAt.getTime() < dayEnd && a.endsAt.getTime() > dayStart)
          .map((a) => appointmentInterval(a, date, tz)),
      }));
      const starts = freeStarts(perDoctor, minutes, date === limit.date ? limit.minute : 0);
      if (starts.length > 0) result.push({ date, starts });
    }
    return result;
  }

  /** Todos los doctores con sus tramos del dia, y todas las citas activas del dia. */
  private async loadDay(tenantId: string, date: string, tz: string) {
    const weekday = weekdayOf(date);
    const [doctors, exceptions, appointments] = await Promise.all([
      this.prisma.doctor.findMany({
        where: { tenantId },
        include: { shifts: { where: { weekday } } },
      }),
      this.prisma.doctorException.findMany({ where: { tenantId, date: dateColumn(date) } }),
      this.prisma.appointment.findMany({
        where: { tenantId, status: { not: 'CANCELLED' }, ...this.dayRange(date, tz) },
        select: { id: true, doctorId: true, channelAccountId: true, startsAt: true, endsAt: true },
      }),
    ]);

    return {
      doctors: doctors.map((d) => ({
        id: d.id,
        code: d.code,
        name: d.name,
        isActive: d.isActive,
        isSpecialist: d.isSpecialist,
        specialty: d.specialty,
        // Para el especialista, que no necesita turno: las ausencias igual lo bloquean.
        absences: exceptions
          .filter((e) => e.doctorId === d.id && e.kind === 'ABSENT')
          .map((e): Interval => (e.startMinute === null ? { start: 0, end: MINUTES_PER_DAY } : { start: e.startMinute, end: e.endMinute! })),
        // Un doctor inactivo no atiende: sin tramos, no aparece libre ni en la grilla
        // (salvo que tenga citas viejas, que day() agrega aparte).
        windows: d.isActive
          ? doctorDayWindows(weekday, d.shifts, exceptions.filter((e) => e.doctorId === d.id))
          : ([] as WorkWindow[]),
      })),
      appointments: appointments as DayAppointment[],
    };
  }

  /** Citas que tocan el dia local: empiezan antes de que termine y terminan despues de que empieza. */
  private dayRange(date: string, tz: string) {
    return {
      startsAt: { lt: fromLocal(date, MINUTES_PER_DAY, tz) },
      endsAt: { gt: fromLocal(date, 0, tz) },
    };
  }

  /** La recepcion limitada a una linea solo ve la agenda de esa clinica. */
  async assertClinicAccess(tenantId: string, user: { id: string }, channelAccountId: string) {
    const line = await this.prisma.channelAccount.findFirst({
      where: { id: channelAccountId, tenantId, channel: 'WHATSAPP' },
      select: { id: true },
    });
    if (!line) throw new BadRequestException('Esa clínica no existe');
    if (!(await this.channelAccess.canAccessAccount(user.id, channelAccountId))) {
      throw new ForbiddenException('No tiene acceso a la agenda de esa clínica');
    }
  }
}
