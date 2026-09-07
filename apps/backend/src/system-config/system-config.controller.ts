import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { SystemConfigService } from './system-config.service';
import { UpdateSystemConfigDto } from './dto/system-config.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';

@Controller('system-config')
export class SystemConfigController {
  constructor(private service: SystemConfigService) {}

  /**
   * App ID y Config ID de Meta, lo unico que necesita el Embedded Signup para abrir
   * el popup. Va aparte del GET completo porque ese es superadmin: con el guard a
   * nivel de controller, el admin de un tenant recibia 403 al entrar a conectar su
   * numero y el boton quedaba deshabilitado como si no hubiera App ID configurado.
   * Estos dos valores no son secretos — viajan en la URL del login de Facebook.
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN' as any, 'SUPERVISOR' as any)
  @Get('meta-app')
  getMetaApp() {
    return this.service.getPublicMetaConfig();
  }

  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @Get()
  get() {
    return this.service.getForFrontend();
  }

  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @Patch()
  update(@Body() dto: UpdateSystemConfigDto) {
    return this.service.update(dto);
  }
}
