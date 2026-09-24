import axios from 'axios';

/**
 * Lo que guarda un nodo LOCATION en TenantMenuNode.config.
 *
 * WhatsApp no acepta un link de Google Maps en un mensaje de ubicacion: pide latitud y
 * longitud. El admin pega el link (es lo que tiene a mano) y las coordenadas se sacan
 * de ahi al guardar, no cada vez que un cliente toca la opcion.
 */
export interface LocationConfig {
  mapsUrl?: string;
  latitude?: number;
  longitude?: number;
  /** Lo que WhatsApp muestra en negrita en la tarjeta. */
  name?: string;
  address?: string;
}

export type ResolveResult =
  | { ok: true; latitude: number; longitude: number; name: string | null; resolvedUrl: string }
  | { ok: false; error: string };

/** Hasta donde se siguen redirecciones de un link corto. Google usa una o dos. */
const MAX_HOPS = 5;
const TIMEOUT_MS = 6000;

/** Los links cortos del boton "Compartir" de Google Maps. */
const SHORT_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl']);
/** google.com, google.com.pa, maps.google.es... */
const GOOGLE_HOST = /(^|\.)google\.(com|[a-z]{2})(\.[a-z]{2})?$/i;

const NO_COORDS =
  'Ese link no trae la ubicación exacta. En Google Maps tocá el lugar, elegí "Compartir" y copiá el link, ' +
  'o escribí la latitud y la longitud a mano.';

function isAllowedHost(host: string): boolean {
  const h = host.toLowerCase();
  return SHORT_HOSTS.has(h) || GOOGLE_HOST.test(h);
}

function validPair(lat: number, lng: number): boolean {
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

/** Si las coordenadas sirven para mandar una ubicacion. */
export function hasValidCoordinates(config?: LocationConfig | null): config is LocationConfig & { latitude: number; longitude: number } {
  return typeof config?.latitude === 'number' && typeof config?.longitude === 'number' && validPair(config.latitude, config.longitude);
}

const PAIR = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*\+?\s*(-?\d{1,3}(?:\.\d+)?)/;

/**
 * Saca las coordenadas de un link largo de Google Maps, sin red.
 *
 * El orden importa: `!3d…!4d…` es el pin del lugar; `@lat,lng` es el centro de la
 * pantalla cuando se copio el link, que puede estar corrido unas cuadras. Por eso el
 * pin va primero y el centro queda como ultimo recurso.
 */
export function parseCoordinates(rawUrl: string): { latitude: number; longitude: number } | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }
  const full = decodeURIComponent(url.href);

  const pin = full.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (pin && validPair(+pin[1], +pin[2])) return { latitude: +pin[1], longitude: +pin[2] };

  for (const key of ['q', 'query', 'll', 'destination', 'daddr', 'center']) {
    const m = url.searchParams.get(key)?.match(PAIR);
    if (m && validPair(+m[1], +m[2])) return { latitude: +m[1], longitude: +m[2] };
  }

  const inPath = decodeURIComponent(url.pathname).match(/\/(?:search|place|dir)\/(-?\d{1,2}\.\d+),\s*\+?(-?\d{1,3}\.\d+)/);
  if (inPath && validPair(+inPath[1], +inPath[2])) return { latitude: +inPath[1], longitude: +inPath[2] };

  const center = full.match(/@(-?\d{1,2}\.\d+),(-?\d{1,3}\.\d+)/);
  if (center && validPair(+center[1], +center[2])) return { latitude: +center[1], longitude: +center[2] };

  return null;
}

/** El nombre del lugar en un link /maps/place/<nombre>/..., para prellenar la tarjeta. */
export function parsePlaceName(rawUrl: string): string | null {
  try {
    const m = new URL(rawUrl).pathname.match(/\/maps\/place\/([^/@]+)/);
    if (!m) return null;
    const name = decodeURIComponent(m[1].replace(/\+/g, ' ')).trim();
    // Un "place" que es un par de coordenadas no es un nombre.
    return name && !PAIR.test(name) ? name.slice(0, 100) : null;
  } catch {
    return null;
  }
}

/**
 * Coordenadas de un link de Google Maps, siguiendo los links cortos si hace falta.
 *
 * Solo se conecta a dominios de Google, en cada salto: la URL la escribe el admin de
 * un tenant, y sin este limite seria una forma de hacer que el servidor pida cualquier
 * direccion (incluida su propia red interna).
 */
export async function resolveMapsLink(input: string): Promise<ResolveResult> {
  const trimmed = (input ?? '').trim();
  if (!trimmed) return { ok: false, error: 'Pegá el link de Google Maps.' };

  let current: URL;
  try {
    current = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return { ok: false, error: 'Eso no parece un link.' };
  }

  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    if (!isAllowedHost(current.hostname)) {
      return { ok: false, error: 'Tiene que ser un link de Google Maps.' };
    }

    // La pantalla de consentimiento de Google trae el destino real en "continue".
    if (current.hostname.toLowerCase().startsWith('consent.')) {
      const next = current.searchParams.get('continue');
      if (!next) return { ok: false, error: NO_COORDS };
      try {
        current = new URL(next);
      } catch {
        return { ok: false, error: NO_COORDS };
      }
      continue;
    }

    const coords = parseCoordinates(current.href);
    if (coords) {
      return { ok: true, ...coords, name: parsePlaceName(current.href), resolvedUrl: current.href };
    }

    // Un link largo sin coordenadas no mejora pidiendolo: Google devuelve la pagina, no
    // una redireccion. Solo los cortos tienen a donde seguir.
    if (!SHORT_HOSTS.has(current.hostname.toLowerCase())) return { ok: false, error: NO_COORDS };

    let location: string | undefined;
    try {
      const res = await axios.get(current.href, {
        maxRedirects: 0,
        timeout: TIMEOUT_MS,
        validateStatus: () => true,
        responseType: 'stream',
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; NetServiceConnect/1.0)' },
      });
      res.data?.destroy?.();
      location = res.status >= 300 && res.status < 400 ? res.headers.location : undefined;
    } catch {
      return { ok: false, error: 'No se pudo abrir el link. Probá de nuevo o escribí las coordenadas a mano.' };
    }
    if (!location) return { ok: false, error: 'El link corto no lleva a ninguna ubicación. Revisá que esté completo.' };

    try {
      current = new URL(location, current);
    } catch {
      return { ok: false, error: NO_COORDS };
    }
  }

  return { ok: false, error: NO_COORDS };
}

/** Link para abrir unas coordenadas en Google Maps, cuando no hay uno guardado. */
export function mapsLinkFor(latitude: number, longitude: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${latitude},${longitude}`;
}
