import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CampaignsService, ContactFilter } from './campaigns.service';
import { CreateCampaignDto } from './dto/create-campaign.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';

/** Un Excel de 20.000 filas ronda el mega; 10 MB deja margen de sobra. */
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Solo ADMIN y SUPERVISOR. Una campaña le escribe a miles de personas, cuesta plata y
 * no se puede deshacer: no es una accion de agente.
 */
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN' as any, 'SUPERVISOR' as any)
@Controller('campaigns')
export class CampaignsController {
  constructor(private service: CampaignsService) {}

  /**
   * Lee el archivo y cuenta que pasaria, sin crear nada. El panel lo llama antes de
   * crear para poder mostrar cuantos van a recibir y cuantos estan dados de baja.
   */
  @Post('preview')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } }))
  preview(
    @CurrentUser() user: any,
    @Query('templateId') templateId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.service.previewFile(user.tenantId, templateId, file);
  }

  /**
   * Lo mismo pero sobre los contactos que ya estan en el sistema. Va aparte del
   * anterior porque no lleva archivo: es JSON y el filtro es el mismo de la lista
   * de contactos.
   */
  @Post('preview-contacts')
  previewContacts(
    @CurrentUser() user: any,
    @Body() body: { templateId: string } & ContactFilter,
  ) {
    return this.service.previewContacts(user.tenantId, body.templateId, {
      contactIds: body.contactIds,
      contactSearch: body.contactSearch,
      tagIds: body.tagIds,
      excludeTagIds: body.excludeTagIds,
      tagMatch: body.tagMatch,
    });
  }

  /** Crea la campaña en DRAFT. No manda nada hasta que se la arranca. */
  @Post()
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES } }))
  create(@CurrentUser() user: any, @Body() dto: CreateCampaignDto, @UploadedFile() file: Express.Multer.File) {
    return this.service.create(user.tenantId, user.id, dto, file);
  }

  @Get()
  findAll(@CurrentUser() user: any) {
    return this.service.findAll(user.tenantId);
  }

  @Get(':id')
  findOne(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.findOne(user.tenantId, id);
  }

  /** Los destinatarios que fallaron o se saltearon, para poder mirar que paso. */
  @Get(':id/failures')
  failures(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.failures(user.tenantId, id);
  }

  @Post(':id/start')
  start(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.start(user.tenantId, user.id, id);
  }

  @Post(':id/pause')
  pause(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.pause(user.tenantId, id, 'Pausada a mano');
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.cancel(user.tenantId, id);
  }
}
