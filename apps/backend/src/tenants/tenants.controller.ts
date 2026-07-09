import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards, ForbiddenException } from '@nestjs/common';
import { TenantsService } from './tenants.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('tenants')
export class TenantsController {
  constructor(private service: TenantsService) {}

  @Post()
  @Roles('ADMIN' as any)
  create(@Body() dto: CreateTenantDto) {
    return this.service.create(dto);
  }

  @Get()
  @Roles('ADMIN' as any)
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  @Roles('ADMIN' as any)
  findOne(@CurrentUser() user: any, @Param('id') id: string) {
    this.assertOwnTenant(user, id);
    return this.service.findOne(id);
  }

  @Patch(':id')
  @Roles('ADMIN' as any)
  update(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: Partial<CreateTenantDto>) {
    this.assertOwnTenant(user, id);
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN' as any)
  remove(@CurrentUser() user: any, @Param('id') id: string) {
    this.assertOwnTenant(user, id);
    return this.service.remove(id);
  }

  private assertOwnTenant(user: any, id: string) {
    if (user.tenantId !== id) {
      throw new ForbiddenException('Cannot access another tenant');
    }
  }
}
