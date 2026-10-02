/**
 * Como se le escriben fechas, horas y la clinica al paciente. Lo usan los avisos por
 * plantilla y el bot que reserva, para que digan lo mismo de la misma forma.
 */

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

function parts(date: string) {
  const [y, m, d] = date.split('-').map(Number);
  return { m, d, weekday: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

/**
 * "viernes 2 de octubre", de una fecha YYYY-MM-DD local. Armado a mano:
 * toLocaleDateString pone "viernes, 2 de octubre", y esa coma queda rara en medio de una
 * oracion.
 */
export function dayText(date: string) {
  const { m, d, weekday } = parts(date);
  return `${WEEKDAYS[weekday]} ${d} de ${MONTHS[m - 1]}`;
}

/** "vie 2 oct": para una fila de lista de WhatsApp, que corta el titulo a 24 caracteres. */
export function shortDayText(date: string) {
  const { m, d, weekday } = parts(date);
  return `${WEEKDAYS[weekday].slice(0, 3)} ${d} ${MONTHS[m - 1].slice(0, 3)}`;
}

/** "9:30 a.m.", como se escribe en Centroamerica, de un minuto del dia. */
export function hourText(minute: number) {
  const h = Math.floor(minute / 60);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(minute % 60).padStart(2, '0')} ${h < 12 ? 'a.m.' : 'p.m.'}`;
}

/** El nombre de la clinica para el paciente: el de la linea, que es la clinica. */
export function clinicName(line: { label?: string | null; displayName?: string | null; businessName?: string | null }) {
  return line.label?.trim() || line.displayName?.trim() || line.businessName?.trim() || 'la clínica';
}
