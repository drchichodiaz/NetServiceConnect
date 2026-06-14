import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { StatsService } from './stats.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('stats')
export class StatsController {
  constructor(private service: StatsService) {}

  @Get()
  getStats(
    @CurrentUser() user: any,
    @Query('period') period: 'today' | 'week' | 'month' = 'week',
  ) {
    return this.service.getStats(user.tenantId, period);
  }
}
