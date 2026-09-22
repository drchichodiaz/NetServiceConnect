import { Module } from '@nestjs/common';
import { ContactsService } from './contacts.service';
import { ContactsController } from './contacts.controller';
import { ContactIdentityModule } from './contact-identity.module';
import { ContactTagsModule } from '../contact-tags/contact-tags.module';

@Module({
  imports: [ContactIdentityModule, ContactTagsModule],
  controllers: [ContactsController],
  providers: [ContactsService],
  exports: [ContactsService],
})
export class ContactsModule {}
