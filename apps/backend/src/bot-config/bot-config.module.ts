import { Module } from '@nestjs/common';
import { BotConfigController } from './bot-config.controller';
import { BotConfigService } from './bot-config.service';

@Module({
  controllers: [BotConfigController],
  providers: [BotConfigService],
})
export class BotConfigModule {}
