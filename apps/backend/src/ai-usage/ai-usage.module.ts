import { Module } from '@nestjs/common';
import { AiGatewayService } from './ai-gateway.service';
import { AiPricingService } from './ai-pricing.service';
import { AiUsageService } from './ai-usage.service';
import { AiWalletService } from './ai-wallet.service';
import { AiCreditsWorkerService } from './ai-credits-worker.service';
import { AiUsageController } from './ai-usage.controller';
import { AiCreditsController } from './ai-credits.controller';
import { AiCreditsService } from './ai-credits.service';
import { AiAlertsService } from './ai-alerts.service';
import { OpenAiClientService } from './openai-client.service';
import { CryptoService } from '../common/services/crypto.service';

/**
 * El modulo por el que pasa todo el consumo de IA.
 *
 * Exporta el gateway y la billetera, pero NO el cliente de OpenAI: quien necesite IA
 * importa este modulo y usa AiGatewayService, que mide y cobra. Esa es toda la garantia
 * de que no haya consumo sin registrar, y por eso OpenAiClientService no se provee en
 * ningun otro modulo.
 */
@Module({
  controllers: [AiUsageController, AiCreditsController],
  providers: [
    AiGatewayService,
    AiPricingService,
    AiUsageService,
    AiWalletService,
    AiCreditsService,
    AiAlertsService,
    AiCreditsWorkerService,
    OpenAiClientService,
    CryptoService,
  ],
  exports: [AiGatewayService, AiWalletService],
})
export class AiUsageModule {}
