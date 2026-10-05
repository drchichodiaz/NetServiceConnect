import { Module } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { TenantsController } from './tenants.controller';
import { PartnersModule } from '../partners/partners.module';
import { AiUsageModule } from '../ai-usage/ai-usage.module';
import { AgendaGoogleModule } from '../agenda-google/agenda-google.module';

@Module({
  imports: [PartnersModule, AiUsageModule, AgendaGoogleModule],
  controllers: [TenantsController],
  providers: [TenantsService],
  exports: [TenantsService],
})
export class TenantsModule {}
