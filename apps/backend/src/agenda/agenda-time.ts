/**
 * Conversiones entre la hora de reloj de una clinica y los instantes de la base.
 *
 * Los turnos y las excepciones se guardan como "minuto del dia" en hora local de la
 * empresa (Tenant.timezone), y las citas como instantes UTC. Todo el paso de uno a
 * otro vive aca, y sin librerias: Intl ya sabe las reglas de cada zona.
 *
 * Una "fecha" es siempre un string YYYY-MM-DD del dia LOCAL de la clinica. Nunca un
 * Date: un Date es un instante, y "el martes 21" empieza en instantes distintos en
 * Guatemala y en Panama.
 */

export const MINUTES_PER_DAY = 24 * 60;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    formatterFor(timeZone);
    return true;
  } catch {
    return false;
  }
}

export function isValidDate(date: string): boolean {
  if (!DATE_RE.test(date)) return false;
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** Fecha y minuto del dia de un instante, en la hora local de la zona. */
export function toLocal(instant: Date, timeZone: string): { date: string; minute: number } {
  const parts: Record<string, string> = {};
  for (const p of formatterFor(timeZone).formatToParts(instant)) parts[p.type] = p.value;
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minute: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

/** Cuantos minutos esta la hora local por delante de UTC en ese instante (Guatemala: -360). */
function offsetMinutes(instant: Date, timeZone: string): number {
  const parts: Record<string, string> = {};
  for (const p of formatterFor(timeZone).formatToParts(instant)) parts[p.type] = p.value;
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/**
 * El instante en que en la zona son `minute` minutos del dia `date`. Acepta 1440 (la
 * medianoche siguiente), que es como se expresa el fin de un dia.
 *
 * Se corrige el desfase dos veces porque, en zonas con horario de verano, el desfase
 * de la medianoche puede no ser el de la hora pedida. Guatemala y Panama no cambian de
 * hora, pero la agenda no tiene por que saberlo.
 */
export function fromLocal(date: string, minute: number, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d, 0, minute);
  const first = offsetMinutes(new Date(wall), timeZone);
  let result = wall - first * 60000;
  const second = offsetMinutes(new Date(result), timeZone);
  if (second !== first) result = wall - second * 60000;
  return new Date(result);
}

/** 0 = domingo ... 6 = sabado, igual que DoctorShift.weekday. */
export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** La fecha `days` dias despues (o antes, si es negativo). */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Como se guarda una fecha en una columna @db.Date: la medianoche UTC de ese dia. */
export function dateColumn(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

/** Lo inverso de dateColumn. */
export function fromDateColumn(value: Date): string {
  return value.toISOString().slice(0, 10);
}
