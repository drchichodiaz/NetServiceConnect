import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { AiUsageService } from './ai-usage.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';
import { StatsPeriod } from '../common/period-range';

const PERIODS: StatsPeriod[] = ['today', 'week', 'month'];
const parsePeriod = (value?: string): StatsPeriod =>
  PERIODS.includes(value as StatsPeriod) ? (value as StatsPeriod) : 'month';

/**
 * Consumo de IA de toda la plataforma. Super admin y nada mas: acá se ve el costo real
 * del proveedor y el margen, que son numeros de quien opera el servidor, no del cliente.
 * Lo que el cliente ve de su propio consumo es otra pantalla y otro endpoint.
 */
@UseGuards(JwtAuthGuard, SuperAdminGuard)
@Controller('ai-usage')
export class AiUsageController {
  constructor(private service: AiUsageService) {}

  @Get('summary')
  summary(@Query('period') period?: string) {
    return this.service.summary(parsePeriod(period));
  }

  @Get('tenant/:id')
  byTenant(@Param('id') id: string, @Query('period') period?: string, @Query('limit') limit?: string) {
    return this.service.byTenant(id, parsePeriod(period), limit ? parseInt(limit, 10) || 100 : 100);
  }
}
