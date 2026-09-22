import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AiCreditsService } from './ai-credits.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { StatsPeriod } from '../common/period-range';
import { GrantCreditsDto, UpdateAiTenantDto, UpdatePlatformSettingsDto } from './dto/ai-credits.dto';

const PERIODS: StatsPeriod[] = ['today', 'week', 'month'];
const parsePeriod = (value?: string): StatsPeriod =>
  PERIODS.includes(value as StatsPeriod) ? (value as StatsPeriod) : 'month';

/**
 * Saldo de creditos de IA.
 *
 * Dos publicos y dos guards distintos: el super admin ve el costo del proveedor, el
 * margen y puede acreditar; la empresa ve solo su propio saldo. Un admin de empresa no
 * tiene por que saber cuanto nos cuesta atenderla.
 */
@Controller('ai-credits')
export class AiCreditsController {
  constructor(private service: AiCreditsService) {}

  // ─── Empresa ────────────────────────────────────────────────────────────────

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN' as any, 'SUPERVISOR' as any)
  @Get('me')
  me(@CurrentUser() user: any, @Query('period') period?: string) {
    return this.service.myCredits(user.tenantId, parsePeriod(period));
  }

  // ─── Plataforma ─────────────────────────────────────────────────────────────

  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @Get('settings')
  getSettings() {
    return this.service.getPlatformSettings();
  }

  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @Patch('settings')
  updateSettings(@Body() dto: UpdatePlatformSettingsDto) {
    return this.service.updatePlatformSettings(dto);
  }

  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @Get('overview')
  overview(@Query('period') period?: string) {
    return this.service.overview(parsePeriod(period));
  }

  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @Get('tenants/:id')
  tenantDetail(@Param('id') id: string) {
    return this.service.tenantDetail(id);
  }

  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @Post('tenants/:id/grant')
  grant(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: GrantCreditsDto) {
    return this.service.grant(id, dto, user.id);
  }

  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @Patch('tenants/:id')
  updateTenant(@Param('id') id: string, @Body() dto: UpdateAiTenantDto) {
    return this.service.updateTenant(id, dto);
  }
}
