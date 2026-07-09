'use client';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';

/**
 * Trae un archivo de media protegido (requiere el header Authorization, asi que un
 * <img src="..."> plano no sirve) y devuelve un object URL local para usarlo en
 * <img>/<audio>/<video>/<a>. Revoca el object URL al desmontar.
 */
export function useAuthedMedia(url: string | null) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(!!url);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!url) {
      setObjectUrl(null);
      setIsLoading(false);
      setError(false);
      return;
    }

    let cancelled = false;
    let currentUrl: string | null = null;
    setIsLoading(true);
    setError(false);

    api
      .get(url, { responseType: 'blob' })
      .then((res) => {
        if (cancelled) return;
        currentUrl = URL.createObjectURL(res.data);
        setObjectUrl(currentUrl);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
      if (currentUrl) URL.revokeObjectURL(currentUrl);
    };
  }, [url]);

  return { url: objectUrl, isLoading, error };
}
