/**
 * Formatea una cantidad de creditos para un texto en español: 5000 -> "5.000".
 *
 * No se usa toLocaleString: depende de los datos de idioma que traiga el Node del
 * servidor, y en el contenedor devuelve el numero pelado. En pantalla no se nota
 * porque ahi formatea el navegador, pero en un correo al cliente si.
 */
export function formatCredits(n: number): string {
  const sign = n < 0 ? '-' : '';
  return sign + Math.abs(Math.trunc(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
