import { Controller, Get, Patch, Body, Query, UseGuards } from '@nestjs/common';
import { BotConfigService } from './bot-config.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { StatsPeriod } from '../common/period-range';

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
  update(@CurrentUser() user: any, @Body() dto: { orderStatusApiUrl?: string }) {
    return this.service.updateConfig(user.tenantId, dto);
  }

  // El resto del controller es ADMIN/SUPERVISOR (config del bot), pero las métricas
  // se muestran en el dashboard general, que cualquier rol autenticado puede ver —
  // este override de @Roles reemplaza el de la clase para permitir también AGENT.
  @Roles('ADMIN' as any, 'SUPERVISOR' as any, 'AGENT' as any)
  @Get('stats')
  getStats(@CurrentUser() user: any, @Query('period') period: StatsPeriod = 'week') {
    return this.service.getStats(user.tenantId, period);
  }
}
