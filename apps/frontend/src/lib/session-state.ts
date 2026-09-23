/**
 * Estado del cliente que pertenece a una sesion y no a la pestaña.
 *
 * El frontend guarda cosas fuera de React —cachés a nivel de módulo, stores de
 * zustand— que sobreviven a un logout y a un login: entrar es `router.replace`, no
 * una recarga. Sin limpiarlas, el que entra despues ve datos del que estuvo antes en
 * esa pestaña; si ademas es otra empresa, ve datos de otra empresa.
 *
 * Cada modulo con estado de ese tipo se registra aca con como vaciarse, y el store de
 * auth dispara `resetSessionState()` al entrar y al salir. Es un registro y no una
 * lista de imports para que este archivo no dependa de nadie: un modulo que nunca se
 * cargo no tiene nada guardado, asi que no registrarse a tiempo no puede dejar basura.
 */

type Reset = () => void;

const resets = new Set<Reset>();

/** Registra como vaciar el estado de este modulo. Devuelve como desregistrarlo. */
export function onSessionReset(reset: Reset): () => void {
  resets.add(reset);
  return () => { resets.delete(reset); };
}

/** Vacia todo lo registrado. Un modulo que falle no puede impedir que limpien los demas. */
export function resetSessionState() {
  resets.forEach((reset) => {
    try { reset(); } catch { /* limpiar es lo ultimo que puede romper un login */ }
  });
}
