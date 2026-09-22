import { Module } from '@nestjs/common';
import { CampaignsService } from './campaigns.service';
import { CampaignsController } from './campaigns.controller';
import { CampaignRunnerService } from './campaign-runner.service';
import { TemplatesModule } from '../templates/templates.module';
import { WhatsAppModule } from '../whatsapp/whatsapp.module';
import { WhatsAppAccountsModule } from '../whatsapp/accounts.module';
import { ContactIdentityModule } from '../contacts/contact-identity.module';
import { ChannelAccessModule } from '../common/services/channel-access.module';

@Module({
  imports: [TemplatesModule, WhatsAppModule, WhatsAppAccountsModule, ContactIdentityModule, ChannelAccessModule],
  controllers: [CampaignsController],
  providers: [CampaignsService, CampaignRunnerService],
})
export class CampaignsModule {}
