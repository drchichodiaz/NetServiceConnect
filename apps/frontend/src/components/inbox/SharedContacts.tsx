'use client';
import { useState } from 'react';
import { Check, Loader2, UserPlus, UserRound } from 'lucide-react';
import toast from 'react-hot-toast';
import { contactsApi } from '@/lib/api';
import { Message } from '@/types';

export interface SharedContact {
  name: string;
  /** Como lo muestra la tarjeta de WhatsApp ("+507 6418-8200"). */
  phoneLabel?: string;
  /**
   * Solo digitos, con codigo de pais: el mismo formato que `msg.from` del webhook, para
   * que cuando esa persona escriba caiga en esta ficha y no en una nueva. null si no
   * hay forma segura de saber el codigo de pais: ahi no se ofrece agregarlo.
   */
  phone: string | null;
  email?: string;
  company?: string;
}

/**
 * Contacto(s) que compartio el cliente. Viene en rawPayload.contacts, asi que tambien
 * se ven los que llegaron antes de que el webhook los reconociera (guardados con body
 * "[mensaje]").
 */
export function sharedContacts(message: Message): SharedContact[] {
  const list = message.rawPayload?.contacts;
  if (message.direction !== 'INBOUND' || !Array.isArray(list)) return [];
  return list.map((c: any) => {
    const phones: any[] = Array.isArray(c?.phones) ? c.phones : [];
    // wa_id lo pone WhatsApp cuando el numero tiene cuenta: siempre va completo. Si no
    // esta, el numero escrito solo sirve si arranca con "+": un "6418-8200" suelto no
    // dice de que pais es, y guardarlo asi crearia un contacto que nunca coincide.
    const withWa = phones.find((p) => p?.wa_id);
    const withPlus = phones.find((p) => typeof p?.phone === 'string' && p.phone.trim().startsWith('+'));
    const raw = withWa?.wa_id ?? withPlus?.phone ?? null;
    const digits = raw ? String(raw).replace(/\D/g, '') : '';
    return {
      name:
        c?.name?.formatted_name ||
        [c?.name?.first_name, c?.name?.last_name].filter(Boolean).join(' ') ||
        'Contacto',
      phoneLabel: (withWa ?? phones[0])?.phone || withWa?.wa_id,
      phone: /^[1-9]\d{7,14}$/.test(digits) ? digits : null,
      email: c?.emails?.[0]?.email || undefined,
      company: c?.org?.company || undefined,
    };
  });
}

type SaveState = 'idle' | 'saving' | 'saved' | 'exists';

function SharedContactCard({ contact }: { contact: SharedContact }) {
  const [state, setState] = useState<SaveState>('idle');

  const save = async () => {
    if (!contact.phone) return;
    setState('saving');
    try {
      await contactsApi.create({
        phone: contact.phone,
        name: contact.name,
        ...(contact.email && { email: contact.email }),
        ...(contact.company && { company: contact.company }),
      });
      setState('saved');
      toast.success(`${contact.name} se agregó a contactos`);
    } catch (err: any) {
      if (err?.response?.status === 409) {
        setState('exists');
        toast(`${contact.name} ya estaba en contactos`);
        return;
      }
      setState('idle');
      const msg = err?.response?.data?.message;
      toast.error(Array.isArray(msg) ? msg[0] : msg || 'No se pudo agregar el contacto');
    }
  };

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'rgba(0,0,0,0.03)', border: '1px solid rgba(0,0,0,0.06)' }}>
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <span className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: '#DCFCE7' }}>
          <UserRound className="w-4 h-4" style={{ color: '#128C7E' }} />
        </span>
        <span className="min-w-0 text-xs">
          <span className="block font-semibold text-ink">{contact.name}</span>
          {contact.phoneLabel && <span className="block text-ink-muted select-all">{contact.phoneLabel}</span>}
        </span>
      </div>

      {contact.phone && (
        <button
          onClick={save}
          disabled={state !== 'idle'}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-semibold border-t disabled:cursor-default"
          style={{ borderColor: 'rgba(0,0,0,0.06)', color: '#128C7E' }}
        >
          {state === 'saving' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {state === 'idle' && <UserPlus className="w-3.5 h-3.5" />}
          {(state === 'saved' || state === 'exists') && <Check className="w-3.5 h-3.5" />}
          {state === 'idle' && 'Agregar a contactos'}
          {state === 'saving' && 'Agregando...'}
          {state === 'saved' && 'Agregado'}
          {state === 'exists' && 'Ya está en contactos'}
        </button>
      )}
    </div>
  );
}

export function SharedContactCards({ contacts }: { contacts: SharedContact[] }) {
  return (
    <div className="space-y-1 mb-1">
      {contacts.map((c, i) => (
        <SharedContactCard key={i} contact={c} />
      ))}
    </div>
  );
}
