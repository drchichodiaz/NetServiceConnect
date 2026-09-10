import { Module } from '@nestjs/common';
import { LookupService } from './lookup.service';

/** Lo usan el bot (para responderle al cliente) y menu-nodes (para el botón "Probar"). */
@Module({
  providers: [LookupService],
  exports: [LookupService],
})
export class LookupModule {}
