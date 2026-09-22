import { Module } from '@nestjs/common';
import { TemplatesService } from './templates.service';
import { TemplatesController } from './templates.controller';
import { MetaUploadService } from './meta-upload.service';
import { WhatsAppAccountsModule } from '../whatsapp/accounts.module';
import { MediaModule } from '../media/media.module';

@Module({
  imports: [WhatsAppAccountsModule, MediaModule],
  controllers: [TemplatesController],
  providers: [TemplatesService, MetaUploadService],
  exports: [TemplatesService],
})
export class TemplatesModule {}
