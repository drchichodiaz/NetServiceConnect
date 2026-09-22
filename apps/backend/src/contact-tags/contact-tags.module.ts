import { Module } from '@nestjs/common';
import { ContactTagsController } from './contact-tags.controller';
import { ContactTagsService } from './contact-tags.service';

/**
 * El servicio se exporta porque lo usan el import de contactos (crea las etiquetas de
 * la columna "Etiquetas") y las campañas (valida que los ids del filtro sean del
 * tenant), no solo este controlador.
 */
@Module({
  controllers: [ContactTagsController],
  providers: [ContactTagsService],
  exports: [ContactTagsService],
})
export class ContactTagsModule {}
