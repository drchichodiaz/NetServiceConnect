import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';

/**
 * Loguea los pedidos que fallan, con el id que les puso RequestIdMiddleware.
 *
 * Solo los que fallan: loguear los 200 en un servidor con la bandeja abierta llenaría
 * el log de ruido y el problema real quedaría enterrado. Lo que hace falta es que,
 * cuando alguien manda un reporte de soporte con el id del pedido que le falló, ese id
 * aparezca en `docker logs`.
 *
 * Deja pasar el error tal cual: no cambia ni una respuesta, solo escribe una línea.
 */
@Injectable()
export class RequestLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger('Request');

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest();
    if (!req?.method) return next.handle(); // no es HTTP (websocket, etc.)

    return next.handle().pipe(
      catchError((err) => {
        const status = err?.status ?? err?.getStatus?.() ?? 500;
        const id = req.requestId ?? '-';
        const user = req.user?.email ?? 'anónimo';
        const detail = err?.response?.message ?? err?.message ?? String(err);
        const line = `[req ${id}] ${req.method} ${req.originalUrl ?? req.url} -> ${status} (${user}): ${
          Array.isArray(detail) ? detail.join('; ') : detail
        }`;

        // Un 500 es un problema nuestro y lleva la traza; un 4xx es casi siempre una
        // validación y solo necesita la línea, si no cada campo mal tipeado escribiría
        // una traza entera.
        if (status >= 500) this.logger.error(line, err?.stack);
        else this.logger.warn(line);

        return throwError(() => err);
      }),
    );
  }
}
