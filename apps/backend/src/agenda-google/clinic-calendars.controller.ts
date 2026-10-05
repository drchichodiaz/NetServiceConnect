import { BadRequestException, Body, Controller, Delete, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsString } from 'class-validator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';
import { ClinicCalendarsService } from './clinic-calendars.service';
import { AgendaGoogleSyncService } from './agenda-google-sync.service';
import { GoogleCalendarClient } from './google-calendar.client';

class SetClinicCalendarDto {
  /** Lista vacia = dejar de compartir el calendario de esa clinica (no se borra). */
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  emails: string[];
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN' as any, 'SUPERVISOR' as any)
@Controller('agenda/google-calendars')
export class ClinicCalendarsController {
  constructor(
    private calendars: ClinicCalendarsService,
    private sync: AgendaGoogleSyncService,
  ) {}

  /** El indicador de "ultima sincronizacion" de la pantalla. */
  @Get('status')
  status(@CurrentUser() user: any) {
    return this.sync.status(user.tenantId);
  }

  @Get()
  list(@CurrentUser() user: any) {
    return this.calendars.list(user.tenantId);
  }

  @Put(':channelAccountId')
  setEmails(@CurrentUser() user: any, @Param('channelAccountId') channelAccountId: string, @Body() dto: SetClinicCalendarDto) {
    return this.calendars.setEmails(user.tenantId, channelAccountId, dto.emails);
  }
}

/** Del operador de la plataforma, no de la empresa: es para la que deja el servicio. */
@UseGuards(JwtAuthGuard, SuperAdminGuard)
@Controller('agenda/google-calendars/tenant')
export class TenantCalendarsController {
  constructor(
    private sync: AgendaGoogleSyncService,
    private google: GoogleCalendarClient,
  ) {}

  /** Borra de Google todos los calendarios de esa empresa. No se puede deshacer. */
  @Delete(':tenantId')
  purge(@Param('tenantId') tenantId: string) {
    if (!this.google.enabled) throw new BadRequestException('Google Calendar no está configurado en este entorno');
    return this.sync.purgeTenant(tenantId);
  }
}
