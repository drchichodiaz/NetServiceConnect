import { Module } from '@nestjs/common';
import { AgendaModule } from '../agenda/agenda.module';
import { GoogleCalendarClient } from './google-calendar.client';
import { AgendaGoogleSyncService } from './agenda-google-sync.service';
import { ClinicCalendarsService } from './clinic-calendars.service';
import { ClinicCalendarsController, TenantCalendarsController } from './clinic-calendars.controller';

/**
 * Las citas en Google Calendar: un calendario por doctor y uno por clinica. Depende de
 * AgendaModule solo para saber si la empresa tiene la agenda activada.
 */
@Module({
  imports: [AgendaModule],
  controllers: [ClinicCalendarsController, TenantCalendarsController],
  providers: [GoogleCalendarClient, AgendaGoogleSyncService, ClinicCalendarsService],
  // Empresas lo usa para borrar los calendarios de una empresa antes de borrarla.
  exports: [GoogleCalendarClient, AgendaGoogleSyncService],
})
export class AgendaGoogleModule {}
