import { Global, Module } from '@nestjs/common';
import { ChannelAccessService } from './channel-access.service';
import { CryptoService } from './crypto.service';

/**
 * Global porque el filtro por linea lo necesitan modulos que no tienen relacion entre
 * si (conversaciones, cuentas, envio, stats, usuarios) y encadenar imports solo para
 * esto agregaria ruido sin aportar aislamiento.
 */
@Global()
@Module({
  providers: [ChannelAccessService, CryptoService],
  exports: [ChannelAccessService, CryptoService],
})
export class ChannelAccessModule {}
