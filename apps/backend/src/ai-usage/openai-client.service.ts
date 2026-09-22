import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../common/services/crypto.service';

export interface ResolvedAiClient {
  client: OpenAI;
  model: string;
  /** BYOK: paga el tenant, no se cobra. PLATFORM: pagamos nosotros, consume creditos. */
  mode: 'BYOK' | 'PLATFORM';
}

/**
 * Resuelve con que clave y con que modelo se atiende a un tenant.
 *
 * Vive dentro de este modulo y NO se exporta: el unico que lo puede usar es el gateway,
 * que mide y cobra. Si esto volviera a estar disponible para cualquier modulo, la
 * primera funcionalidad nueva con IA gastaria sin dejar rastro.
 */
@Injectable()
export class OpenAiClientService {
  private readonly fallbackApiKey: string;
  private readonly fallbackModel: string;

  constructor(
    private config: ConfigService,
    private prisma: PrismaService,
    private crypto: CryptoService,
  ) {
    this.fallbackApiKey = config.get('OPENAI_API_KEY') || '';
    this.fallbackModel = config.get('OPENAI_MODEL') || 'gpt-4o-mini';
  }

  /** Devuelve null (en vez de lanzar) si no hay una clave utilizable — el llamador decide. */
  async getClient(tenantId: string): Promise<ResolvedAiClient | null> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { openaiApiKey: true, openaiModel: true, aiBillingMode: true },
    });

    if (tenant?.aiBillingMode === 'PLATFORM') {
      const config = await this.prisma.systemConfig.findUnique({ where: { id: '1' } });
      // La clave de plataforma se guarda cifrada. El .env queda como respaldo para
      // desarrollo, donde no hay panel donde cargarla.
      const apiKey =
        (config?.aiPlatformApiKey ? this.crypto.decrypt(config.aiPlatformApiKey) : null) || this.fallbackApiKey;
      if (!apiKey) return null;

      // El modelo lo decide la plataforma, no el cliente: con nuestra clave, esa
      // eleccion regula nuestro costo y cuanto le rinde el paquete que compro.
      return { client: new OpenAI({ apiKey }), model: config?.aiPlatformModel || this.fallbackModel, mode: 'PLATFORM' };
    }

    const apiKey = tenant?.openaiApiKey || this.fallbackApiKey;
    const model = tenant?.openaiModel || this.fallbackModel;
    if (!apiKey) return null;

    return { client: new OpenAI({ apiKey }), model, mode: 'BYOK' };
  }
}
