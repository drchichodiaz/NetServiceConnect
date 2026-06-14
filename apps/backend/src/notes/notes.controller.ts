import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { NotesService } from './notes.service';
import { CreateNoteDto } from './dto/create-note.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('conversations/:conversationId/notes')
export class NotesController {
  constructor(private service: NotesService) {}

  @Post()
  create(
    @CurrentUser() user: any,
    @Param('conversationId') conversationId: string,
    @Body() dto: CreateNoteDto,
  ) {
    return this.service.create(user.tenantId, user.id, conversationId, dto);
  }

  @Get()
  findAll(@CurrentUser() user: any, @Param('conversationId') conversationId: string) {
    return this.service.findByConversation(user.tenantId, conversationId);
  }

  @Delete(':noteId')
  remove(@CurrentUser() user: any, @Param('noteId') noteId: string) {
    return this.service.remove(user.tenantId, user.id, noteId);
  }
}
