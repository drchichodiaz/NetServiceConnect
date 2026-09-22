import { Injectable, NotFoundException, BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { Prisma } from '@prisma/client';
import { CreateTemplateDto } from './dto/create-template.dto';
import { WhatsAppAccountsService } from '../whatsapp/accounts.service';
import { MediaService } from '../media/media.service';
import { MetaUploadService } from './meta-upload.service';
import { validateShape, buildCreateComponents } from './template-components';
import axios from 'axios';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import * as path from 'path';

// Meta acepta hasta 5 MB de imagen para el encabezado de una plantilla.
const MAX_HEADER_IMAGE_BYTES = 5 * 1024 * 1024;

// Un media id de Meta vive ~30 dias; se reusa hasta los 25 para no vencer a mitad de un envio.
const HEADER_MEDIA_TTL_MS = 25 * 24 * 60 * 60 * 1000;

@Injectable()
export class TemplatesService {
  private readonly logger = new Logger(TemplatesService.name);

  constructor(
    private prisma: PrismaService,
    private systemConfig: SystemConfigService,
    private accounts: WhatsAppAccountsService,
    private media: MediaService,
    private metaUpload: MetaUploadService,
  ) {}

  /**
   * La version de la API sale de SystemConfigService (base primero, .env de respaldo),
   * igual que el App ID y el Secret. Leerla una sola vez en el constructor dejaba
   * que un cambio hecho desde Configuracion > Sistema no tuviera efecto hasta reiniciar.
   */
  private async apiVersion(): Promise<string> {
    return (await this.systemConfig.get()).metaApiVersion;
  }

  /**
   * Sube la imagen de un encabezado y devuelve lo que el alta necesita despues.
   * Se hace en un paso aparte del alta para que la pantalla pueda mostrar la vista
   * previa antes de mandar la plantilla, y porque el alta viaja como JSON y no
   * como multipart.
   */
  async uploadHeaderMedia(tenantId: string, file: Express.Multer.File) {
    if (!file?.buffer?.length) throw new BadRequestException('No llegó ninguna imagen');
    if (!/^image\/(jpeg|png)$/.test(file.mimetype)) {
      throw new BadRequestException('El encabezado solo admite imágenes JPG o PNG.');
    }
    if (file.buffer.length > MAX_HEADER_IMAGE_BYTES) {
      throw new BadRequestException('La imagen no puede pesar más de 5 MB.');
    }

    // Primero Meta: si rechaza la imagen no queremos dejar el archivo colgado.
    const handle = await this.metaUpload.uploadHeaderImage(file);

    // La copia local sirve para la vista previa y para re-subir la imagen a una
    // linea cuyo media id ya vencio, sin pedirsela de nuevo a quien la cargo.
    const id = `tplhdr_${randomUUID()}`;
    const relativePath = await this.media.storeFile(tenantId, id, file.buffer, file.mimetype);

    return { handle, path: relativePath, mime: file.mimetype };
  }

  /**
   * La ruta viaja por el cliente entre la subida y el alta, asi que no se puede
   * confiar en ella: sin esto, un `../` alcanzaria para hacer que la plantilla
   * apunte a un archivo de otro tenant (o de fuera del storage).
   */
  private assertOwnMediaPath(tenantId: string, relativePath: string) {
    // storeFile usa path.join, asi que el separador depende del sistema: barra en
    // Linux (produccion) y contrabarra en Windows (desarrollo). Se aceptan los dos.
    const parts = relativePath.split(/[\\/]/);
    const valid =
      parts.length === 2 && parts[0] === tenantId && /^[A-Za-z0-9_-]+\.[A-Za-z0-9]+$/.test(parts[1]);
    if (!valid) throw new BadRequestException('La imagen del encabezado no es válida');
  }

  /**
   * Media id de la imagen del encabezado ya subida a ESA linea, si sigue vigente.
   *
   * El id que devuelve /media vive unos 30 dias y es por numero de telefono, no por
   * WABA, asi que el cache es un mapa por linea. Se corta en 25 dias para no quedar
   * justo contra el vencimiento en medio de un envio.
   */
  getCachedHeaderMediaId(
    template: { headerMediaIds?: any },
    phoneNumberId: string,
  ): string | null {
    const entry = (template.headerMediaIds as Record<string, { id: string; uploadedAt: string }> | null)?.[
      phoneNumberId
    ];
    if (!entry?.id || !entry.uploadedAt) return null;

    const ageMs = Date.now() - new Date(entry.uploadedAt).getTime();
    if (Number.isNaN(ageMs) || ageMs > HEADER_MEDIA_TTL_MS) return null;
    return entry.id;
  }

  /** Guarda el media id recien subido sin pisar los de las otras lineas. */
  async cacheHeaderMediaId(templateId: string, phoneNumberId: string, mediaId: string) {
    const template = await this.prisma.messageTemplate.findUnique({ where: { id: templateId } });
    const current = (template?.headerMediaIds as Record<string, unknown> | null) ?? {};
    // Prisma tipa las columnas Json de forma estricta y un objeto/array plano no
    // encaja en InputJsonValue sin ayuda.
    const next = { ...current, [phoneNumberId]: { id: mediaId, uploadedAt: new Date().toISOString() } } as Prisma.InputJsonValue;
    await this.prisma.messageTemplate.update({
      where: { id: templateId },
      data: { headerMediaIds: next },
    });
  }

  /** La copia local de la imagen del encabezado, con la forma que espera la subida a Meta. */
  async readHeaderMediaFile(template: { headerMediaPath?: string | null; headerMediaMime?: string | null }) {
    if (!template.headerMediaPath) return null;
    const absolutePath = await this.media.resolveAbsolutePath(template.headerMediaPath);
    if (!(await this.media.exists(template.headerMediaPath))) return null;
    return {
      buffer: await fs.readFile(absolutePath),
      originalname: path.basename(absolutePath),
      mimetype: template.headerMediaMime || 'image/jpeg',
    };
  }

  /** Archivo de la imagen del encabezado, para la vista previa en el panel. */
  async getHeaderMediaFile(tenantId: string, id: string) {
    const template = await this.findOneOrThrow(tenantId, id);
    if (!template.headerMediaPath) throw new NotFoundException('Esta plantilla no tiene imagen de encabezado');
    return {
      absolutePath: await this.media.resolveAbsolutePath(template.headerMediaPath),
      mimeType: template.headerMediaMime || 'application/octet-stream',
    };
  }

  async create(tenantId: string, dto: CreateTemplateDto) {
    // Las plantillas se dan de alta contra el WABA, no contra un numero: quedan
    // disponibles para todas las lineas de ese WABA. Con varios WABA el alta elige
    // en cual crearla; sin eleccion va a la de la linea por defecto.
    const account = dto.wabaId
      ? await this.accountForWabaOrThrow(tenantId, dto.wabaId)
      : await this.accounts.getDefault(tenantId);
    if (!account) {
      throw new BadRequestException('No hay ninguna línea de WhatsApp activa en esta empresa');
    }

    const existing = await this.prisma.messageTemplate.findFirst({
      where: { tenantId, wabaId: account.wabaId, name: dto.name, language: dto.language },
    });
    if (existing) {
      throw new ConflictException('Ya existe una plantilla con ese nombre e idioma en esta cuenta de WhatsApp');
    }

    if (dto.headerFormat === 'IMAGE') {
      if (!dto.headerMediaPath) throw new BadRequestException('Falta la imagen del encabezado');
      this.assertOwnMediaPath(tenantId, dto.headerMediaPath);
    }

    // Todas las reglas de forma viven en template-components: los limites de Meta,
    // la numeracion de las variables y las restricciones de los botones.
    const { variableCount } = validateShape(dto);
    const components = buildCreateComponents(dto);

    let metaTemplateId: string | undefined;
    let status = 'PENDING';
    try {
      const url = `https://graph.facebook.com/${await this.apiVersion()}/${account.wabaId}/message_templates`;
      const { data } = await axios.post(
        url,
        {
          name: dto.name,
          language: dto.language,
          category: dto.category,
          components,
        },
        { headers: { Authorization: `Bearer ${account.accessToken}`, 'Content-Type': 'application/json' } },
      );
      metaTemplateId = data?.id;
      status = data?.status || 'PENDING';
    } catch (err) {
      this.logger.error('Failed to create template in Meta', err?.response?.data);
      throw new BadRequestException(err?.response?.data?.error?.message || 'Failed to create template in Meta');
    }

    return this.prisma.messageTemplate.create({
      data: {
        tenantId,
        wabaId: account.wabaId,
        name: dto.name,
        language: dto.language,
        category: dto.category,
        headerFormat: dto.headerFormat ?? null,
        headerText: dto.headerFormat === 'TEXT' ? dto.headerText : null,
        headerMediaPath: dto.headerFormat === 'IMAGE' ? dto.headerMediaPath : null,
        headerMediaMime: dto.headerFormat === 'IMAGE' ? dto.headerMediaMime : null,
        footerText: dto.footerText?.trim() || null,
        buttons: dto.buttons?.length ? (dto.buttons as unknown as Prisma.InputJsonValue) : undefined,
        bodyText: dto.bodyText,
        variableCount,
        status,
        metaTemplateId,
      },
    });
  }

  /**
   * Con `channelAccountId` devuelve solo las plantillas del WABA de esa linea — las
   * unicas que un envio por esa linea puede usar. El selector de "iniciar conversacion"
   * pide asi, para no ofrecer plantillas que Meta rechazaria con 132001.
   */
  async findAll(tenantId: string, channelAccountId?: string) {
    let wabaFilter: string | undefined;
    if (channelAccountId) {
      const account = await this.prisma.channelAccount.findFirst({
        where: { id: channelAccountId, tenantId },
        select: { wabaId: true },
      });
      // Linea inexistente: se filtra por un valor imposible en vez de devolver todo,
      // para no ofrecer plantillas que no se van a poder enviar.
      wabaFilter = account?.wabaId ?? '__linea_desconocida__';
    }

    return this.prisma.messageTemplate.findMany({
      where: { tenantId, ...(wabaFilter && { wabaId: wabaFilter }) },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Una cuenta activa de ese WABA — la que presta el token para hablarle a Meta. */
  private async accountForWabaOrThrow(tenantId: string, wabaId: string) {
    const account = await this.prisma.channelAccount.findFirst({
      where: { tenantId, wabaId, isActive: true },
    });
    if (!account) {
      throw new BadRequestException('Esa cuenta de WhatsApp Business no tiene ninguna línea activa');
    }
    return account;
  }

  async refreshStatus(tenantId: string, id: string) {
    const template = await this.findOneOrThrow(tenantId, id);
    if (!template.metaTemplateId) return template;

    const account = await this.accountForTemplate(tenantId, template.wabaId);
    if (!account) throw new BadRequestException('No active WhatsApp account found for this tenant');

    try {
      const url = `https://graph.facebook.com/${await this.apiVersion()}/${template.metaTemplateId}`;
      const { data } = await axios.get(url, {
        params: { fields: 'status,rejected_reason' },
        headers: { Authorization: `Bearer ${account.accessToken}` },
      });
      return this.prisma.messageTemplate.update({
        where: { id },
        data: { status: data?.status || template.status, rejectReason: data?.rejected_reason || null },
      });
    } catch (err) {
      this.logger.error('Failed to refresh template status', err?.response?.data);
      throw new BadRequestException('Failed to refresh template status');
    }
  }

  async remove(tenantId: string, id: string) {
    const template = await this.findOneOrThrow(tenantId, id);
    const account = await this.accountForTemplate(tenantId, template.wabaId);

    if (account && template.metaTemplateId) {
      try {
        const url = `https://graph.facebook.com/${await this.apiVersion()}/${account.wabaId}/message_templates`;
        await axios.delete(url, {
          params: { name: template.name },
          headers: { Authorization: `Bearer ${account.accessToken}` },
        });
      } catch (err) {
        this.logger.warn('Failed to delete template in Meta (continuing with local delete)', err?.response?.data);
      }
    }

    return this.prisma.messageTemplate.delete({ where: { id } });
  }

  private async findOneOrThrow(tenantId: string, id: string) {
    const template = await this.prisma.messageTemplate.findFirst({ where: { id, tenantId } });
    if (!template) throw new NotFoundException('Template not found');
    return template;
  }

  /**
   * `wabaId` es el de la linea desde la que se va a enviar. Meta guarda las plantillas
   * por WABA: mandar una de otro WABA devuelve 132001 con un texto que no dice nada
   * util, asi que se corta antes con un mensaje que explica que hacer.
   */
  async findApprovedOrThrow(tenantId: string, id: string, wabaId?: string) {
    const template = await this.findOneOrThrow(tenantId, id);

    // Estos rechazos se loguean igual que los errores de Meta: si no, un envio
    // frenado aca no deja ningun rastro en el log y desde el server parece que
    // nunca se intento enviar nada.
    if (template.status !== 'APPROVED') {
      this.logger.warn(
        `[Envio bloqueado] Plantilla "${template.name}" (${template.id}) en estado ${template.status}, no APPROVED`,
      );
      throw new BadRequestException('La plantilla todavía no está aprobada por Meta');
    }
    if (wabaId && template.wabaId && template.wabaId !== wabaId) {
      this.logger.warn(
        `[Envio bloqueado] Plantilla "${template.name}" (${template.id}) pertenece al WABA ${template.wabaId} ` +
          `pero se intento enviar desde una linea del WABA ${wabaId}`,
      );
      throw new BadRequestException(
        `La plantilla "${template.name}" pertenece a otra cuenta de WhatsApp Business (WABA ${template.wabaId}) ` +
          'y no existe para la línea desde la que estás enviando. Creála también en esta cuenta para poder usarla.',
      );
    }
    return template;
  }

  /**
   * La cuenta cuyo WABA es dueño de la plantilla — no la linea por defecto. Alta,
   * consulta de estado y borrado tienen que pegarle al WABA correcto o Meta responde
   * sobre una plantilla que no es.
   */
  private async accountForTemplate(tenantId: string, wabaId: string | null) {
    if (wabaId) {
      const owner = await this.prisma.channelAccount.findFirst({
        where: { tenantId, wabaId, isActive: true },
      });
      if (owner) return owner;
    }
    return this.accounts.getDefault(tenantId);
  }
}
