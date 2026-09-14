import { Controller, Get, Patch, Post, Body, UseGuards, Inject, forwardRef } from '@nestjs/common';
import { SystemConfigService } from './system-config.service';
import { UpdateSystemConfigDto } from './dto/system-config.dto';
import { UpdateMailConfigDto, SendTestMailDto } from './dto/mail-config.dto';
import { MailService } from '../mail/mail.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';

@Controller('system-config')
export class SystemConfigController {
  constructor(
    private service: SystemConfigService,
    // forwardRef porque MailModule importa a SystemConfigModule para leer la config, y
    // este controller necesita a MailService para el envio de prueba.
    @Inject(forwardRef(() => MailService))
    private mail: MailService,
  ) {}

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

  // ─── Correo saliente ──────────────────────────────────────────────────────

  /** Nunca devuelve la contraseña, solo si hay una guardada. */
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @Get('mail')
  async getMail() {
    const cfg = await this.service.getMailConfig();
    const { pass, ...rest } = cfg;
    return { ...rest, hasPassword: !!pass };
  }

  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @Patch('mail')
  async updateMail(@Body() dto: UpdateMailConfigDto) {
    const cfg = await this.service.updateMailConfig(dto);
    const { pass, ...rest } = cfg;
    return { ...rest, hasPassword: !!pass };
  }

  /**
   * Manda un correo de prueba y devuelve el error real si falla. Sin esto, configurar
   * SMTP es a ciegas: el primero en enterarse de que algo esta mal seria un usuario que
   * no puede recuperar su contraseña.
   */
  @UseGuards(JwtAuthGuard, SuperAdminGuard)
  @Post('mail/test')
  sendTestMail(@Body() dto: SendTestMailDto) {
    return this.mail.sendTest(dto.to);
  }
}