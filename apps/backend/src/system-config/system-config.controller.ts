import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { SystemConfigService } from './system-config.service';
import { UpdateSystemConfigDto } from './dto/system-config.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SuperAdminGuard } from '../common/guards/super-admin.guard';

@Controller('system-config')
@UseGuards(JwtAuthGuard, SuperAdminGuard)
export class SystemConfigController {
  constructor(private service: SystemConfigService) {}

  @Get()
  get() {
    return this.service.getForFrontend();
  }

  @Patch()
  update(@Body() dto: UpdateSystemConfigDto) {
    return this.service.update(dto);
  }
}
