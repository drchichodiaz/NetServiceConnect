/**
 * Tipos y cuentas de la agenda del lado del panel.
 *
 * Las horas de la agenda son hora de reloj de la CLINICA (la zona de la empresa), no la
 * del navegador: un super admin que mira la agenda de Guatemala desde Panama tiene que
 * ver 9:00 donde la recepcion ve 9:00. Por eso las conversiones usan la zona que manda
 * el backend y nunca `new Date().getHours()`.
 *
 * Es la misma logica que apps/backend/src/agenda/agenda-time.ts.
 */

export type AppointmentStatus = 'SCHEDULED' | 'CONFIRMED' | 'ARRIVED' | 'DONE' | 'NO_SHOW' | 'CANCELLED';

export interface AgendaSettings {
  enabled: boolean;
  slotMinutes: number;
  reminderHoursBefore: number;
  doctorSummaryHour: number;
  confirmationTemplateId: string | null;
  reminderTemplateId: string | null;
  doctorSummaryTemplateId: string | null;
  delayTemplateId: string | null;
  timezone: string;
}

export interface Shift {
  id?: string;
  weekday: number;
  startMinute: number;
  endMinute: number;
  channelAccountId: string;
}

export interface Doctor {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  isActive: boolean;
  shifts: Shift[];
}

export interface DoctorException {
  id: string;
  doctorId: string;
  date: string;
  kind: 'ABSENT' | 'WORKS_AT';
  startMinute: number | null;
  endMinute: number | null;
  channelAccountId: string | null;
  note: string | null;
  doctor: { id: string; code: string; name: string };
}

export interface Appointment {
  id: string;
  channelAccountId: string;
  doctorId: string;
  contactId: string;
  startsAt: string;
  endsAt: string;
  reason: string | null;
  notes: string | null;
  status: AppointmentStatus;
  confirmedAt: string | null;
  rescheduleRequestedAt: string | null;
  confirmationSentAt?: string | null;
  reminderSentAt?: string | null;
  /** Por que no se le pudo avisar al paciente la ultima vez. */
  notifyError?: string | null;
  contact: { id: string; name: string | null; phone: string | null };
  doctor?: { id: string; code: string; name: string };
  /** Solo en el dia de una clinica. */
  startMinute?: number;
  endMinute?: number;
}

export interface Interval {
  start: number;
  end: number;
}

export interface DayDoctor {
  id: string;
  code: string;
  name: string;
  windows: Interval[];
  busyElsewhere: Interval[];
}

export interface AgendaDay {
  date: string;
  timezone: string;
  slotMinutes: number;
  channelAccountId: string;
  doctors: DayDoctor[];
  appointments: Appointment[];
}

export interface MonthDay {
  date: string;
  appointments: number;
  availableMinutes: number;
  bookedMinutes: number;
  /** 0 a 1. Null = ese dia no atiende nadie en la clinica. */
  occupancy: number | null;
}

export interface MonthSummary {
  month: string;
  timezone: string;
  days: MonthDay[];
}

export interface FreeDoctor {
  id: string;
  code: string;
  name: string;
  appointmentsToday: number;
}

export const STATUS_LABEL: Record<AppointmentStatus, string> = {
  SCHEDULED: 'Agendada',
  CONFIRMED: 'Confirmada',
  ARRIVED: 'Llegó',
  DONE: 'Atendida',
  NO_SHOW: 'No vino',
  CANCELLED: 'Cancelada',
};

