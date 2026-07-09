import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
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
  // Default si nunca se configuro nada (ni en DB ni en .env): carpeta "media" junto al backend.
  private readonly defaultMediaStoragePath = path.join(process.cwd(), 'media');

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

  /**
   * Ruta absoluta donde se guardan los archivos multimedia de WhatsApp (separados por
   * subcarpeta de tenant dentro). Configurable desde Settings > Sistema para que al migrar
   * a otro server alcance con cambiar este valor, sin tocar variables de entorno ni redeploy.
   * Prioridad: DB > MEDIA_STORAGE_PATH (.env) > default (./media junto al backend).
   */
  async getMediaStoragePath(): Promise<string> {
    const record = await this.prisma.systemConfig.findUnique({ where: { id: '1' } });
    return (
      record?.mediaStoragePath ||
      this.config.get('MEDIA_STORAGE_PATH') ||
      this.defaultMediaStoragePath
    );
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
      mediaStoragePath:        record?.mediaStoragePath || '',
      mediaStoragePathDefault: this.config.get('MEDIA_STORAGE_PATH') || this.defaultMediaStoragePath,
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
    if (data.mediaStoragePath !== undefined) payload.mediaStoragePath = data.mediaStoragePath || null;

    return this.prisma.systemConfig.upsert({
      where:  { id: '1' },
      create: { id: '1', ...payload },
      update: payload,
    });
  }
}
