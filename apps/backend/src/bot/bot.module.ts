import { Module } from '@nestjs/common';
import { BotService } from './bot.service';
import { AssignmentService } from '../whatsapp/assignment.service';
import { OpenAiClientService } from '../common/openai-client.service';

@Module({
  providers: [BotService, AssignmentService, OpenAiClientService],
  exports: [BotService, AssignmentService],
})
export class BotModule {}
