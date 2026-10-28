import { Module } from '@nestjs/common';
import { CallsService } from './calls.service';
import { CallsController } from './calls.controller';
import { ContactIdentityModule } from '../contacts/contact-identity.module';
import { AssignmentService } from '../whatsapp/assignment.service';

/** No importa WhatsAppModule: es al reves, el webhook le pasa las llamadas a este. */
@Module({
  imports: [ContactIdentityModule],
  controllers: [CallsController],
  providers: [CallsService, AssignmentService],
  exports: [CallsService],
})
export class CallsModule {}
