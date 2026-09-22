import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { BotsService, BotUpdateDto } from './bots.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { StatsPeriod } from '../common/period-range';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN' as any, 'SUPERVISOR' as any)
@Controller('bots')
export class BotsController {
  constructor(private service: BotsService) {}

  // El resto del controller es ADMIN/SUPERVISOR (config de los bots), pero las
  // métricas se muestran en el dashboard general, que cualquier rol autenticado puede
  // ver — este override de @Roles reemplaza el de la clase para permitir también AGENT.
  @Roles('ADMIN' as any, 'SUPERVISOR' as any, 'AGENT' as any)
  @Get('stats')
  getStats(
    @CurrentUser() user: any,
    @Query('period') period: StatsPeriod = 'week',
    @Query('botId') botId?: string,
  ) {
    return this.service.getStats(user.tenantId, period, botId || undefined);
  }

  // Lo lee también el dashboard para ofrecer el filtro por bot.
  @Roles('ADMIN' as any, 'SUPERVISOR' as any, 'AGENT' as any)
  @Get()
  list(@CurrentUser() user: any) {
    return this.service.list(user.tenantId);
  }

  @Post()
  create(@CurrentUser() user: any, @Body() body: { name?: string }) {
    return this.service.create(user.tenantId, body?.name ?? '');
  }

  @Patch(':id')
  update(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: BotUpdateDto) {
    return this.service.update(user.tenantId, id, dto);
  }

  @Post(':id/duplicate')
  duplicate(@CurrentUser() user: any, @Param('id') id: string, @Body() body: { name?: string }) {
    return this.service.duplicate(user.tenantId, id, body?.name);
  }

  @Post(':id/default')
  setDefault(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.setDefault(user.tenantId, id);
  }

  @Delete(':id')
  remove(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.remove(user.tenantId, id);
  }
}
