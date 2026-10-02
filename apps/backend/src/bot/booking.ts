import { hourText, shortDayText } from '../agenda/agenda-text';
import { addDays, isValidDate, MINUTES_PER_DAY } from '../agenda/agenda-time';

/**
 * Reserva de citas desde el bot (nodo BOOK_APPOINTMENT), y cambio o cancelacion de una
 * cita desde el boton "Reprogramar" del recordatorio o desde "Mis citas" (nodo
 * MY_APPOINTMENTS): las pantallas y los ids de sus filas y botones, sin base de datos.
 *
 * Cada fila lleva en su id todo lo que hace falta para seguir (`bk:ask:2026-10-03:570`
 * = "confirmar el viernes 3 a las 9:30"), en vez de guardarlo en botContext. Asi tocar
 * una lista vieja horas despues no depende de en que paso quedo la conversacion: se lee
 * el id y se vuelve a validar contra la agenda de ese momento.
 */

export type BookingView =
  /** Lista de dias con lugar, desde el dia numero `offset` de esa lista. */
  | { kind: 'days'; offset: number }
  /** Eligio un dia: sus horarios, o primero "mañana o tarde" si son muchos. */
  | { kind: 'day'; date: string }
  /** Los horarios del dia que empiezan en [from, to). */
  | { kind: 'times'; date: string; from: number; to: number }
  /** "¿Confirmo?" para ese horario. */
  | { kind: 'ask'; date: string; minute: number }
  /** Confirmo: se reserva. */
  | { kind: 'book'; date: string; minute: number }
  /** Volver al menu del que colgaba la opcion. */
  | { kind: 'menu' }
  // ─── Cambiar o cancelar una cita que ya existe (botContext.bookingAppointmentId) ───
  /** "Tu cita es el... ¿Qué quieres hacer?": cambiar horario, cancelar o dejarla. */
  | { kind: 'manage' }
  /** "¿Seguro que quieres cancelar tu cita?" */
  | { kind: 'cancel' }
  /** Si, cancelarla. */
  | { kind: 'cancelOk' }
  /** Dejarla como esta. */
  | { kind: 'keep' }
  /** Que lo atienda alguien de la clinica. */
  | { kind: 'human' }
  // ─── "Mis citas" ───
  /** Las proximas citas del paciente en la clinica. */
  | { kind: 'mine' }
  /** Eligio una de sus citas. */
  | { kind: 'pick'; appointmentId: string }
  /** No tiene citas y quiere reservar una (con el nodo "Agendar cita" del bot). */
  | { kind: 'new' };

/** Lo que hace algo en vez de mostrar una pantalla. Solo vale en el paso en que se ofrecio. */
export type BookingAction = Extract<BookingView, { kind: 'book' | 'cancelOk' | 'keep' | 'human' }>;

/**
 * Lo que es una pantalla (se muestra y se puede volver a mostrar): todo menos las
 * acciones, salir, y los pasos que cambian de camino (elegir una cita, empezar a reservar).
 */
export type BookingScreen = Exclude<BookingView, BookingAction | { kind: 'menu' | 'pick' | 'new' }>;

const ACTIONS = new Set(['book', 'cancelOk', 'keep', 'human']);

export function isAction(view: BookingView): view is BookingAction {
  return ACTIONS.has(view.kind);
}

export interface Row {
  id: string;
  title: string;
  description?: string;
}

/** Dias por pagina: deja dos filas de las 10 de WhatsApp para "Más días" y "‹ Volver". */
export const DAYS_PER_PAGE = 8;
/** Horarios que entran en una lista junto con "Otro día". */
const TIMES_IN_FULL_LIST = 9;
/** Si son mas, la lista muestra estos y "Más horarios". */
const TIMES_PER_PAGE = 8;
export const NOON = 12 * 60;

export function viewId(v: BookingView): string {
  switch (v.kind) {
    case 'days':
      return `bk:days:${v.offset}`;
    case 'day':
      return `bk:day:${v.date}`;
    case 'times':
      return `bk:t:${v.date}:${v.from}:${v.to}`;
    case 'ask':
      return `bk:ask:${v.date}:${v.minute}`;
    case 'book':
      return `bk:ok:${v.date}:${v.minute}`;
    case 'menu':
      return 'bk:menu';
    case 'manage':
      return 'bk:manage';
    case 'cancel':
      return 'bk:cancel';
    case 'cancelOk':
      return 'bk:cancelok';
    case 'keep':
      return 'bk:keep';
    case 'human':
      return 'bk:human';
    case 'mine':
      return 'bk:mine';
    case 'pick':
      return `bk:pick:${v.appointmentId}`;
    case 'new':
      return 'bk:new';
  }
}

function minuteOf(raw: string | undefined, max = MINUTES_PER_DAY): number | null {
  if (!raw || !/^\d{1,4}$/.test(raw)) return null;
  const n = Number(raw);
  return n <= max ? n : null;
}

