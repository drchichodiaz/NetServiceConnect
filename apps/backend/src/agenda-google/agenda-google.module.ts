import { Module } from '@nestjs/common';
import { AgendaModule } from '../agenda/agenda.module';
import { GoogleCalendarClient } from './google-calendar.client';
import { AgendaGoogleSyncService } from './agenda-google-sync.service';
import { ClinicCalendarsService } from './clinic-calendars.service';
import { ClinicCalendarsController } from './clinic-calendars.controller';

/**
 * Las citas en Google Calendar: un calendario por doctor y uno por clinica. Depende de
 * AgendaModule solo para saber si la empresa tiene la agenda activada; nadie depende de el.
 */
@Module({
  imports: [AgendaModule],
  controllers: [ClinicCalendarsController],
  providers: [GoogleCalendarClient, AgendaGoogleSyncService, ClinicCalendarsService],
})
export class AgendaGoogleModule {}
