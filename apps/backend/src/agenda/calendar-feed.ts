/**
 * El calendario de un doctor en formato iCalendar (RFC 5545), para suscribirse desde
 * Google Calendar, el iPhone u Outlook. Sin librerias: son pocas reglas y todas estan aca.
 *
 * Las horas van en UTC ("...Z") y no en hora local con VTIMEZONE: cada telefono las pasa
 * a su propia zona, y asi no hay que describirle al calendario las reglas de cada pais.
 */

export interface FeedEvent {
  id: string;
  startsAt: Date;
  endsAt: Date;
  updatedAt: Date;
  summary: string;
  location: string;
  description: string | null;
}

/** Cada cuanto se le sugiere al calendario volver a leer. Google lo ignora y tarda horas. */
const REFRESH = 'PT15M';

export function buildCalendar(name: string, timeZone: string, events: FeedEvent[]): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//NetService Connect//Agenda//ES',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeText(name)}`,
    `X-WR-TIMEZONE:${timeZone}`,
    `REFRESH-INTERVAL;VALUE=DURATION:${REFRESH}`,
    `X-PUBLISHED-TTL:${REFRESH}`,
  ];
  for (const e of events) {
    lines.push(
      'BEGIN:VEVENT',
      // El id de la cita, estable: si se mueve, el calendario mueve el mismo evento en
      // vez de crear otro.
      `UID:${e.id}@netservice-connect`,
      `DTSTAMP:${utcStamp(e.updatedAt)}`,
      `LAST-MODIFIED:${utcStamp(e.updatedAt)}`,
      `DTSTART:${utcStamp(e.startsAt)}`,
      `DTEND:${utcStamp(e.endsAt)}`,
      `SUMMARY:${escapeText(e.summary)}`,
      `LOCATION:${escapeText(e.location)}`,
    );
    if (e.description) lines.push(`DESCRIPTION:${escapeText(e.description)}`);
    lines.push('STATUS:CONFIRMED', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

function utcStamp(instant: Date): string {
  return instant.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function escapeText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Una linea no puede pasar de 75 bytes: se corta y la continuacion empieza con un
 * espacio. Se cuenta en bytes y por caracter entero, para no partir una "ñ" al medio.
 */
function fold(line: string): string {
  if (Buffer.byteLength(line) <= 75) return line;
  const out: string[] = [];
  let current = '';
  let size = 0;
  for (const ch of line) {
    const bytes = Buffer.byteLength(ch);
    // Las continuaciones gastan un byte en el espacio inicial.
    if (size + bytes > (out.length === 0 ? 75 : 74)) {
      out.push(current);
      current = '';
      size = 0;
    }
    current += ch;
    size += bytes;
  }
  out.push(current);
  return out.join('\r\n ');
}
