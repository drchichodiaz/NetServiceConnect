import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { AiUsageModule } from '../ai-usage/ai-usage.module';

@Module({
  imports: [AiUsageModule],
  controllers: [SettingsController],
  providers: [SettingsService],
})
export class SettingsModule {}
