import { BadRequestException, Controller, Headers, Param, Post, UseGuards } from '@nestjs/common';
import { AgendaTemplatesService } from './agenda-templates.service';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AppointmentsService } from '../agenda/appointments.service';
import { DoctorsService } from '../agenda/doctors.service';
import { AgendaNotifierService } from './agenda-notifier.service';

@UseGuards(JwtAuthGuard)
@Controller('agenda/appointments')
export class AgendaNotifyController {
  constructor(
    private appointments: AppointmentsService,
    private notifier: AgendaNotifierService,
  ) {}

  /**
   * "El doctor viene con unos minutos de atraso" al paciente de esta cita. Lo dispara la
   * recepcion cuando alargar la consulta anterior choca con esta.
   */
  @Post(':id/notify-delay')
  async notifyDelay(@CurrentUser() user: any, @Param('id') id: string) {
    // Mismo control de acceso que cualquier accion sobre la cita (agenda activa y permiso
    // sobre la clinica).
    const appt = await this.appointments.get(user, id);
    if (appt.status !== 'SCHEDULED' && appt.status !== 'CONFIRMED') {
      throw new BadRequestException('Esa cita ya no está pendiente');
    }
    const messageId = await this.notifier.send(id, 'DELAY');
    if (!messageId) throw new BadRequestException('No hay plantilla elegida para el aviso de atraso (Doctores y turnos › Avisos)');
    return { ok: true };
  }
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN' as any, 'SUPERVISOR' as any)
@Controller('agenda/templates')
export class AgendaTemplatesController {
  constructor(private templates: AgendaTemplatesService) {}

  /** Crea en Meta las plantillas de la agenda que falten y las deja elegidas en sus avisos. */
  @Post('defaults')
  createDefaults(@CurrentUser() user: any, @Headers('origin') origin?: string) {
    return this.templates.createDefaults(user.tenantId, origin);
  }
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN' as any, 'SUPERVISOR' as any)
@Controller('agenda/doctors')
export class AgendaDoctorNotifyController {
  constructor(
    private prisma: PrismaService,
    private doctors: DoctorsService,
    private notifier: AgendaNotifierService,
  ) {}

  /** Le manda de nuevo al doctor, por la linea de la clinica, el enlace para agregar su calendario de Google. */
  @Post(':id/calendar-link/send')
  async sendCalendarLink(@CurrentUser() user: any, @Param('id') id: string) {
    // Valida que la agenda este activa y que el doctor sea de esta empresa.
    const { token } = await this.doctors.calendarToken(user.tenantId, id);
    const messageId = await this.notifier.sendDoctorCalendarLink(id, token);
    if (!messageId) throw new BadRequestException('No hay plantilla elegida para el enlace del calendario (Doctores y turnos › Avisos)');
    await this.prisma.doctor.update({ where: { id }, data: { googleLinkSentAt: new Date(), googleError: null } });
    return { ok: true };
  }
}
