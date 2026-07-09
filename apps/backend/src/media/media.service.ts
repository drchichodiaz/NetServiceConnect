import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { SystemConfigService } from '../system-config/system-config.service';

const EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/amr': 'amr',
  'audio/aac': 'aac',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
};

function extensionFor(mimeType: string): string {
  return EXTENSION_BY_MIME[mimeType] || mimeType.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'bin';
}

@Injectable()
export class MediaService {
  private readonly logger = new Logger(MediaService.name);

  constructor(private systemConfig: SystemConfigService) {}

  /**
   * Descarga un media entrante de WhatsApp (2 pasos: resolver URL temporal, luego bajar el binario)
   * y lo guarda en disco separado por tenant. Devuelve la ruta relativa guardada y el mime type real.
   */
  async downloadInboundMedia(
    tenantId: string,
    mediaId: string,
    accessToken: string,
    apiVersion: string,
  ): Promise<{ relativePath: string; mimeType: string }> {
    const metaRes = await axios.get(`https://graph.facebook.com/${apiVersion}/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const downloadUrl: string | undefined = metaRes.data?.url;
    if (!downloadUrl) throw new Error('Meta no devolvio una URL de descarga para el media');

    const fileRes = await axios.get<ArrayBuffer>(downloadUrl, {
      headers: { Authorization: `Bearer ${accessToken}` },
      responseType: 'arraybuffer',
    });

    const mimeType = (metaRes.data?.mime_type || 'application/octet-stream').split(';')[0].trim();
    const relativePath = await this.storeFile(tenantId, mediaId, Buffer.from(fileRes.data), mimeType);

    return { relativePath, mimeType };
  }

  /**
   * Guarda un buffer en disco bajo {root}/{tenantId}/{id}.{ext}. Usado tanto para media
   * entrante (id = media id de Meta) como saliente (id = media id que Meta asigno al subirlo).
   */
  async storeFile(tenantId: string, id: string, buffer: Buffer, mimeType: string): Promise<string> {
    const root = await this.systemConfig.getMediaStoragePath();
    const ext = extensionFor(mimeType);

    const tenantDir = path.join(root, tenantId);
    fs.mkdirSync(tenantDir, { recursive: true });

    const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `${safeId}.${ext}`;
    fs.writeFileSync(path.join(tenantDir, fileName), buffer);

    return path.join(tenantId, fileName);
  }

  /** Ruta absoluta en disco para un path relativo guardado en Message.mediaUrl. */
  async resolveAbsolutePath(relativePath: string): Promise<string> {
    const root = await this.systemConfig.getMediaStoragePath();
    return path.join(root, relativePath);
  }

  async exists(relativePath: string): Promise<boolean> {
    return fs.existsSync(await this.resolveAbsolutePath(relativePath));
  }
}
