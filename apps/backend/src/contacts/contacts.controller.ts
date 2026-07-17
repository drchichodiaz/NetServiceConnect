import {
  Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards,
  UseInterceptors, UploadedFile, ParseFilePipeBuilder, Res, StreamableFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { ContactsService } from './contacts.service';
import { CreateContactDto } from './dto/create-contact.dto';
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

  @Get()
  findAll(@CurrentUser() user: any, @Query('search') search?: string) {
    return this.service.findAll(user.tenantId, search);
  }

  @Get(':id')
  findOne(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.findOne(user.tenantId, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: Partial<CreateContactDto>) {
    return this.service.update(user.tenantId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: any, @Param('id') id: string) {
    return this.service.remove(user.tenantId, id);
  }
}
