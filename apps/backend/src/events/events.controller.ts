import { Controller, Get, Query, Sse, UnauthorizedException, MessageEvent } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Observable } from 'rxjs';
import { EventBusService } from './event-bus.service';

@Controller('events')
export class EventsController {
  constructor(
    private eventBus: EventBusService,
    private jwt: JwtService,
    private config: ConfigService,
  ) {}

  // EventSource del browser no soporta headers custom, por eso el token va en query param
  @Sse()
  stream(@Query('token') token: string): Observable<MessageEvent> {
    let tenantId: string;

    try {
      const payload = this.jwt.verify(token, {
        secret: this.config.get<string>('JWT_SECRET'),
      }) as { tenantId: string };
      tenantId = payload.tenantId;
    } catch {
      throw new UnauthorizedException('Token SSE inválido');
    }

    return new Observable((subscriber) => {
      // Heartbeat cada 25s para mantener la conexión viva ante proxies
      const heartbeat = setInterval(() => {
        subscriber.next({ data: JSON.stringify({ type: 'heartbeat' }) } as MessageEvent);
      }, 25_000);

      // Suscribirse solo a eventos del tenant de este cliente
      const unsubscribe = this.eventBus.subscribe((event) => {
        if (event.tenantId === tenantId) {
          subscriber.next({ data: JSON.stringify(event) } as MessageEvent);
        }
      });

      // Limpiar al desconectar
      return () => {
        clearInterval(heartbeat);
        unsubscribe();
      };
    });
  }
}
