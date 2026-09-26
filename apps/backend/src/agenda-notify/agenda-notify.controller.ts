import { BadRequestException, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AppointmentsService } from '../agenda/appointments.service';
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
