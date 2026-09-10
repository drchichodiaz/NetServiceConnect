import { Module } from '@nestjs/common';
import { MenuNodesController } from './menu-nodes.controller';
import { LookupModule } from '../common/lookup.module';
import { MenuNodesService } from './menu-nodes.service';

@Module({
  imports: [LookupModule],
  controllers: [MenuNodesController],
  providers: [MenuNodesService],
})
export class MenuNodesModule {}
