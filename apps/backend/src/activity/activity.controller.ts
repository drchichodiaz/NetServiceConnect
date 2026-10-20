import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ActivityService } from './activity.service';

/**
 * La bitacora la ve todo el equipo: cada uno lo de las lineas que tiene permitidas.
 * ?date=YYYY-MM-DD (hoy si falta) &channelAccountId=... &category=appointments|handoffs|bot|team
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN' as any, 'SUPERVISOR' as any, 'AGENT' as any)
@Controller('activity')
export class ActivityController {
  constructor(private service: ActivityService) {}

  @Get()
  list(
    @CurrentUser() user: any,
    @Query('date') date?: string,
    @Query('channelAccountId') channelAccountId?: string,
    @Query('category') category?: string,
  ) {
    return this.service.list(user.tenantId, user, {
      date: date || undefined,
      channelAccountId: channelAccountId || undefined,
      category: category || undefined,
    });
  }
}
