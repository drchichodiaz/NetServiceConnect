import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class BotConfigService {
  constructor(private prisma: PrismaService) {}

  async getConfig(tenantId: string) {
    const config = await this.prisma.tenantBotConfig.findUnique({ where: { tenantId } });

    return {
      horariosText: config?.horariosText ?? '',
      sucursalesText: config?.sucursalesText ?? '',
      serviciosText: config?.serviciosText ?? '',
      orderStatusApiUrl: config?.orderStatusApiUrl ?? '',
    };
  }

  async updateConfig(
    tenantId: string,
    dto: { horariosText?: string; sucursalesText?: string; serviciosText?: string; orderStatusApiUrl?: string },
  ) {
    const data: any = {};
    if (dto.horariosText !== undefined) data.horariosText = dto.horariosText.trim() || null;
    if (dto.sucursalesText !== undefined) data.sucursalesText = dto.sucursalesText.trim() || null;
    if (dto.serviciosText !== undefined) data.serviciosText = dto.serviciosText.trim() || null;
    if (dto.orderStatusApiUrl !== undefined) data.orderStatusApiUrl = dto.orderStatusApiUrl.trim() || null;

    await this.prisma.tenantBotConfig.upsert({
      where: { tenantId },
      update: data,
      create: { tenantId, ...data },
    });

    return this.getConfig(tenantId);
  }
}
