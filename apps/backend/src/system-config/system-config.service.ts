import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/services/crypto.service';
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
    private crypto: CryptoService,
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

  /**
   * A donde llegan los reportes del boton de soporte en ESTE entorno. Vacio = no se
   * envian (se guardan igual). Prioridad: base > SUPPORT_EMAIL del entorno, como el
   * resto de la configuracion.
   */
  async getSupportEmail(): Promise<string> {
    const record = await this.prisma.systemConfig.findUnique({ where: { id: '1' } });
    return record?.supportEmail || this.config.get<string>('SUPPORT_EMAIL') || '';
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
      supportEmail:        record?.supportEmail || '',
      supportEmailDefault: this.config.get<string>('SUPPORT_EMAIL') || '',
      source: fromDb ? 'db' : 'env',
    };
  }

  /**
   * Lo minimo que necesita el Embedded Signup para abrir el popup de Meta: el App ID
   * y el Config ID. NO son secretos — viajan en la URL del login de Facebook, cualquiera
   * que abra el popup los ve. El App Secret y el verify token si lo son y siguen
   * saliendo solo por getForFrontend(), que es superadmin.
   */
  async getPublicMetaConfig() {
    const record = await this.prisma.systemConfig.findUnique({ where: { id: '1' } });
    const cfg = await this.get();
    return {
      metaAppId:      cfg.metaAppId,
      metaConfigId:   record?.metaConfigId || '',
      metaApiVersion: cfg.metaApiVersion,
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
    // Vaciar el campo vuelve a la del entorno, no deja el sistema sin direccion.
    if (data.supportEmail !== undefined) payload.supportEmail = data.supportEmail.trim() || null;

    return this.prisma.systemConfig.upsert({
      where:  { id: '1' },
      create: { id: '1', ...payload },
      update: payload,
    });
  }

  /**
   * Configuracion de correo saliente. Prioridad: base > variables MAIL_* del entorno.
   * La comparacion es campo por campo a proposito: una instalacion puede tener el host
   * en el .env y solo la clave cargada desde el panel, o al reves.
   *
   * La contrasena se guarda cifrada, asi que acá se descifra. Si no se puede (cambio la
   * clave del servidor), se cae a la del entorno en vez de devolver un valor corrupto
   * que fallaria recien al intentar conectarse.
   */
  async getMailConfig() {
    const record = await this.prisma.systemConfig.findUnique({ where: { id: '1' } });
    const storedPass = record?.mailPass ? this.crypto.decrypt(record.mailPass) : null;

    return {
      host: record?.mailHost || this.config.get<string>('MAIL_HOST') || '',
      port: record?.mailPort ?? Number(this.config.get('MAIL_PORT') ?? 587),
      user: record?.mailUser || this.config.get<string>('MAIL_USER') || '',
      pass: storedPass || this.config.get<string>('MAIL_PASS') || '',
      from: record?.mailFrom || this.config.get<string>('MAIL_FROM') || '',
      /** De donde salio la config, para poder decirlo en el panel. */
      source: record?.mailHost ? ('db' as const) : ('env' as const),
    };
  }

  /** Guarda la configuracion de correo. Una contrasena vacia deja la que ya estaba:
   *  el panel nunca devuelve la actual, asi que un guardado sin tocar ese campo no
   *  tiene que borrarla. */
  async updateMailConfig(data: {
    mailHost?: string; mailPort?: number; mailUser?: string; mailPass?: string; mailFrom?: string;
  }) {
    const payload: any = {};
    if (data.mailHost !== undefined) payload.mailHost = data.mailHost.trim() || null;
    if (data.mailPort !== undefined) payload.mailPort = data.mailPort || null;
    if (data.mailUser !== undefined) payload.mailUser = data.mailUser.trim() || null;
    if (data.mailFrom !== undefined) payload.mailFrom = data.mailFrom.trim() || null;
    if (data.mailPass) payload.mailPass = this.crypto.encrypt(data.mailPass);

    await this.prisma.systemConfig.upsert({
      where: { id: '1' },
      create: { id: '1', ...payload },
      update: payload,
    });
    return this.getMailConfig();
  }

}
