import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { IsBoolean, IsString } from 'class-validator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { CallsService } from './calls.service';

class AcceptCallDto {
  @IsString()
  sdp: string;
}

class SetCallingDto {
  @IsBoolean()
  enabled: boolean;
}

@UseGuards(JwtAuthGuard)
@Controller('calls')
export class CallsController {
  constructor(private calls: CallsService) {}

  @Post(':id/accept')
  accept(@CurrentUser() user: any, @Param('id') id: string, @Body() dto: AcceptCallDto) {
    return this.calls.accept(user.tenantId, user, id, dto.sdp);
  }

  @Post(':id/reject')
  reject(@CurrentUser() user: any, @Param('id') id: string) {
    return this.calls.reject(user.tenantId, user.id, id);
  }

  @Post(':id/hangup')
  hangup(@CurrentUser() user: any, @Param('id') id: string) {
    return this.calls.hangup(user.tenantId, user.id, id);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN' as any, 'SUPERVISOR' as any)
  @Get('lines/:accountId')
  callingSettings(@CurrentUser() user: any, @Param('accountId') accountId: string) {
    return this.calls.callingSettings(user.tenantId, accountId);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN' as any, 'SUPERVISOR' as any)
  @Post('lines/:accountId')
  setCalling(@CurrentUser() user: any, @Param('accountId') accountId: string, @Body() dto: SetCallingDto) {
    return this.calls.setCallingEnabled(user.tenantId, accountId, dto.enabled);
  }
}
