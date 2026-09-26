import { useEffect, useState } from 'react';
import { whatsappApi } from '@/lib/api';
import { accountLabel, WhatsAppAccount } from '@/types';

export interface Clinic {
  id: string;
  label: string;
}

/**
 * Las clinicas son las lineas de WhatsApp que el usuario puede ver: una recepcion
 * limitada a su linea ve solo su clinica. Instagram y Messenger no son clinicas.
 * Sin cache compartida a proposito: son pocas y cambian (se conectan lineas).
 */
export function useClinics() {
  const [clinics, setClinics] = useState<Clinic[] | null>(null);

  useEffect(() => {
    let alive = true;
    whatsappApi
      .listActiveAccounts()
      .then((rows: (WhatsAppAccount & { channel?: string })[]) => {
        if (!alive) return;
        setClinics(
          rows
            .filter((a) => !a.channel || a.channel === 'WHATSAPP')
            .map((a) => ({ id: a.id, label: accountLabel(a) })),
        );
      })
      .catch(() => alive && setClinics([]));
    return () => {
      alive = false;
    };
  }, []);

  return clinics;
}

export function clinicName(clinics: Clinic[] | null, id: string | null | undefined): string {
  return clinics?.find((c) => c.id === id)?.label ?? 'Otra clínica';
}
