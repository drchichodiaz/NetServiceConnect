import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { SupportService } from './support.service';
import { CreateSupportRequestDto } from './dto/create-support-request.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CurrentUser } from '../common/decorators/current-user.decorator';

/**
 * El botón de soporte. Lo puede usar cualquiera con sesión, incluido un agente: el que
 * ve el error es el que está trabajando, y hacerlo pasar por un admin para avisar
 * significa que el aviso no llega.
 *
 * Lleva su propio límite porque dispara correos. El ThrottlerModule está registrado en
 * AppModule pero sin guard global, así que hoy no limita nada por su cuenta — de ahí el
 * `ThrottlerGuard` puesto acá, que solo afecta a este endpoint.
 */
@UseGuards(JwtAuthGuard, ThrottlerGuard)
@Controller('support')
export class SupportController {
  constructor(private service: SupportService) {}

  /**
   * 8 por hora. El contador suma INTENTOS, no reportes enviados: un formulario que
   * rebota por validación o un reintento tras un corte de red también gastan cupo. Por
   * eso no es 5 — alcanza para un mal día con reintentos y sigue frenando un bucle.
   */
  @Throttle({ default: { limit: 8, ttl: 3_600_000 } })
  @Post()
  create(@CurrentUser() user: any, @Body() dto: CreateSupportRequestDto) {
    return this.service.create(user.tenantId, user, dto);
  }
}
