import { Controller, Get, Patch, Post, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { BotConfigService, BranchDto } from './bot-config.service';
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

  @Get('branches')
  listBranches(@CurrentUser() user: any) {
    return this.service.listBranches(user.tenantId);
  }

  @Post('branches')
  createBranch(@CurrentUser() user: any, @Body() dto: BranchDto) {
    return this.service.createBranch(user.tenantId, dto);
  }

  @Patch('branches/:id')
  updateBranch(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: Partial<BranchDto>) {
    return this.service.updateBranch(user.tenantId, id, dto);
  }

  @Delete('branches/:id')
  removeBranch(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.removeBranch(user.tenantId, id);
  }

  @Get('stats')
  getStats(@CurrentUser() user: any, @Query('range') range: string = 'today') {
    return this.service.getStats(user.tenantId, range);
  }
}
