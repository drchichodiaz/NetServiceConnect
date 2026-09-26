import { Module } from '@nestjs/common';
import { AgendaController } from './agenda.controller';
import { AgendaSettingsService } from './agenda-settings.service';
import { DoctorsService } from './doctors.service';
import { AvailabilityService } from './availability.service';
import { AppointmentsService } from './appointments.service';
import { AgendaRepliesService } from './agenda-replies.service';
import { DoctorLinkService } from './doctor-link.service';
import { PublicAgendaController } from './public-agenda.controller';
import { ContactIdentityModule } from '../contacts/contact-identity.module';

@Module({
  imports: [ContactIdentityModule],
  controllers: [AgendaController, PublicAgendaController],
  providers: [AgendaSettingsService, DoctorsService, AvailabilityService, AppointmentsService, AgendaRepliesService, DoctorLinkService],
  exports: [AgendaSettingsService, AvailabilityService, AppointmentsService, AgendaRepliesService, DoctorLinkService],
})
export class AgendaModule {}
