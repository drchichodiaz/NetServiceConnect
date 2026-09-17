import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';

export const PASSWORD_MIN_LENGTH = 8;

/**
 * Las que la gente elige cuando no quiere pensar. No pretende ser exhaustiva — para eso
 * haria falta una lista de millones y consultarla en cada alta; esto ataja el caso real
 * que reporto el cliente ("123456") y sus primos cercanos, que es el 99% de lo que
 * aparece en la practica. La comparacion es en minusculas, asi que "Password" tambien cae.
 */
const COMUNES = new Set([
  '12345678', '123456789', '1234567890', '123456', '1234567', '87654321',
  'password', 'password1', 'password123', 'passw0rd', 'contrasena', 'contrasena1',
  'qwerty', 'qwerty123', 'qwertyui', 'asdfghjkl', 'zxcvbnm', 'abc12345', 'abcd1234',
  'iloveyou', 'admin123', 'administrador', 'usuario1', 'bienvenido', 'bienvenido1',
  'whatsapp', 'whatsapp1', 'netservice', 'netservice1', 'letmein', 'welcome1',
]);

/** Todo el mismo caracter: "aaaaaaaa", "00000000". */
function esUnSoloCaracter(v: string) {
  return new Set(v).size === 1;
}

/**
 * Corridas del teclado o del abecedario, en cualquier direccion: "12345678", "abcdefgh",
 * "87654321". Se mira el string entero: alcanza con que haya UN caracter fuera de la
 * secuencia para que deje de contar como tal.
 */
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

/**
 * Los datos del propio usuario no sirven de contrasena: quien lo conoce los prueba
 * primero. Solo aplica donde el DTO los trae al lado (alta y registro); en el cambio de
 * contrasena y el reset no viajan, y ahi este control simplemente no corre.
 */
function contieneDatosPropios(v: string, obj: any): boolean {
  const candidatos = [obj?.email, obj?.adminEmail, obj?.name, obj?.adminName]
    .filter((c): c is string => typeof c === 'string' && c.length > 0)
    // Del email interesa lo de antes de la arroba, y del nombre cada palabra suelta.
    .flatMap((c) => [c, c.split('@')[0], ...c.split(/[\s.@_-]+/)])
    .map((c) => c.toLowerCase())
    .filter((c) => c.length >= 4);

  return candidatos.some((c) => v.includes(c));
}

/**
 * Muy pocos caracteres distintos: "aaaaaaaa1", "abab1212". Pasan la regla de letras y
 * numeros al pie de la letra pero son exactamente lo que el cliente pidio atajar. Cinco
 * distintos deja entrar cosas normales ("Panama22" tiene 5) y frena las repetitivas.
 */
function tieneMuyPocaVariedad(v: string) {
  return new Set(v).size < 5;
}

export function evaluarPassword(valor: unknown, obj: any = {}): string | null {
  if (typeof valor !== 'string') return 'La contraseña es obligatoria.';

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
  if (contieneDatosPropios(bajo, obj)) {
    return 'La contraseña no puede contener tu nombre ni tu email.';
  }
  return null;
}

/**
 * Regla unica para toda contrasena NUEVA, en los seis lugares donde se fija una: registro,
 * alta de empresa, alta de usuario, cambio hecho por un admin, autogestion y reset por mail.
 *
 * Deliberadamente NO se usa en el login: ahi se valida una contrasena que ya existe, y
 * exigirle la regla nueva dejaria afuera a todos los que tienen una vieja y debil. La
 * politica rige de aca en adelante; a nadie se le invalida la que ya venia usando.
 */
export function IsStrongPassword(options?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isStrongPassword',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate: (value: unknown, args: ValidationArguments) =>
          evaluarPassword(value, args.object) === null,
        defaultMessage: (args: ValidationArguments) =>
          evaluarPassword(args.value, args.object) ?? 'Contraseña inválida.',
      },
    });
  };
}
