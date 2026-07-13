import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN' as any, 'SUPERVISOR' as any)
@Controller('settings')
export class SettingsController {
  constructor(private service: SettingsService) {}

  @Get()
  get(@CurrentUser() user: any) {
    return this.service.getSettings(user.tenantId);
  }

  @Patch()
  update(@CurrentUser() user: any, @Body() dto: { openaiApiKey?: string; openaiModel?: string }) {
    return this.service.updateSettings(user.tenantId, dto);
  }
}
