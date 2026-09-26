import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';

/**
 * El enlace que le llega al doctor cada mañana: /mis-citas/<codigo>.
 *
 * El codigo dice de que doctor y de que dia es, firmado con una clave del servidor:
 * `<doctorId>.<AAAAMMDD>.<firma>`. No hay tabla de enlaces ni sesion: quien no tiene la
 * clave no puede fabricar uno, y cambiar el doctor o el dia rompe la firma. Solo sirve
 * para el dia que dice (lo controla quien lo lee), asi que un enlace reenviado o viejo
 * deja de mostrar pacientes a la medianoche.
 *
 * La clave se deriva del JWT_SECRET con un proposito propio, para que una firma de esto
 * nunca sirva como otra cosa (ni al reves).
 */
@Injectable()
export class DoctorLinkService {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const secret = config.get<string>('JWT_SECRET') || 'dev-secret';
    this.key = createHmac('sha256', secret).update('agenda:doctor-day-link').digest();
  }

  sign(doctorId: string, date: string): string {
    const day = date.replace(/-/g, '');
    return `${doctorId}.${day}.${this.signature(doctorId, day)}`;
  }

  /** El doctor y el dia (YYYY-MM-DD) del codigo, o null si no es valido. */
  verify(token: string): { doctorId: string; date: string } | null {
    const parts = String(token).split('.');
    if (parts.length !== 3) return null;
    const [doctorId, day, sig] = parts;
    if (!/^[a-z0-9]+$/i.test(doctorId) || !/^\d{8}$/.test(day)) return null;
    const expected = Buffer.from(this.signature(doctorId, day));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
    return { doctorId, date: `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}` };
  }

  private signature(doctorId: string, day: string) {
    return createHmac('sha256', this.key).update(`${doctorId}|${day}`).digest('base64url').slice(0, 22);
  }
}
