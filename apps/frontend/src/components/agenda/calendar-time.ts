import { dateFnsLocalizer } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay } from 'date-fns';
import { es } from 'date-fns/locale';
import { fromLocal, toLocal } from '@/lib/agenda';

/**
 * react-big-calendar trabaja con Date en la zona del NAVEGADOR, y la agenda tiene que
 * mostrarse en la hora de la CLINICA (un super admin en Panama mira Guatemala). En vez de
 * sumar una libreria de zonas, al calendario se le pasa la "hora de reloj": un Date del
 * navegador que marca la misma hora que marca el reloj de la clinica. Al volver (un
 * clic, un arrastre) se hace la cuenta al reves con la zona de verdad.
 */

export const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (d: Date) => startOfWeek(d, { weekStartsOn: 1 }),
  getDay,
  locales: { es },
});

/** Instante real → Date con la misma hora de reloj que la clinica. */
export function toWall(instant: string | Date, timeZone: string): Date {
  const { date, minute } = toLocal(instant, timeZone);
  return wallAt(date, minute);
}

/** "2026-09-24" + 570 → Date del navegador a las 9:30 de ese dia. */
export function wallAt(date: string, minute: number): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d, Math.floor(minute / 60), minute % 60);
}

/** Lo inverso: la fecha y el minuto de reloj que marca un Date del calendario. */
export function wallParts(d: Date): { date: string; minute: number } {
  const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { date, minute: d.getHours() * 60 + d.getMinutes() };
}

/** Date del calendario → instante ISO real en la zona de la clinica. */
export function fromWall(d: Date, timeZone: string): string {
  const { date, minute } = wallParts(d);
  return fromLocal(date, minute, timeZone);
}
