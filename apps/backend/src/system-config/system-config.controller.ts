import { Controller, Get, Patch, Body, UseGuards } from '@nestjs/common';
import { SystemConfigService } from './system-config.service';
import { UpdateSystemConfigDto } from './dto/system-config.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('system-config')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
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
