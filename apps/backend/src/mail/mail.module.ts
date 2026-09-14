import { Global, Module, forwardRef } from '@nestjs/common';
import { MailService } from './mail.service';
import { SystemConfigModule } from '../system-config/system-config.module';

@Global()
@Module({
  imports: [forwardRef(() => SystemConfigModule)],
  providers: [MailService],
  exports: [MailService],
})
export class MailModule {}
