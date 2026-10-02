/**
 * El calculo de disponibilidad, sin base de datos: recibe turnos, excepciones y citas
 * de un dia y devuelve en que horario esta cada doctor y cuando esta libre. Separado
 * del servicio para poder razonarlo (y probarlo) sin armar filas.
 *
 * Todos los horarios son minutos del dia local, en intervalos [inicio, fin).
 */

export interface Interval {
  start: number;
  end: number;
}

/** Un tramo del dia en que el doctor atiende en una clinica. */
export interface WorkWindow extends Interval {
  channelAccountId: string;
}

export interface ShiftLike {
  weekday: number;
  startMinute: number;
  endMinute: number;
  channelAccountId: string;
}

export interface ExceptionLike {
  kind: 'ABSENT' | 'WORKS_AT';
  startMinute: number | null;
  endMinute: number | null;
  channelAccountId: string | null;
}

/** Ordena y une los intervalos que se tocan o se pisan. */
export function mergeIntervals(intervals: Interval[]): Interval[] {
  const sorted = intervals.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ start: i.start, end: i.end });
  }
  return out;
}

/** Lo que queda de `base` despues de sacarle `cuts`. */
export function subtractIntervals<T extends Interval>(base: T[], cuts: Interval[]): T[] {
  const merged = mergeIntervals(cuts);
  const out: T[] = [];
  for (const b of base) {
    let pieces: T[] = [{ ...b }];
    for (const c of merged) {
      const next: T[] = [];
      for (const p of pieces) {
        if (c.end <= p.start || c.start >= p.end) {
          next.push(p);
          continue;
        }
        if (c.start > p.start) next.push({ ...p, end: c.start });
        if (c.end < p.end) next.push({ ...p, start: c.end });
      }
      pieces = next;
    }
    out.push(...pieces);
  }
  return out.sort((a, b) => a.start - b.start);
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/**
 * Donde y cuando atiende un doctor un dia dado.
 *
 * Si ese dia tiene algun WORKS_AT, esos reemplazan al turno semanal entero ("este
 * jueves va a Zona 5"); si no, vale el turno semanal de ese dia de la semana. Despues
 * se restan las ausencias. Una ausencia sin horario es el dia entero.
 */
export function doctorDayWindows(weekday: number, shifts: ShiftLike[], exceptions: ExceptionLike[]): WorkWindow[] {
  const worksAt = exceptions.filter((e) => e.kind === 'WORKS_AT');
  const base: WorkWindow[] =
    worksAt.length > 0
      ? worksAt.map((e) => ({ channelAccountId: e.channelAccountId!, start: e.startMinute!, end: e.endMinute! }))
      : shifts
          .filter((s) => s.weekday === weekday)
          .map((s) => ({ channelAccountId: s.channelAccountId, start: s.startMinute, end: s.endMinute }));

  const absences: Interval[] = exceptions
    .filter((e) => e.kind === 'ABSENT')
    .map((e) => (e.startMinute === null ? { start: 0, end: 24 * 60 } : { start: e.startMinute, end: e.endMinute! }));

  return subtractIntervals(base, absences);
}

/** Si [start, end) entra entero en alguno de los tramos. */
export function fitsInside(windows: Interval[], slot: Interval): boolean {
  return windows.some((w) => w.start <= slot.start && slot.end <= w.end);
}

/**
 * Los horarios en que se puede empezar una cita de `minutes`, uniendo los de todos los
 * doctores: lo que se le ofrece al paciente que reserva solo, que no elige doctor.
 *
 * Por doctor se toma lo que le queda libre (tramos menos citas) y se recorre cada hueco
 * de a una cita desde su comienzo: 08:00, 08:45, 09:30... Asi la lista es corta y una
 * cita nueva queda pegada a la anterior, sin dejar huecos de 15 minutos que nadie puede
 * usar. `earliest` corta lo que empieza antes (la anticipacion minima de hoy).
 */
export function freeStarts(doctors: { windows: Interval[]; busy: Interval[] }[], minutes: number, earliest = 0): number[] {
  const starts = new Set<number>();
  for (const d of doctors) {
    for (const gap of subtractIntervals(d.windows, d.busy)) {
      for (let s = gap.start; s + minutes <= gap.end; s += minutes) {
        if (s >= earliest) starts.add(s);
      }
    }
  }
  return [...starts].sort((a, b) => a - b);
}