/** Lo inverso de viewId. Null si el id no es de la reserva o vino roto. */
export function parseViewId(id: string | undefined): BookingView | null {
  if (!id?.startsWith('bk:')) return null;
  const [, kind, a, b, c] = id.split(':');
  if (kind === 'menu') return { kind: 'menu' };
  if (kind === 'manage') return { kind: 'manage' };
  if (kind === 'cancel') return { kind: 'cancel' };
  if (kind === 'cancelok') return { kind: 'cancelOk' };
  if (kind === 'keep') return { kind: 'keep' };
  if (kind === 'human') return { kind: 'human' };
  if (kind === 'mine') return { kind: 'mine' };
  if (kind === 'new') return { kind: 'new' };
  if (kind === 'pick') return a && /^[a-z0-9]{10,40}$/.test(a) ? { kind: 'pick', appointmentId: a } : null;
  if (kind === 'days') {
    const offset = minuteOf(a, 1000);
    return offset === null ? null : { kind: 'days', offset };
  }
  if (!a || !isValidDate(a)) return null;
  if (kind === 'day') return { kind: 'day', date: a };
  if (kind === 't') {
    const from = minuteOf(b);
    const to = minuteOf(c);
    return from === null || to === null || from >= to ? null : { kind: 'times', date: a, from, to };
  }
  const minute = minuteOf(b, MINUTES_PER_DAY - 1);
  if (minute === null) return null;
  if (kind === 'ask') return { kind: 'ask', date: a, minute };
  if (kind === 'ok') return { kind: 'book', date: a, minute };
  return null;
}

function countText(n: number) {
  return n === 1 ? '1 horario' : `${n} horarios`;
}

/** "Hoy, mié 1 oct", "Mañana, jue 2 oct", "Vie 3 oct". */
export function dayTitle(date: string, today: string) {
  const short = shortDayText(date);
  if (date === today) return `Hoy, ${short}`;
  if (date === addDays(today, 1)) return `Mañana, ${short}`;
  return short.charAt(0).toUpperCase() + short.slice(1);
}

/**
 * Una pagina de la lista de dias, con "Más días" si quedan y al final la salida: "‹ Volver"
 * al menu al reservar, o lo que corresponda al cambiar una cita que ya existe.
 */
export function dayRows(
  days: { date: string; starts: number[] }[],
  today: string,
  offset: number,
  exit: Row = { id: viewId({ kind: 'menu' }), title: '‹ Volver' },
): Row[] {
  const page = days.slice(offset, offset + DAYS_PER_PAGE);
  const rows: Row[] = page.map((d) => ({
    id: viewId({ kind: 'day', date: d.date }),
    title: dayTitle(d.date, today),
    description: countText(d.starts.length),
  }));
  if (offset + DAYS_PER_PAGE < days.length) rows.push({ id: viewId({ kind: 'days', offset: offset + DAYS_PER_PAGE }), title: 'Más días' });
  rows.push(exit);
  return rows;
}

/**
 * Los horarios de [from, to) de un dia, con "Más horarios" si no entran y siempre
 * "Otro día". `starts` son todos los del dia, ordenados.
 */
export function timeRows(date: string, starts: number[], from: number, to: number): Row[] {
  const inRange = starts.filter((s) => s >= from && s < to);
  const fits = inRange.length <= TIMES_IN_FULL_LIST;
  const shown = fits ? inRange : inRange.slice(0, TIMES_PER_PAGE);
  const rows: Row[] = shown.map((minute) => ({ id: viewId({ kind: 'ask', date, minute }), title: hourText(minute) }));
  if (!fits) rows.push({ id: viewId({ kind: 'times', date, from: inRange[TIMES_PER_PAGE], to }), title: 'Más horarios' });
  rows.push({ id: viewId({ kind: 'days', offset: 0 }), title: 'Otro día' });
  return rows;
}

/** Si el dia tiene mas horarios de los que entran en una lista, se pregunta primero mañana o tarde. */
export function needsDayPart(starts: number[]) {
  return starts.length > TIMES_IN_FULL_LIST && starts.some((s) => s < NOON) && starts.some((s) => s >= NOON);
}

/** La ultima pantalla guardada en botContext, para volver a mostrarla. */
export function parseScreenId(id: string | null): BookingScreen | null {
  const view = parseViewId(id ?? undefined);
  if (!view || isAction(view) || view.kind === 'menu' || view.kind === 'pick' || view.kind === 'new') return null;
  return view;
}

/** "Vie 3 oct, 9:30 a.m.": una cita como fila de lista (hasta 22 caracteres). */
export function appointmentTitle(date: string, minute: number) {
  const short = shortDayText(date);
  return `${short.charAt(0).toUpperCase() + short.slice(1)}, ${hourText(minute)}`;
}
