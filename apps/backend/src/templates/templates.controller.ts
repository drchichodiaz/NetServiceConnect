import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  Query,
  Res,
  StreamableFile,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { Response } from 'express';
import { createReadStream } from 'fs';
import { TemplatesService } from './templates.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

const MAX_HEADER_UPLOAD_BYTES = 5 * 1024 * 1024;

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN' as any, 'SUPERVISOR' as any)
@Controller('whatsapp/templates')
export class TemplatesController {
  constructor(private service: TemplatesService) {}

  @Post()
  create(@CurrentUser() user: any, @Body() dto: CreateTemplateDto) {
    return this.service.create(user.tenantId, dto);
  }

  /**
   * Sube la imagen del encabezado antes de crear la plantilla y devuelve
   * { handle, path, mime }, que es lo que el alta espera recibir de vuelta.
   * Va aparte porque el alta viaja como JSON y porque asi la pantalla puede
   * mostrar la vista previa antes de mandar nada a aprobar.
   */
  @Post('header-media')
  @UseInterceptors(
    FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_HEADER_UPLOAD_BYTES } }),
  )
  uploadHeaderMedia(@CurrentUser() user: any, @UploadedFile() file: Express.Multer.File) {
    return this.service.uploadHeaderMedia(user.tenantId, file);
  }

  // Con ?channelAccountId= devuelve solo las plantillas utilizables por esa linea —
  // es lo que pide el selector de "iniciar conversacion". Sin el, todas.
  @Get()
  findAll(@CurrentUser() user: any, @Query('channelAccountId') channelAccountId?: string) {
    return this.service.findAll(user.tenantId, channelAccountId);
  }

  /** La imagen del encabezado de una plantilla ya creada, para la vista previa. */
  @Get(':id/header-media')
  async headerMedia(
    @CurrentUser() user: any,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { absolutePath, mimeType } = await this.service.getHeaderMediaFile(user.tenantId, id);
    res.set({ 'Content-Type': mimeType, 'Cache-Control': 'private, max-age=86400' });
    return new StreamableFile(createReadStream(absolutePath));
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
