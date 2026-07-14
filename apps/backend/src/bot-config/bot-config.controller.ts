import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { BotConfigService } from './bot-config.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN' as any, 'SUPERVISOR' as any)
@Controller('bot-config')
export class BotConfigController {
  constructor(private service: BotConfigService) {}

  @Get()
  get(@CurrentUser() user: any) {
    return this.service.getConfig(user.tenantId);
  }

  @Patch()
  update(
    @CurrentUser() user: any,
    @Body() dto: { horariosText?: string; sucursalesText?: string; serviciosText?: string; orderStatusApiUrl?: string },
  ) {
    return this.service.updateConfig(user.tenantId, dto);
  }
}
