import { Module } from '@nestjs/common';
import { BotService } from './bot.service';
import { AssignmentService } from '../whatsapp/assignment.service';
import { WhatsAppAccountsModule } from '../whatsapp/accounts.module';
import { LookupModule } from '../common/lookup.module';
import { OpenAiClientService } from '../common/openai-client.service';

@Module({
  imports: [WhatsAppAccountsModule, LookupModule],
  providers: [BotService, AssignmentService, OpenAiClientService],
  exports: [BotService, AssignmentService],
})
export class BotModule {}
