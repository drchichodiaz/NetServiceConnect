import { Module } from '@nestjs/common';
import { AgendaModule } from '../agenda/agenda.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { WhatsAppAccountsModule } from '../whatsapp/accounts.module';
import { ContactIdentityModule } from '../contacts/contact-identity.module';
import { AgendaNotifierService } from './agenda-notifier.service';
import { AgendaNotifyWorkerService } from './agenda-notify-worker.service';
import { AgendaNotifyController } from './agenda-notify.controller';

/**
 * Los avisos de la agenda por WhatsApp. Modulo aparte de AgendaModule a proposito:
 * WhatsAppModule importa AgendaModule (el webhook reconoce las respuestas a los
 * recordatorios), asi que si AgendaModule importara WhatsAppModule se importarian
 * mutuamente. Este modulo depende de los dos y nadie depende de el.
 */
@Module({
  imports: [AgendaModule, WhatsAppModule, WhatsAppAccountsModule, ContactIdentityModule],
  controllers: [AgendaNotifyController],
  providers: [AgendaNotifierService, AgendaNotifyWorkerService],
})
export class AgendaNotifyModule {}
