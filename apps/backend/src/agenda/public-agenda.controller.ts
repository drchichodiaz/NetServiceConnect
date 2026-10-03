import { Controller, Get, GoneException, Header, NotFoundException, Param } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DoctorLinkService } from './doctor-link.service';
import { dateColumn, fromLocal, MINUTES_PER_DAY, toLocal, weekdayOf } from './agenda-time';
import { doctorDayWindows } from './availability';
import { buildCalendar } from './calendar-feed';

/** Cuanto para atras lleva el calendario del doctor. Lo de antes ya no le sirve a nadie. */
const CALENDAR_PAST_DAYS = 30;

/**
 * Lo que ve el doctor al abrir el enlace del WhatsApp de la mañana. Publico a proposito:
 * el doctor no tiene usuario. Lo que protege es el codigo firmado (DoctorLinkService) y
 * que solo vale el dia para el que se mando.
 *
 * Muestra lo minimo para atender: hora, nombre del paciente, motivo, clinica y estado.
 * Nada de telefonos ni notas internas: el enlace viaja por WhatsApp y se puede reenviar.
 */
@Controller('public/agenda')
export class PublicAgendaController {
  constructor(
    private prisma: PrismaService,
    private links: DoctorLinkService,
  ) {}

  @Get('doctor-day/:token')
  async doctorDay(@Param('token') token: string) {
    const link = this.links.verify(token);
    if (!link) throw new NotFoundException('Este enlace no es válido');

    const doctor = await this.prisma.doctor.findUnique({
      where: { id: link.doctorId },
      include: { tenant: { select: { timezone: true, name: true } }, shifts: { where: { weekday: weekdayOf(link.date) } } },
    });
    if (!doctor || !doctor.isActive) throw new NotFoundException('Este enlace no es válido');

    const tz = doctor.tenant.timezone;
    const today = toLocal(new Date(), tz).date;
    if (link.date !== today) {
      // 410 y no 404: el enlace existio, pero era de otro dia. La pantalla lo explica.
      throw new GoneException({ message: 'Este enlace era de otro día', date: link.date });
    }

    const [exceptions, appointments, clinics] = await Promise.all([
      this.prisma.doctorException.findMany({ where: { doctorId: doctor.id, date: dateColumn(link.date) } }),
      this.prisma.appointment.findMany({
        where: {
          doctorId: doctor.id,
          status: { not: 'CANCELLED' },
          startsAt: { lt: fromLocal(link.date, MINUTES_PER_DAY, tz) },
          endsAt: { gt: fromLocal(link.date, 0, tz) },
        },
        orderBy: { startsAt: 'asc' },
        select: {
          id: true,
          startsAt: true,
          endsAt: true,
          reason: true,
          status: true,
          channelAccountId: true,
          contact: { select: { name: true } },
        },
      }),
      this.prisma.channelAccount.findMany({
        where: { tenantId: doctor.tenantId },
        select: { id: true, label: true, displayName: true, phoneNumber: true },
      }),
    ]);

    const clinicName = (id: string | null) => {
      const c = clinics.find((x) => x.id === id);
      return c?.label?.trim() || c?.displayName?.trim() || c?.phoneNumber || 'Clínica';
    };

    return {
      doctor: { code: doctor.code, name: doctor.name },
      company: doctor.tenant.name,
      date: link.date,
      timezone: tz,
      windows: doctorDayWindows(weekdayOf(link.date), doctor.shifts, exceptions).map((w) => ({
        start: w.start,
        end: w.end,
        clinic: clinicName(w.channelAccountId),
      })),
      appointments: appointments.map((a) => ({
        id: a.id,
        startMinute: toLocal(a.startsAt, tz).minute,
        endMinute: toLocal(a.endsAt, tz).minute,
        patient: a.contact.name?.trim() || 'Paciente',
        reason: a.reason,
        status: a.status,
        clinic: clinicName(a.channelAccountId),
      })),
    };
  }

  /**
   * El calendario del doctor para suscribirse desde Google Calendar, el iPhone u Outlook:
   * /public/agenda/calendar/<clave>.ics. El calendario lo vuelve a pedir solo cada tanto,
   * asi que una cita movida o cancelada se corrige sin que el doctor haga nada.
   *
   * A diferencia del enlace del dia, este no vence: lo protege una clave al azar guardada
   * en el doctor, que la clinica puede cambiar para dejar sin efecto el enlace anterior.
   * Por eso lleva lo mismo que el enlace del dia y nada mas: sin telefonos ni notas.
   */
  @Get('calendar/:file')
  @Header('Content-Type', 'text/calendar; charset=utf-8')
  @Header('Cache-Control', 'no-store')
  async calendar(@Param('file') file: string) {
    const doctor = await this.doctorByCalendarToken(String(file).replace(/\.ics$/i, ''));

    const [appointments, clinics] = await Promise.all([
      this.prisma.appointment.findMany({
        where: {
          doctorId: doctor.id,
          // Las canceladas no se listan: al desaparecer del calendario, el telefono las borra.
          status: { not: 'CANCELLED' },
          startsAt: { gte: new Date(Date.now() - CALENDAR_PAST_DAYS * 24 * 60 * 60 * 1000) },
        },
        orderBy: { startsAt: 'asc' },
        select: {
          id: true,
          startsAt: true,
          endsAt: true,
          updatedAt: true,
          reason: true,
          channelAccountId: true,
          contact: { select: { name: true } },
        },
      }),
      this.prisma.channelAccount.findMany({
        where: { tenantId: doctor.tenantId },
        select: { id: true, label: true, displayName: true, phoneNumber: true },
      }),
    ]);

    const clinicName = (id: string) => {
      const c = clinics.find((x) => x.id === id);
      return c?.label?.trim() || c?.displayName?.trim() || c?.phoneNumber || 'Clínica';
    };

    return buildCalendar(
      `${doctor.tenant.name} · ${doctor.name}`,
      doctor.tenant.timezone,
      appointments.map((a) => ({
        id: a.id,
        startsAt: a.startsAt,
        endsAt: a.endsAt,
        updatedAt: a.updatedAt,
        summary: a.contact.name?.trim() || 'Paciente',
        location: clinicName(a.channelAccountId),
        description: a.reason?.trim() || null,
      })),
    );
  }

  /**
   * De quien es el calendario, para la pagina /calendario/<clave> donde el doctor elige
   * a que calendario agregarlo. Solo el nombre: las citas van por el .ics.
   */
  @Get('calendar-info/:token')
  async calendarInfo(@Param('token') token: string) {
    const doctor = await this.doctorByCalendarToken(token);
    return { doctor: { code: doctor.code, name: doctor.name }, company: doctor.tenant.name };
  }

  private async doctorByCalendarToken(token: string) {
    if (!/^[A-Za-z0-9_-]{20,}$/.test(token)) throw new NotFoundException('Este enlace no es válido');
    const doctor = await this.prisma.doctor.findUnique({
      where: { calendarToken: token },
      include: { tenant: { select: { timezone: true, name: true } } },
    });
    if (!doctor || !doctor.isActive) throw new NotFoundException('Este enlace no es válido');
    return doctor;
  }
}
