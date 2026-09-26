import { useEffect, useState } from 'react';
import { agendaApi } from '@/lib/api';
import type { AgendaSettings } from '@/lib/agenda';
import { onSessionReset } from '@/lib/session-state';

/**
 * La configuracion de la agenda de la empresa, compartida por el menu, la agenda y la
 * conversacion. Se pide una vez por sesion: la lee el menu en cada pantalla y no
 * cambia mientras se navega.
 *
 * Es de la empresa, asi que se vacia al entrar y al salir (ver session-state.ts). Si
 * la carga falla no se guarda nada: queda sin cargar y se reintenta en la proxima
 * pantalla, en vez de esconder la agenda para toda la sesion.
 */
let cache: AgendaSettings | null = null;
let pending: Promise<AgendaSettings> | null = null;
const listeners = new Set<(s: AgendaSettings | null) => void>();

onSessionReset(() => {
  cache = null;
  pending = null;
  listeners.forEach((l) => l(null));
});

function load(): Promise<AgendaSettings> {
  if (!pending) {
    pending = agendaApi
      .settings()
      .then((s) => {
        cache = s;
        listeners.forEach((l) => l(s));
        return s;
      })
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}

/** Para despues de cambiarla (pantalla de avisos). */
export function setAgendaSettingsCache(s: AgendaSettings) {
  cache = s;
  listeners.forEach((l) => l(s));
}

/** `enabled: false` mientras no se sepa: el menu no muestra la entrada hasta confirmarla. */
export function useAgendaSettings(active = true): AgendaSettings | null {
  const [settings, setSettings] = useState<AgendaSettings | null>(cache);

  useEffect(() => {
    listeners.add(setSettings);
    if (active && !cache) load().catch(() => {});
    else setSettings(cache);
    return () => {
      listeners.delete(setSettings);
    };
  }, [active]);

  return settings;
}
