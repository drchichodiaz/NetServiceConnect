/**
 * La misma regla que aplica el backend en `is-strong-password.validator.ts`, repetida
 * aca a proposito: el servidor es el que manda y siempre revalida, pero sin esto la
 * persona se entera del problema recien al recibir un 400, con el formulario ya enviado.
 * Si se cambia la politica, hay que tocar los dos lados.
 */

export const PASSWORD_MIN_LENGTH = 8;

/** Texto corto para poner debajo del campo, antes de que la persona escriba nada. */
export const PASSWORD_HINT = `Mínimo ${PASSWORD_MIN_LENGTH} caracteres, con letras y números.`;

const COMUNES = new Set([
  '12345678', '123456789', '1234567890', '123456', '1234567', '87654321',
  'password', 'password1', 'password123', 'passw0rd', 'contrasena', 'contrasena1',
  'qwerty', 'qwerty123', 'qwertyui', 'asdfghjkl', 'zxcvbnm', 'abc12345', 'abcd1234',
  'iloveyou', 'admin123', 'administrador', 'usuario1', 'bienvenido', 'bienvenido1',
  'whatsapp', 'whatsapp1', 'netservice', 'netservice1', 'letmein', 'welcome1',
]);

function esUnSoloCaracter(v: string) {
  return new Set(v).size === 1;
}

function esSecuencia(v: string) {
  let sube = true;
  let baja = true;
  for (let i = 1; i < v.length; i++) {
    const delta = v.charCodeAt(i) - v.charCodeAt(i - 1);
    if (delta !== 1) sube = false;
    if (delta !== -1) baja = false;
  }
  return sube || baja;
}

function contieneDatosPropios(v: string, datos: (string | undefined)[]) {
  const candidatos = datos
    .filter((c): c is string => typeof c === 'string' && c.length > 0)
    .flatMap((c) => [c, c.split('@')[0], ...c.split(/[\s.@_-]+/)])
    .map((c) => c.toLowerCase())
    .filter((c) => c.length >= 4);

  return candidatos.some((c) => v.includes(c));
}

/**
 * Devuelve el problema en castellano, o null si la contrasena sirve.
 * `datosPropios` son el nombre y el email de la persona, cuando la pantalla los tiene
 * a mano; sin ellos ese control no corre, igual que en el backend.
 */
/**
 * Muy pocos caracteres distintos: "aaaaaaaa1", "abab1212". Pasan la regla de letras y
 * numeros al pie de la letra pero son exactamente lo que el cliente pidio atajar. Cinco
 * distintos deja entrar cosas normales ("Panama22" tiene 5) y frena las repetitivas.
 */
function tieneMuyPocaVariedad(v: string) {
  return new Set(v).size < 5;
}

export function validarPassword(valor: string, datosPropios: (string | undefined)[] = []): string | null {
  if (valor.length < PASSWORD_MIN_LENGTH) {
    return `La contraseña debe tener al menos ${PASSWORD_MIN_LENGTH} caracteres.`;
  }
  if (!/[a-zA-Z]/.test(valor) || !/[0-9]/.test(valor)) {
    return 'La contraseña debe combinar letras y números.';
  }

  const bajo = valor.toLowerCase();
  if (COMUNES.has(bajo) || esUnSoloCaracter(bajo) || esSecuencia(bajo) || tieneMuyPocaVariedad(bajo)) {
    return 'Esa contraseña es demasiado fácil de adivinar. Usa una menos obvia.';
  }
  if (contieneDatosPropios(bajo, datosPropios)) {
    return 'La contraseña no puede contener tu nombre ni tu email.';
  }
  return null;
}
