import { Global, Module } from '@nestjs/common';
import { ChannelAccessService } from './channel-access.service';

/**
 * Global porque el filtro por linea lo necesitan modulos que no tienen relacion entre
 * si (conversaciones, cuentas, envio, stats, usuarios) y encadenar imports solo para
 * esto agregaria ruido sin aportar aislamiento.
 */
@Global()
@Module({
  providers: [ChannelAccessService],
  exports: [ChannelAccessService],
})
export class ChannelAccessModule {}
