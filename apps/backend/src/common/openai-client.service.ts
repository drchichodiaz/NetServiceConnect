import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';

/** Resuelve el cliente de OpenAI de un tenant (clave propia, o la de .env como fallback). */
@Injectable()
export class OpenAiClientService {
  private readonly fallbackApiKey: string;
  private readonly fallbackModel: string;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
  ) {
    this.fallbackApiKey = config.get('OPENAI_API_KEY') || '';
    this.fallbackModel = config.get('OPENAI_MODEL') || 'gpt-4o-mini';
  }

  /** Devuelve null (en vez de lanzar) si el tenant no tiene una clave utilizable — el llamador decide cómo manejarlo. */
  async getClient(tenantId: string): Promise<{ client: OpenAI; model: string } | null> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { openaiApiKey: true, openaiModel: true },
    });

    const apiKey = tenant?.openaiApiKey || this.fallbackApiKey;
    const model = tenant?.openaiModel || this.fallbackModel;

    if (!apiKey) return null;

    return { client: new OpenAI({ apiKey }), model };
  }
}
