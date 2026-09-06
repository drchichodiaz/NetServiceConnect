import { Module } from '@nestjs/common';
import { WhatsAppAccountsService } from './accounts.service';

/**
 * Modulo minimo (solo depende de Prisma, que es global) para que BotModule,
 * TemplatesModule y WhatsAppModule puedan compartir el resolvedor de lineas sin
 * generar dependencias circulares entre ellos.
 */
@Module({
  providers: [WhatsAppAccountsService],
  exports: [WhatsAppAccountsService],
})
export class WhatsAppAccountsModule {}
