import { Module } from '@nestjs/common';
import { WhatsAppController } from './whatsapp.controller';
import { WhatsAppService } from './whatsapp.service';
import { EmbeddedSignupService } from './embedded-signup.service';
import { WebhookService } from './webhook.service';

@Module({
  controllers: [WhatsAppController],
  providers: [WhatsAppService, EmbeddedSignupService, WebhookService],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}
