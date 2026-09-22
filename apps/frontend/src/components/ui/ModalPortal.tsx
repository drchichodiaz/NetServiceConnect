'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Monta un modal al final de <body>, fuera del árbol donde se lo escribió.
 *
 * Un overlay `fixed inset-0` se mide contra la ventana **salvo** que algún ancestro
 * tenga `transform`, `filter` o `perspective`: ese ancestro pasa a ser su bloque
 * contenedor y el modal queda encerrado ahí adentro. Varias pantallas envuelven todo en
 * `animate-fade-in`, que termina en `transform: translateY(0)` con fill-mode `both`, o
 * sea que el transform sigue aplicado para siempre después de la animación. El síntoma
 * es confuso porque no parece un problema de posición: el modal se ve chico, el fondo
 * negro tapa solo la columna de contenido y aparece un scroll de más.
 *
 * Sacándolo a <body> el modal deja de depender de dónde se lo monte.
 *
 * Mientras hay alguno abierto se bloquea el scroll de la página: el overlay ya trae su
 * propio scroll y tener los dos a la vez es lo que hace que la rueda del mouse mueva la
 * pantalla de atrás en vez del formulario.
 */

/** Cuántos modales hay abiertos: el último en cerrarse devuelve el scroll. */
let openCount = 0;

export default function ModalPortal({ children }: { children: React.ReactNode }) {
  // En el primer render del servidor no hay document. Se monta después, así que el
  // modal aparece siempre del lado del cliente.
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);

    const previous = document.body.style.overflow;
    openCount += 1;
    document.body.style.overflow = 'hidden';

    return () => {
      openCount -= 1;
      if (openCount === 0) document.body.style.overflow = previous;
    };
  }, []);

  if (!mounted) return null;
  return createPortal(children, document.body);
}
