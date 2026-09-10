import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { MenuNodesService, MenuNodeDto, MenuNodeUpdateDto, ReparentDto } from './menu-nodes.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN' as any, 'SUPERVISOR' as any)
@Controller('menu-nodes')
export class MenuNodesController {
  constructor(private service: MenuNodesService) {}

  @Get()
  getTree(@CurrentUser() user: any) {
    return this.service.getTree(user.tenantId);
  }

  @Post()
  create(@CurrentUser() user: any, @Body() dto: MenuNodeDto) {
    return this.service.create(user.tenantId, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: MenuNodeUpdateDto) {
    return this.service.update(user.tenantId, id, dto);
  }

  // Prueba la consulta al sistema externo sin tener que mandarse un WhatsApp.
  @Post(':id/test-lookup')
  testLookup(@CurrentUser() user: any, @Param('id') id: string, @Body() body: { value?: string }) {
    return this.service.testLookup(user.tenantId, id, body?.value ?? '');
  }

  @Patch(':id/reparent')
  reparent(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: ReparentDto) {
    return this.service.reparent(user.tenantId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.remove(user.tenantId, id);
  }
}
