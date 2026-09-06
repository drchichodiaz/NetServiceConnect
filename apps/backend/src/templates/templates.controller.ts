import { Controller, Get, Post, Delete, Patch, Body, Param, Query, UseGuards } from '@nestjs/common';
import { TemplatesService } from './templates.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN' as any, 'SUPERVISOR' as any)
@Controller('whatsapp/templates')
export class TemplatesController {
  constructor(private service: TemplatesService) {}

  @Post()
  create(@CurrentUser() user: any, @Body() dto: CreateTemplateDto) {
    return this.service.create(user.tenantId, dto);
  }

  // Con ?whatsappAccountId= devuelve solo las plantillas utilizables por esa linea —
  // es lo que pide el selector de "iniciar conversacion". Sin el, todas.
  @Get()
  findAll(@CurrentUser() user: any, @Query('whatsappAccountId') whatsappAccountId?: string) {
    return this.service.findAll(user.tenantId, whatsappAccountId);
  }

  @Patch(':id/refresh')
  refresh(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.refreshStatus(user.tenantId, id);
  }

  @Delete(':id')
  remove(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.remove(user.tenantId, id);
  }
}
