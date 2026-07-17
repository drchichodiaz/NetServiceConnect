import { Module } from '@nestjs/common';
import { MenuNodesController } from './menu-nodes.controller';
import { MenuNodesService } from './menu-nodes.service';

@Module({
  controllers: [MenuNodesController],
  providers: [MenuNodesService],
})
export class MenuNodesModule {}
