import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { AiUsageModule } from '../ai-usage/ai-usage.module';

@Module({
  imports: [AiUsageModule],
  controllers: [AiController],
  providers: [AiService],
})
export class AiModule {}
