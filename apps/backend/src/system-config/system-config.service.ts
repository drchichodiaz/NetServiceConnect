import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateSystemConfigDto } from './dto/system-config.dto';

export interface ResolvedConfig {
  metaAppId: string;
  metaAppSecret: string;
  metaVerifyToken: string;
  metaApiVersion: string;
}

@Injectable()
export class SystemConfigService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {}

  async get(): Promise<ResolvedConfig> {
    const record = await this.prisma.systemConfig.findUnique({ where: { id: '1' } });
    return {
      metaAppId:       record?.metaAppId       || this.config.get('META_APP_ID')       || '',
      metaAppSecret:   record?.metaAppSecret   || this.config.get('META_APP_SECRET')   || '',
      metaVerifyToken: record?.metaVerifyToken || this.config.get('META_VERIFY_TOKEN') || '',
      metaApiVersion:  record?.metaApiVersion  || this.config.get('META_API_VERSION')  || 'v19.0',
    };
  }

  async getForFrontend() {
    const record = await this.prisma.systemConfig.findUnique({ where: { id: '1' } });
    const cfg = await this.get();
    const fromDb = !!record?.metaAppId;
    return {
      metaAppId:            cfg.metaAppId,
      metaConfigId:         record?.metaConfigId || '',
      hasMetaAppSecret:     !!cfg.metaAppSecret,
      metaAppSecretPreview: cfg.metaAppSecret ? `...${cfg.metaAppSecret.slice(-4)}` : null,
      metaVerifyToken:      cfg.metaVerifyToken,
      metaApiVersion:       cfg.metaApiVersion,
      source: fromDb ? 'db' : 'env',
    };
  }

  async update(data: UpdateSystemConfigDto) {
    const payload: any = {};
    if (data.metaAppId       !== undefined && data.metaAppId       !== '') payload.metaAppId       = data.metaAppId;
    if (data.metaConfigId    !== undefined && data.metaConfigId    !== '') payload.metaConfigId    = data.metaConfigId;
    if (data.metaVerifyToken !== undefined && data.metaVerifyToken !== '') payload.metaVerifyToken = data.metaVerifyToken;
    if (data.metaApiVersion  !== undefined && data.metaApiVersion  !== '') payload.metaApiVersion  = data.metaApiVersion;
    if (data.metaAppSecret && !data.metaAppSecret.startsWith('...')) payload.metaAppSecret = data.metaAppSecret;

    return this.prisma.systemConfig.upsert({
      where:  { id: '1' },
      create: { id: '1', ...payload },
      update: payload,
    });
  }
}
