import { Controller, Get, GoneException, NotFoundException, Param } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DoctorLinkService } from './doctor-link.service';
import { dateColumn, fromLocal, MINUTES_PER_DAY, toLocal, weekdayOf } from './agenda-time';
import { doctorDayWindows } from './availability';

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
}
