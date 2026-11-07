import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { MetaUploadService } from '../templates/meta-upload.service';
import { WhatsAppAccountsService } from './accounts.service';
import { UpdateBusinessProfileDto } from './dto/business-profile.dto';

export interface BusinessProfile {
  about: string;
  address: string;
  description: string;
  email: string;
  websites: string[];
  vertical: string;
  profilePictureUrl: string | null;
}

const FIELDS = 'about,address,description,email,profile_picture_url,websites,vertical';

/** Meta pide minimo 192x192 y recomienda 640x640; el tope de 5 MB es el suyo. */
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const PHOTO_TYPES = ['image/jpeg', 'image/png'];

/**
 * El perfil de empresa de cada linea (foto, info, descripcion, direccion, email, webs,
 * categoria): lo que ve el cliente al tocar el nombre en WhatsApp.
 *
 * No se guarda nada en la base: Meta es la unica fuente de verdad y cada lectura va
 * a Meta. Asi un cambio hecho desde el Administrador de WhatsApp aparece aca sin
 * sincronizar nada.
 */
@Injectable()
export class BusinessProfileService {
  private readonly logger = new Logger(BusinessProfileService.name);

  constructor(
    private prisma: PrismaService,
    private systemConfig: SystemConfigService,
    private accounts: WhatsAppAccountsService,
    private metaUpload: MetaUploadService,
  ) {}

  private async url(phoneNumberId: string) {
    const cfg = await this.systemConfig.get();
    return `https://graph.facebook.com/${cfg.metaApiVersion}/${phoneNumberId}/whatsapp_business_profile`;
  }

  private async lineOrThrow(tenantId: string, id: string) {
    const account = await this.accounts.findActiveOrThrow(tenantId, id);
    if (account.channel !== 'WHATSAPP' || !account.phoneNumberId) {
      throw new BadRequestException('Esa línea no es de WhatsApp');
    }
    return account as typeof account & { phoneNumberId: string };
  }

  async get(tenantId: string, id: string): Promise<BusinessProfile> {
    const account = await this.lineOrThrow(tenantId, id);
    const res = await fetch(`${await this.url(account.phoneNumberId)}?fields=${FIELDS}`, {
      headers: { Authorization: `Bearer ${account.accessToken}` },
    });
    const data = (await res.json()) as { data?: any[]; error?: { message: string } };
    if (!res.ok || data.error) {
      this.logger.warn(`[Perfil] No se pudo leer el perfil de ${account.phoneNumberId}: ${data.error?.message}`);
      throw new BadRequestException(data.error?.message || 'No se pudo leer el perfil en Meta');
    }
    const p = data.data?.[0] ?? {};
    return {
      about: p.about ?? '',
      address: p.address ?? '',
      description: p.description ?? '',
      email: p.email ?? '',
      websites: Array.isArray(p.websites) ? p.websites : [],
      vertical: p.vertical ?? 'UNDEFINED',
      profilePictureUrl: p.profile_picture_url ?? null,
    };
  }

  async update(tenantId: string, userId: string, id: string, dto: UpdateBusinessProfileDto) {
    const account = await this.lineOrThrow(tenantId, id);

    const body: Record<string, unknown> = {};
    if (dto.about !== undefined) {
      const about = dto.about.trim();
      // Meta rechaza "about" vacio; mejor decirlo que dejar que devuelva un error generico.
      if (!about) throw new BadRequestException('La info del perfil no puede quedar vacía');
      body.about = about;
    }
    if (dto.address !== undefined) body.address = dto.address.trim();
    if (dto.description !== undefined) body.description = dto.description.trim();
    if (dto.email !== undefined) {
      const email = dto.email.trim();
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new BadRequestException('El email no es válido');
      body.email = email;
    }
    if (dto.websites !== undefined) body.websites = dto.websites.map((w) => w.trim()).filter(Boolean);
    if (dto.vertical !== undefined) body.vertical = dto.vertical;

    const fields = Object.keys(body);
    if (fields.length === 0) return this.get(tenantId, id);

    await this.post(account, body);
    await this.audit(tenantId, userId, account.id, fields);
    return this.get(tenantId, id);
  }

  async setPhoto(tenantId: string, userId: string, id: string, file: Express.Multer.File) {
    const account = await this.lineOrThrow(tenantId, id);
    if (!PHOTO_TYPES.includes(file.mimetype)) throw new BadRequestException('La foto tiene que ser JPG o PNG');
    if (file.size > MAX_PHOTO_BYTES) throw new BadRequestException('La foto no puede pesar más de 5 MB');

    const handle = await this.metaUpload.uploadImage(file, 'la foto de perfil');
    await this.post(account, { profile_picture_handle: handle });
    await this.audit(tenantId, userId, account.id, ['photo']);
    return this.get(tenantId, id);
  }

  private async post(account: { phoneNumberId: string; accessToken: string }, body: Record<string, unknown>) {
    const res = await fetch(await this.url(account.phoneNumberId), {
      method: 'POST',
      headers: { Authorization: `Bearer ${account.accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', ...body }),
    });
    const data = (await res.json()) as { success?: boolean; error?: { message: string; error_user_msg?: string } };
    if (!res.ok || data.error || data.success === false) {
      this.logger.warn(`[Perfil] Meta rechazó el cambio en ${account.phoneNumberId}: ${JSON.stringify(data.error)}`);
      throw new BadRequestException(data.error?.error_user_msg || data.error?.message || 'Meta no aceptó el cambio de perfil');
    }
  }

  private audit(tenantId: string, userId: string, channelAccountId: string, fields: string[]) {
    return this.prisma.auditLog.create({
      data: { tenantId, userId, action: 'whatsapp.profile_updated', metadata: { channelAccountId, fields } },
    });
  }
}
