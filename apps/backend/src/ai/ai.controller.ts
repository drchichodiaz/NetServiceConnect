import { Controller, Post, Param, UseGuards } from '@nestjs/common';
import { AiService } from './ai.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard)
@Controller('conversations/:conversationId/ai')
export class AiController {
  constructor(private service: AiService) {}

  @Post('suggest')
  suggest(@CurrentUser() user: any, @Param('conversationId') conversationId: string) {
    return this.service.suggestReply(user.tenantId, conversationId);
  }
}
