import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

const MODELS = ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo'];

@Injectable()
export class SettingsService {
  constructor(private prisma: PrismaService) {}

  async getSettings(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { openaiApiKey: true, openaiModel: true },
    });

    return {
      hasOpenaiKey: !!tenant?.openaiApiKey,
      keySource: tenant?.openaiApiKey ? 'db' : null,
      openaiKeyPreview: tenant?.openaiApiKey
        ? `sk-...${tenant.openaiApiKey.slice(-6)}`
        : null,
      openaiModel: tenant?.openaiModel ?? 'gpt-4o-mini',
      availableModels: MODELS,
    };
  }

  async updateSettings(tenantId: string, dto: { openaiApiKey?: string; openaiModel?: string }) {
    const data: any = {};

    if (dto.openaiApiKey !== undefined) {
      data.openaiApiKey = dto.openaiApiKey.trim() || null;
    }

    if (dto.openaiModel && MODELS.includes(dto.openaiModel)) {
      data.openaiModel = dto.openaiModel;
    }

    await this.prisma.tenant.update({ where: { id: tenantId }, data });
    return this.getSettings(tenantId);
  }
}
