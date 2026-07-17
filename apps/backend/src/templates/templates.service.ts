import { Injectable, NotFoundException, BadRequestException, ConflictException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import axios from 'axios';

@Injectable()
export class TemplatesService {
  private readonly logger = new Logger(TemplatesService.name);
  private readonly apiVersion: string;

  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
  ) {
    this.apiVersion = config.get('META_API_VERSION') || 'v19.0';
  }

  private countVariables(text: string): number {
    const matches = text.match(/\{\{\d+\}\}/g);
    return matches ? new Set(matches).size : 0;
  }

  async create(tenantId: string, dto: CreateTemplateDto) {
    const account = await this.prisma.whatsAppAccount.findUnique({ where: { tenantId } });
    if (!account || !account.isActive) {
      throw new BadRequestException('No active WhatsApp account found for this tenant');
    }

    const existing = await this.prisma.messageTemplate.findUnique({
      where: { tenantId_name_language: { tenantId, name: dto.name, language: dto.language } },
    });
    if (existing) throw new ConflictException('A template with this name/language already exists');

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

  findAll(tenantId: string) {
    return this.prisma.messageTemplate.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async refreshStatus(tenantId: string, id: string) {
    const template = await this.findOneOrThrow(tenantId, id);
    if (!template.metaTemplateId) return template;

    const account = await this.prisma.whatsAppAccount.findUnique({ where: { tenantId } });
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
    const account = await this.prisma.whatsAppAccount.findUnique({ where: { tenantId } });

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

  async findApprovedOrThrow(tenantId: string, id: string) {
    const template = await this.findOneOrThrow(tenantId, id);
    if (template.status !== 'APPROVED') {
      throw new BadRequestException('Template is not approved yet');
    }
    return template;
  }
}
