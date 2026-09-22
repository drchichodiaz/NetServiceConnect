import { Module } from '@nestjs/common';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';
import { SystemConfigModule } from '../system-config/system-config.module';

// MailModule es @Global, asi que no hace falta importarlo.
@Module({
  imports: [SystemConfigModule],
  controllers: [SupportController],
  providers: [SupportService],
})
export class SupportModule {}
