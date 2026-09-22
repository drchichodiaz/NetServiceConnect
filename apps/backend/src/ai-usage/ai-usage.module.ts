import { Module } from '@nestjs/common';
import { AiGatewayService } from './ai-gateway.service';
import { AiPricingService } from './ai-pricing.service';
import { AiUsageService } from './ai-usage.service';
import { AiUsageController } from './ai-usage.controller';
import { OpenAiClientService } from './openai-client.service';

/**
 * El modulo por el que pasa todo el consumo de IA.
 *
 * Exporta el gateway y NO el cliente de OpenAI: quien necesite IA importa este modulo
 * y usa AiGatewayService, que mide. Esa es toda la garantia de que no haya consumo sin
 * registrar, y por eso OpenAiClientService no se provee en ningun otro modulo.
 */
@Module({
  controllers: [AiUsageController],
  providers: [AiGatewayService, AiPricingService, AiUsageService, OpenAiClientService],
  exports: [AiGatewayService],
})
export class AiUsageModule {}
