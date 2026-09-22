import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { ContactTagsService } from './contact-tags.service';
import { CreateContactTagDto, UpdateContactTagDto } from './dto/contact-tag.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

/**
 * Ver y crear etiquetas lo puede hacer cualquiera: el agente que esta en la
 * conversacion es el que se entera de que el cliente es mayorista, y si para anotarlo
 * tiene que pedirle a un admin que de de alta la etiqueta, no lo anota nunca.
 *
 * Renombrar y borrar si son de ADMIN/SUPERVISOR: eso cambia la etiqueta para todos los
 * contactos que ya la tienen, no solo para el que la escribio.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('contact-tags')
export class ContactTagsController {
  constructor(private service: ContactTagsService) {}

  @Get()
  findAll(@CurrentUser() user: any) {
    return this.service.findAll(user.tenantId);
  }

  @Post()
  create(@CurrentUser() user: any, @Body() dto: CreateContactTagDto) {
    return this.service.create(user.tenantId, dto);
  }

  @Patch(':id')
  @Roles('ADMIN' as any, 'SUPERVISOR' as any)
  update(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: UpdateContactTagDto) {
    return this.service.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN' as any, 'SUPERVISOR' as any)
  remove(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.remove(user.tenantId, id);
  }
}
