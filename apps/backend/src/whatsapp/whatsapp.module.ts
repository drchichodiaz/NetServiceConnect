import { Module } from '@nestjs/common';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppService } from './whatsapp.service';
import { EmbeddedSignupService } from './embedded-signup.service';
import { WebhookService } from './webhook.service';
import { SystemConfigModule } from '../system-config/system-config.module';
import { MediaModule } from '../media/media.module';

@Module({
  imports: [SystemConfigModule, MediaModule],
  controllers: [WhatsAppController],
  providers: [WhatsAppService, EmbeddedSignupService, WebhookService],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}
