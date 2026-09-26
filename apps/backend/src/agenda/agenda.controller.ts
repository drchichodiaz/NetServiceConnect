import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { AgendaSettingsService } from './agenda-settings.service';
import { DoctorsService } from './doctors.service';
import { AvailabilityService } from './availability.service';
import { AppointmentsService } from './appointments.service';
import { CreateDoctorDto, CreateExceptionDto, SetShiftsDto, UpdateAgendaSettingsDto, UpdateDoctorDto } from './dto/agenda.dto';
import { CreateAppointmentDto, ExtendAppointmentDto, SetAppointmentStatusDto, UpdateAppointmentDto } from './dto/appointments.dto';

/**
 * La coordinacion (ADMIN/SUPERVISOR) administra doctores, turnos, excepciones y avisos.
 * La recepcion (AGENT) lee la agenda y opera las citas de las clinicas que tiene permitidas.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN' as any, 'SUPERVISOR' as any)
@Controller('agenda')
export class AgendaController {
  constructor(
    private settings: AgendaSettingsService,
    private doctors: DoctorsService,
    private availability: AvailabilityService,
    private appointments: AppointmentsService,
  ) {}

  // Lo lee cualquier rol: el menu decide con esto si muestra la agenda.
  @Roles('ADMIN' as any, 'SUPERVISOR' as any, 'AGENT' as any)
  @Get('settings')
  getSettings(@CurrentUser() user: any) {
    return this.settings.get(user.tenantId);
  }

  @Patch('settings')
  updateSettings(@CurrentUser() user: any, @Body() dto: UpdateAgendaSettingsDto) {
    return this.settings.update(user.tenantId, dto);
  }

  @Roles('ADMIN' as any, 'SUPERVISOR' as any, 'AGENT' as any)
  @Get('doctors')
  listDoctors(@CurrentUser() user: any) {
    return this.doctors.list(user.tenantId);
  }

  @Post('doctors')
  createDoctor(@CurrentUser() user: any, @Body() dto: CreateDoctorDto) {
    return this.doctors.create(user.tenantId, dto);
  }

  @Patch('doctors/:id')
  updateDoctor(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: UpdateDoctorDto) {
    return this.doctors.update(user.tenantId, id, dto);
  }

  @Put('doctors/:id/shifts')
  setShifts(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: SetShiftsDto) {
    return this.doctors.setShifts(user.tenantId, id, dto);
  }

  @Roles('ADMIN' as any, 'SUPERVISOR' as any, 'AGENT' as any)
  @Get('exceptions')
  listExceptions(
    @CurrentUser() user: any,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('doctorId') doctorId?: string,
  ) {
    return this.doctors.listExceptions(user.tenantId, from || undefined, to || undefined, doctorId || undefined);
  }

  @Post('exceptions')
  createException(@CurrentUser() user: any, @Body() dto: CreateExceptionDto) {
    return this.doctors.createException(user.tenantId, dto);
  }

  @Delete('exceptions/:id')
  deleteException(@CurrentUser() user: any, @Param('id') id: string) {
    return this.doctors.deleteException(user.tenantId, id);
  }

  /** El dia de una clinica: ?channelAccountId=...&date=YYYY-MM-DD */
  @Roles('ADMIN' as any, 'SUPERVISOR' as any, 'AGENT' as any)
  @Get('day')
  day(@CurrentUser() user: any, @Query('channelAccountId') channelAccountId: string, @Query('date') date: string) {
    if (!channelAccountId || !date) throw new BadRequestException('Faltan la clínica o la fecha');
    return this.availability.day(user.tenantId, user, channelAccountId, date);
  }

  /** Resumen del mes de una clinica: ?channelAccountId=...&month=YYYY-MM */
  @Roles('ADMIN' as any, 'SUPERVISOR' as any, 'AGENT' as any)
  @Get('month')
  month(@CurrentUser() user: any, @Query('channelAccountId') channelAccountId: string, @Query('month') month: string) {
    if (!channelAccountId || !month) throw new BadRequestException('Faltan la clínica o el mes');
    return this.availability.month(user.tenantId, user, channelAccountId, month);
  }

  /** Quien puede atender: ?channelAccountId=...&startsAt=<ISO>&minutes=45 */
  @Roles('ADMIN' as any, 'SUPERVISOR' as any, 'AGENT' as any)
  @Get('free-doctors')
  async freeDoctors(
    @CurrentUser() user: any,
    @Query('channelAccountId') channelAccountId: string,
    @Query('startsAt') startsAt: string,
    @Query('minutes') minutes?: string,
    @Query('excludeAppointmentId') excludeAppointmentId?: string,
  ) {
    const start = new Date(startsAt);
    if (!channelAccountId || Number.isNaN(start.getTime())) throw new BadRequestException('Faltan la clínica o la hora');
    const settings = await this.settings.requireEnabled(user.tenantId);
    const length = minutes ? Number(minutes) : settings.slotMinutes;
    if (!Number.isInteger(length) || length < 15 || length > 240) throw new BadRequestException('Duración inválida');
    await this.availability.assertClinicAccess(user.tenantId, user, channelAccountId);
    return this.availability.freeDoctors(user.tenantId, channelAccountId, start, length, excludeAppointmentId || undefined);
  }

  // ─── Citas: las opera la recepcion, asi que todos los roles ─────────────────
  // El limite es por clinica (permiso por linea), no por rol.

  /** Proximas citas de un paciente: ?contactId=... */
  @Roles('ADMIN' as any, 'SUPERVISOR' as any, 'AGENT' as any)
  @Get('appointments')
  listAppointments(@CurrentUser() user: any, @Query('contactId') contactId: string) {
    if (!contactId) throw new BadRequestException('Falta el paciente');
    return this.appointments.listForContact(user, contactId);
  }

  @Roles('ADMIN' as any, 'SUPERVISOR' as any, 'AGENT' as any)
  @Get('appointments/:id')
  getAppointment(@CurrentUser() user: any, @Param('id') id: string) {
    return this.appointments.get(user, id);
  }

  @Roles('ADMIN' as any, 'SUPERVISOR' as any, 'AGENT' as any)
  @Post('appointments')
  createAppointment(@CurrentUser() user: any, @Body() dto: CreateAppointmentDto) {
    return this.appointments.create(user, dto);
  }

  @Roles('ADMIN' as any, 'SUPERVISOR' as any, 'AGENT' as any)
  @Patch('appointments/:id')
  updateAppointment(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: UpdateAppointmentDto) {
    return this.appointments.update(user, id, dto);
  }

  @Roles('ADMIN' as any, 'SUPERVISOR' as any, 'AGENT' as any)
  @Post('appointments/:id/extend')
  extendAppointment(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: ExtendAppointmentDto) {
    return this.appointments.extend(user, id, dto.minutes ?? 15);
  }

  @Roles('ADMIN' as any, 'SUPERVISOR' as any, 'AGENT' as any)
  @Post('appointments/:id/status')
  setAppointmentStatus(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: SetAppointmentStatusDto) {
    return this.appointments.setStatus(user, id, dto.status);
  }
}
