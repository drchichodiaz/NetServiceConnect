import {
  Controller, Get, Post, Patch, Put, Delete, Body, Param, Query, UseGuards,
  UseInterceptors, UploadedFile, ParseFilePipeBuilder, Res, StreamableFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { ContactsService } from './contacts.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { SetContactTagsDto, BulkTagContactsDto } from '../contact-tags/dto/contact-tag.dto';
import { buildTemplateWorkbook } from './contacts-import.util';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

const MAX_IMPORT_UPLOAD_BYTES = 5 * 1024 * 1024; // 5MB, de sobra para una planilla de contactos

@UseGuards(JwtAuthGuard)
@Controller('contacts')
export class ContactsController {
  constructor(private service: ContactsService) {}

  @Post()
  create(@CurrentUser() user: any, @Body() dto: CreateContactDto) {
    return this.service.create(user.tenantId, dto);
  }

  @Get('import-template')
  async getImportTemplate(@Res({ passthrough: true }) res: Response) {
    const buffer = await buildTemplateWorkbook();
    res.set({
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="plantilla-contactos.xlsx"',
    });
    return new StreamableFile(buffer);
  }

  @Post('import')
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_IMPORT_UPLOAD_BYTES } }))
  importContacts(
    @CurrentUser() user: any,
    @UploadedFile(new ParseFilePipeBuilder().build({ fileIsRequired: true }))
    file: Express.Multer.File,
  ) {
    return this.service.importContacts(user.tenantId, file.buffer, file.originalname);
  }

  /**
   * `tagIds` llega como lista separada por comas (es un querystring, no un body) y
   * `tagMatch` dice si hay que tener todas o alguna.
   */
  @Get()
  findAll(
    @CurrentUser() user: any,
    @Query('search') search?: string,
    @Query('tagIds') tagIds?: string,
    @Query('tagMatch') tagMatch?: 'ANY' | 'ALL',
  ) {
    return this.service.findAll(user.tenantId, search, {
      tagIds: tagIds ? tagIds.split(',').filter(Boolean) : undefined,
      tagMatch: tagMatch === 'ALL' ? 'ALL' : 'ANY',
    });
  }

  /**
   * Etiquetar en lote. Va antes de las rutas con :id porque si no, Nest lee "tags"
   * como el id de un contacto y este endpoint nunca se alcanza.
   */
  @Post('tags/bulk')
  bulkTag(@CurrentUser() user: any, @Body() dto: BulkTagContactsDto) {
    return this.service.bulkTag(user.tenantId, dto.contactIds, dto.addTagIds, dto.removeTagIds);
  }

  @Get(':id')
  findOne(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.findOne(user.tenantId, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: Partial<CreateContactDto>) {
    return this.service.update(user.tenantId, id, dto);
  }

  /** Las etiquetas que quedan en el contacto. Reemplaza las que tenia. */
  @Put(':id/tags')
  setTags(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: SetContactTagsDto) {
    return this.service.setTags(user.tenantId, id, dto.tagIds);
  }

  @Delete(':id')
  remove(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.remove(user.tenantId, id);
  }
}