export const WEEKDAYS = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
/** Lunes primero, que es como se piensa una semana de trabajo. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];

// ─── Horas ────────────────────────────────────────────────────────────────────

/** 570 → "09:30". Acepta 1440 → "24:00" para el fin del dia. */
export function hhmm(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

/** 570 → "9:30 a.m.", como se escribe en Centroamerica. */
export function clock(minute: number): string {
  const h = Math.floor(minute / 60) % 24;
  const m = String(minute % 60).padStart(2, '0');
  const suffix = h < 12 ? 'a.m.' : 'p.m.';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${suffix}`;
}

/** "09:30" → 570. */
export function parseHhmm(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

/** Las opciones de un selector de hora, de a 15 minutos. */
export function quarterOptions(from = 0, to = 1440): number[] {
  const out: number[] = [];
  for (let m = from; m <= to; m += 15) out.push(m);
  return out;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timeZone: string) {
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

function parts(instant: Date, timeZone: string) {
  const out: Record<string, string> = {};
  for (const p of formatterFor(timeZone).formatToParts(instant)) out[p.type] = p.value;
  return out;
}

/** Fecha (YYYY-MM-DD) y minuto del dia de un instante, en la hora de la clinica. */
export function toLocal(instant: Date | string, timeZone: string): { date: string; minute: number } {
  const p = parts(typeof instant === 'string' ? new Date(instant) : instant, timeZone);
  return { date: `${p.year}-${p.month}-${p.day}`, minute: Number(p.hour) * 60 + Number(p.minute) };
}

function offsetMinutes(instant: Date, timeZone: string): number {
  const p = parts(instant, timeZone);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/** El instante (ISO) en que en la clinica son `minute` minutos del dia `date`. */
export function fromLocal(date: string, minute: number, timeZone: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const wall = Date.UTC(y, m - 1, d, 0, minute);
  const first = offsetMinutes(new Date(wall), timeZone);
  let result = wall - first * 60000;
  const second = offsetMinutes(new Date(result), timeZone);
  if (second !== first) result = wall - second * 60000;
  return new Date(result).toISOString();
}

export function todayIn(timeZone: string): string {
  return toLocal(new Date(), timeZone).date;
}

/**
 * El primer horario que todavia se puede dar: el proximo cuarto de hora de hoy, o las
 * 9:00 de mañana si hoy ya no queda nada razonable. Es lo que propone "Crear cita"
 * cuando no se abrio desde un horario de la grilla.
 */
export function nextBookable(timeZone: string): { date: string; minute: number } {
  const now = toLocal(new Date(), timeZone);
  const next = Math.ceil((now.minute + 1) / 15) * 15;
  if (next <= 20 * 60) return { date: now.date, minute: Math.max(next, 7 * 60) };
  return { date: addDays(now.date, 1), minute: 9 * 60 };
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** El lunes de la semana de esa fecha. */
export function mondayOf(date: string): string {
  const wd = weekdayOf(date);
  return addDays(date, wd === 0 ? -6 : 1 - wd);
}

/** El mismo dia `n` meses despues, recortado al ultimo dia si ese mes es mas corto. */
export function addMonths(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + n, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return target.toISOString().slice(0, 10);
}

/** "2026-09-22" → "22 – 28 de septiembre" (o "29 de septiembre – 5 de octubre"). */
export function weekLabel(monday: string): string {
  const sunday = addDays(monday, 6);
  const fmt = (date: string, withMonth: boolean) => {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('es', { day: 'numeric', ...(withMonth && { month: 'long' }), timeZone: 'UTC' });
  };
  const sameMonth = monday.slice(0, 7) === sunday.slice(0, 7);
  return `${fmt(monday, !sameMonth)} – ${fmt(sunday, true)}`;
}

/** "2026-09" → "Septiembre de 2026". */
export function monthLabel(date: string): string {
  const [y, m] = date.split('-').map(Number);
  const text = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('es', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function weekdayOf(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * "2030-01-07" → "Lunes 7 de enero". Solo la primera en mayuscula: con la clase
 * `capitalize` de CSS salia "7 De Enero", y en una hora "A.M.".
 */
export function longDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const text = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('es', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

export function patientLabel(contact: { name: string | null; phone: string | null }): string {
  return contact.name?.trim() || (contact.phone ? `+${contact.phone}` : 'Paciente sin nombre');
}
