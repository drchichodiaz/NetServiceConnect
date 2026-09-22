import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Request, Response, NextFunction } from 'express';

/** El header con el que viaja, en la respuesta y (si alguien lo reenvia) en el pedido. */
export const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Le pone un identificador a cada pedido y lo devuelve en la respuesta.
 *
 * Existe por el boton de soporte: cuando alguien reporta "no me deja crear la campaña",
 * el panel adjunta el id del pedido que fallo y con eso se encuentra la linea exacta en
 * los logs del servidor, en vez de buscar por hora aproximada entre todos los tenants.
 *
 * Es corto a proposito (12 caracteres): lo suficiente para no repetirse en los logs de
 * un dia y lo bastante corto como para que alguien lo pueda leer por telefono.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction) {
    // Si el pedido ya trae uno (un proxy, un reintento del panel), se respeta: asi las
    // dos puntas hablan del mismo id.
    const incoming = req.headers[REQUEST_ID_HEADER];
    const id = typeof incoming === 'string' && incoming.trim()
      ? incoming.trim().slice(0, 64)
      : randomUUID().replace(/-/g, '').slice(0, 12);

    (req as any).requestId = id;
    res.setHeader(REQUEST_ID_HEADER, id);
    next();
  }
}
