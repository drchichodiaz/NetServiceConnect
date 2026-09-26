import { useCallback, useEffect, useMemo, useState } from 'react';

type Move = { start: Date; end: Date; resourceId?: string; pending: boolean };

/**
 * Al soltar una cita, se muestra en su lugar nuevo EN EL ACTO y el servidor confirma
 * por detras. Antes la cita volvia a su lugar original mientras esperaba la respuesta
 * (en un server lento, uno o dos segundos) y recien despues saltaba: se sentia como que
 * el arrastre no habia agarrado.
 *
 * Si el servidor rechaza el cambio (doctor ocupado, fuera de turno) se deshace y la
 * cita vuelve a su lugar. Cuando llegan los datos nuevos del servidor (`dataKey`
 * cambia), los movimientos ya confirmados se descartan porque los datos ya los traen;
 * los que siguen esperando respuesta se mantienen, para que una recarga que llega en el
 * medio no la haga saltar para atras.
 */
export function useOptimisticMoves<T extends { id: string; start: Date; end: Date; resourceId?: string }>(events: T[], dataKey: unknown) {
  const [moves, setMoves] = useState<Record<string, Move>>({});

  useEffect(() => {
    setMoves((m) => {
      const kept = Object.entries(m).filter(([, v]) => v.pending);
      return kept.length === Object.keys(m).length ? m : Object.fromEntries(kept);
    });
  }, [dataKey]);

  const shown = useMemo(
    () =>
      events.map((e) => {
        const mv = moves[e.id];
        return mv ? { ...e, start: mv.start, end: mv.end, ...(mv.resourceId && { resourceId: mv.resourceId }) } : e;
      }),
    [events, moves],
  );

  const begin = useCallback((id: string, start: Date, end: Date, resourceId?: string) => {
    setMoves((m) => ({ ...m, [id]: { start, end, resourceId, pending: true } }));
  }, []);
  const confirm = useCallback((id: string) => {
    setMoves((m) => (m[id] ? { ...m, [id]: { ...m[id], pending: false } } : m));
  }, []);
  const undo = useCallback((id: string) => {
    setMoves((m) => {
      const { [id]: _, ...rest } = m;
      return rest;
    });
  }, []);

  return { shown, begin, confirm, undo };
}
