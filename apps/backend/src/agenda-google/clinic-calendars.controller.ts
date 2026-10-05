import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsString } from 'class-validator';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ClinicCalendarsService } from './clinic-calendars.service';

class SetClinicCalendarDto {
  /** Lista vacia = dejar de compartir y borrar el calendario de esa clinica. */
  @IsArray()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  emails: string[];
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN' as any, 'SUPERVISOR' as any)
@Controller('agenda/google-calendars')
export class ClinicCalendarsController {
  constructor(private calendars: ClinicCalendarsService) {}

  @Get()
  list(@CurrentUser() user: any) {
    return this.calendars.list(user.tenantId);
  }

  @Put(':channelAccountId')
  setEmails(@CurrentUser() user: any, @Param('channelAccountId') channelAccountId: string, @Body() dto: SetClinicCalendarDto) {
    return this.calendars.setEmails(user.tenantId, channelAccountId, dto.emails);
  }
}
