import { Injectable, NotFoundException, BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { WhatsAppAccountsService } from '../whatsapp/accounts.service';
import axios from 'axios';

@Injectable()
export class TemplatesService {
  private readonly logger = new Logger(TemplatesService.name);
  private readonly apiVersion: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private accounts: WhatsAppAccountsService,
  ) {
    this.apiVersion = config.get('META_API_VERSION') || 'v19.0';
  }

  private countVariables(text: string): number {
    const matches = text.match(/\{\{\d+\}\}/g);
    return matches ? new Set(matches).size : 0;
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

    const variableCount = this.countVariables(dto.bodyText);

    if (variableCount > 0 && dto.exampleValues?.length !== variableCount) {
      throw new BadRequestException(
        `Esta plantilla tiene ${variableCount} variable(s) — necesitas dar un valor de ejemplo para cada una (Meta lo exige para poder aprobarla).`,
      );
    }

    const bodyComponent: any = { type: 'BODY', text: dto.bodyText };
    if (variableCount > 0) {
      bodyComponent.example = { body_text: [dto.exampleValues] };
    }

    let metaTemplateId: string | undefined;
    let status = 'PENDING';
    try {
      const url = `https://graph.facebook.com/${this.apiVersion}/${account.wabaId}/message_templates`;
      const { data } = await axios.post(
        url,
        {
          name: dto.name,
          language: dto.language,
          category: dto.category,
          components: [bodyComponent],
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
        bodyText: dto.bodyText,
        variableCount,
        status,
        metaTemplateId,
      },
    });
  }

  /**
   * Con `whatsappAccountId` devuelve solo las plantillas del WABA de esa linea — las
   * unicas que un envio por esa linea puede usar. El selector de "iniciar conversacion"
   * pide asi, para no ofrecer plantillas que Meta rechazaria con 132001.
   */
  async findAll(tenantId: string, whatsappAccountId?: string) {
    let wabaFilter: string | undefined;
    if (whatsappAccountId) {
      const account = await this.prisma.whatsAppAccount.findFirst({
        where: { id: whatsappAccountId, tenantId },
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
    const account = await this.prisma.whatsAppAccount.findFirst({
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
      const url = `https://graph.facebook.com/${this.apiVersion}/${template.metaTemplateId}`;
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
        const url = `https://graph.facebook.com/${this.apiVersion}/${account.wabaId}/message_templates`;
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
    if (template.status !== 'APPROVED') {
      throw new BadRequestException('La plantilla todavía no está aprobada por Meta');
    }
    if (wabaId && template.wabaId && template.wabaId !== wabaId) {
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
      const owner = await this.prisma.whatsAppAccount.findFirst({
        where: { tenantId, wabaId, isActive: true },
      });
      if (owner) return owner;
    }
    return this.accounts.getDefault(tenantId);
  }
}
