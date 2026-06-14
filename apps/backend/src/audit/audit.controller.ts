import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuditService } from './audit.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('audit')
export class AuditController {
  constructor(private service: AuditService) {}

  @Get()
  @Roles('ADMIN' as any, 'SUPERVISOR' as any)
  findAll(@CurrentUser() user: any, @Query('conversationId') conversationId?: string) {
    return this.service.findByTenant(user.tenantId, conversationId);
  }
}
