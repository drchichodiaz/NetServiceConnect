import { Module } from '@nestjs/common';
import { ContactIdentityService } from './contact-identity.service';

/**
 * Modulo propio (y no parte de ContactsModule) para que el webhook y el envio puedan
 * resolver identidades sin arrastrar el controller de contactos ni crear un ciclo entre
 * WhatsAppModule y ContactsModule.
 */
@Module({
  providers: [ContactIdentityService],
  exports: [ContactIdentityService],
})
export class ContactIdentityModule {}
