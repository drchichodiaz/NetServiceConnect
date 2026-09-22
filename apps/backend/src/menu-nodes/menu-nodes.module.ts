import { Module } from '@nestjs/common';
import { MenuNodesController } from './menu-nodes.controller';
import { LookupModule } from '../common/lookup.module';
import { BotsModule } from '../bots/bots.module';
import { MenuNodesService } from './menu-nodes.service';

@Module({
  imports: [LookupModule, BotsModule],
  controllers: [MenuNodesController],
  providers: [MenuNodesService],
})
export class MenuNodesModule {}
