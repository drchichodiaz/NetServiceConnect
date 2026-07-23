import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';
import { OpenAiClientService } from '../common/openai-client.service';

@Module({
  controllers: [AiController],
  providers: [AiService, OpenAiClientService],
})
export class AiModule {}
