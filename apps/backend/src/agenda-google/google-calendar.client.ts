import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { createSign } from 'crypto';

const API = 'https://www.googleapis.com/calendar/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

export interface GoogleEvent {
  summary: string;
  location: string;
  description: string | null;
  startsAt: Date;
  endsAt: Date;
  /** Color del evento, "1" a "11". Sin esto toma el del calendario. */
  colorId?: string;
}

/** El codigo HTTP con que respondio Google, o null si ni siquiera respondio. */
export function googleStatus(err: any): number | null {
  return err?.response?.status ?? null;
}

export function googleMessage(err: any): string {
  return err?.response?.data?.error?.message || err?.message || 'Google no respondió';
}

/**
 * Google Calendar con una cuenta de servicio: una cuenta de Google que es de Connect y
 * no de una persona. Los calendarios son suyos y se comparten con el Gmail de cada
 * doctor, que es como las clinicas ya trabajan entre ellas. Asi nadie inicia sesion con
 * Google en Connect, y no hace falta que Google verifique la aplicacion.
 *
 * La credencial es el archivo JSON de la cuenta de servicio, en la variable
 * GOOGLE_CALENDAR_CREDENTIALS (el JSON tal cual o en base64, que entra en una linea de
 * un .env). Sin la variable, todo esto queda apagado.
 *
 * Sin la libreria de Google: son seis llamadas REST y firmar un JWT.
 */
@Injectable()
export class GoogleCalendarClient {
  private readonly logger = new Logger(GoogleCalendarClient.name);
  private readonly credentials: { client_email: string; private_key: string } | null;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(config: ConfigService) {
    this.credentials = this.parse(config.get<string>('GOOGLE_CALENDAR_CREDENTIALS'));
  }

  get enabled(): boolean {
    return this.credentials !== null;
  }

  private parse(raw?: string) {
    if (!raw?.trim()) return null;
    try {
      const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
      const json = JSON.parse(text);
      if (!json.client_email || !json.private_key) throw new Error('faltan client_email o private_key');
      return json;
    } catch (err) {
      this.logger.error(`GOOGLE_CALENDAR_CREDENTIALS no es valida: ${(err as Error).message}`);
      return null;
    }
  }

  private async accessToken(): Promise<string> {
    if (!this.credentials) throw new Error('Google Calendar no está configurado');
    if (this.token && this.token.expiresAt > Date.now() + 60_000) return this.token.value;

    const now = Math.floor(Date.now() / 1000);
    const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({
      iss: this.credentials.client_email,
      scope: 'https://www.googleapis.com/auth/calendar',
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })}`;
    const signature = createSign('RSA-SHA256').update(unsigned).sign(this.credentials.private_key, 'base64url');
    const { data } = await axios.post(
      TOKEN_URL,
      new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${signature}` }).toString(),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 15_000 },
    );
    this.token = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
    return this.token.value;
  }

  private async call<T = any>(method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown): Promise<T> {
    const { data } = await axios.request<T>({
      method,
      url: `${API}${path}`,
      data: body,
      headers: { Authorization: `Bearer ${await this.accessToken()}` },
      timeout: 15_000,
    });
    return data;
  }

  async createCalendar(name: string, timeZone: string): Promise<string> {
    const calendar = await this.call<{ id: string }>('POST', '/calendars', { summary: name, timeZone });
    return calendar.id;
  }

  /**
   * Borra el calendario con sus eventos, y no vuelve hasta que Google lo confirma.
   *
   * Google borra despues de contestar, y de dos formas distintas (medido):
   *  - si el calendario esta compartido, contesta que lo borro pero lo deja vivo varios
   *    minutos, vacio y aceptando eventos nuevos;
   *  - sin accesos lo elimina en pocos segundos, durante los cuales a veces todavia
   *    contesta que existe.
   * Por eso primero se le quitan los accesos (quien lo veia deja de verlo en el acto),
   * despues se borra, y se espera a que conteste dos veces seguidas que ya no existe: es
   * la unica forma de poder decir "se borro" cuando una empresa se va.
   */
  async deleteCalendar(calendarId: string) {
    const base = `/calendars/${encodeURIComponent(calendarId)}`;
    const isGone = (err: unknown) => googleStatus(err) === 404 || googleStatus(err) === 410;
    try {
      const acl = await this.call<{ items?: { id: string; role: string }[] }>('GET', `${base}/acl`);
      for (const rule of acl.items ?? []) {
        if (rule.role !== 'owner') await this.call('DELETE', `${base}/acl/${encodeURIComponent(rule.id)}`);
      }
      await this.call('DELETE', base);
    } catch (err) {
      if (!isGone(err)) throw err;
    }

    let gone = 0;
    for (let attempt = 0; attempt < 10 && gone < 2; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      try {
        await this.call('GET', base);
        gone = 0;
      } catch (err) {
        if (!isGone(err)) throw err;
        gone++;
      }
    }
    if (gone < 2) throw new Error('Google todavía no eliminó el calendario');
  }

  /** Lo comparte para ver, y Google le manda al doctor el correo con el enlace para agregarlo. */
  async share(calendarId: string, email: string) {
    await this.call('POST', `/calendars/${encodeURIComponent(calendarId)}/acl?sendNotifications=true`, {
      role: 'reader',
      scope: { type: 'user', value: email },
    });
  }

  async unshare(calendarId: string, email: string) {
    await this.ignoreMissing(
      this.call('DELETE', `/calendars/${encodeURIComponent(calendarId)}/acl/${encodeURIComponent(`user:${email}`)}`),
    );
  }

  /**
   * Escribe la cita en el calendario, exista o no. El id del evento lo pone Connect (sale
   * del id de la cita), asi que escribir dos veces la misma cita deja un solo evento.
   */
  async upsertEvent(calendarId: string, eventId: string, event: GoogleEvent) {
    const base = `/calendars/${encodeURIComponent(calendarId)}/events`;
    const body = {
      summary: event.summary,
      location: event.location,
      description: event.description ?? '',
      start: { dateTime: event.startsAt.toISOString() },
      end: { dateTime: event.endsAt.toISOString() },
      colorId: event.colorId,
      // Un evento borrado sigue existiendo como "cancelled": esto lo trae de vuelta.
      status: 'confirmed',
    };
    try {
      await this.call('PUT', `${base}/${eventId}`, body);
    } catch (err) {
      if (googleStatus(err) !== 404) throw err;
      try {
        await this.call('POST', base, { id: eventId, ...body });
      } catch (insertErr) {
        // 409: otro proceso lo creo entre el PUT y el POST.
        if (googleStatus(insertErr) !== 409) throw insertErr;
        await this.call('PUT', `${base}/${eventId}`, body);
      }
    }
  }

  async deleteEvent(calendarId: string, eventId: string) {
    await this.ignoreMissing(this.call('DELETE', `/calendars/${encodeURIComponent(calendarId)}/events/${eventId}`));
  }

  /** Borrar algo que ya no esta (404) o ya estaba borrado (410) es haber terminado. */
  private async ignoreMissing(request: Promise<unknown>) {
    try {
      await request;
    } catch (err) {
      const status = googleStatus(err);
      if (status !== 404 && status !== 410) throw err;
    }
  }
}
