import { Controller, Get, Param, Query, Res, StreamableFile, UseGuards } from '@nestjs/common';
import { createReadStream } from 'fs';
import type { Response } from 'express';
import { MessagesService } from './messages.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('conversations/:conversationId/messages')
export class MessagesController {
  constructor(private service: MessagesService) {}

  @Get()
  findAll(
    @CurrentUser() user: any,
    @Param('conversationId') conversationId: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.service.findByConversation(user.tenantId, conversationId, user, cursor);
  }

  @Get(':id/media')
  async getMedia(
    @CurrentUser() user: any,
    @Param('conversationId') conversationId: string,
    @Param('id') id: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { absolutePath, mimeType } = await this.service.getMediaFile(user.tenantId, conversationId, id, user);
    res.set({ 'Content-Type': mimeType, 'Cache-Control': 'private, max-age=86400' });
    return new StreamableFile(createReadStream(absolutePath));
  }
}
