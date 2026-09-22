import { Module } from '@nestjs/common';
import { BotService } from './bot.service';
import { AssignmentService } from '../whatsapp/assignment.service';
import { WhatsAppAccountsModule } from '../whatsapp/accounts.module';
import { LookupModule } from '../common/lookup.module';
import { BotsModule } from '../bots/bots.module';
import { AiUsageModule } from '../ai-usage/ai-usage.module';

@Module({
  imports: [WhatsAppAccountsModule, LookupModule, BotsModule, AiUsageModule],
  providers: [BotService, AssignmentService],
  exports: [BotService, AssignmentService, BotsModule],
})
export class BotModule {}
