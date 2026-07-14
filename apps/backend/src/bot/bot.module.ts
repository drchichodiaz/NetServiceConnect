import { Module } from '@nestjs/common';
import { BotService } from './bot.service';
import { AssignmentService } from '../whatsapp/assignment.service';

@Module({
  providers: [BotService, AssignmentService],
  exports: [BotService, AssignmentService],
})
export class BotModule {}
