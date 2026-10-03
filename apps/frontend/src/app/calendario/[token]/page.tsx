'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CalendarPlus, CalendarX, ChevronRight, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

interface CalendarInfo {
  doctor: { code: string; name: string };
  company: string;
}

/**
 * Donde el doctor agrega sus citas a su propio calendario, desde el enlace que le pasa
 * la clinica. Sin usuario ni menu: un boton por calendario, y cada uno abre ese
 * calendario con la suscripcion ya cargada, para que solo tenga que aceptar.
 */
export default function CalendarioPage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<CalendarInfo | null>(null);
  const [failed, setFailed] = useState<'invalid' | 'offline' | null>(null);

  useEffect(() => {
    fetch(`${API}/public/agenda/calendar-info/${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then(async (res) => {
        if (res.ok) setInfo(await res.json());
        else setFailed('invalid');
      })
      .catch(() => setFailed('offline'));
  }, [token]);

  if (failed) {
    return (
      <Shell>
        <div className="py-20 text-center px-6">
          <CalendarX className="w-10 h-10 mx-auto text-ink-ghost mb-4" />
          {failed === 'offline' ? (
            <p className="text-sm text-ink-muted">No hay conexión. Vuelva a intentar en un momento.</p>
          ) : (
            <>
              <p className="text-base font-semibold text-ink">Este enlace ya no es válido</p>
              <p className="text-sm text-ink-muted mt-1">Pídale a la clínica que le envíe uno nuevo.</p>
            </>
          )}
        </div>
      </Shell>
    );
  }

  if (!info) {
    return <Shell><div className="flex justify-center py-24"><Loader2 className="w-6 h-6 animate-spin text-ink-subtle" /></div></Shell>;
  }

  // NEXT_PUBLIC_API_URL puede ser relativa ("/api"): se resuelve contra esta pagina.
  const feed = new URL(`${API.replace(/\/$/, '')}/public/agenda/calendar/${token}.ics`, window.location.origin).toString();
  // webcal:// es lo que los calendarios entienden como "suscribirse", no "descargar".
  const webcal = feed.replace(/^https?:/, 'webcal:');
  const name = `${info.company} · ${info.doctor.name}`;

  const options = [
    { label: 'iPhone, iPad o Mac', hint: 'Calendario de Apple', href: webcal },
    {
      label: 'Google Calendar',
      hint: 'Si no se abre desde el teléfono, pruebe desde una computadora',
      href: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(webcal)}`,
    },
    {
      label: 'Outlook',
      hint: 'Cuenta personal (Outlook.com, Hotmail)',
      href: `https://outlook.live.com/calendar/0/addfromweb?url=${encodeURIComponent(feed)}&name=${encodeURIComponent(name)}`,
    },
    {
      label: 'Outlook del trabajo',
      hint: 'Cuenta de Microsoft 365',
      href: `https://outlook.office.com/calendar/0/addfromweb?url=${encodeURIComponent(feed)}&name=${encodeURIComponent(name)}`,
    },
  ];

  async function copy() {
    try {
      await navigator.clipboard.writeText(feed);
      toast.success('Enlace copiado');
    } catch {
      toast.error('No se pudo copiar');
    }
  }

  return (
    <Shell>
      <header className="px-5 pt-6 pb-4 bg-white border-b border-border">
        <p className="text-xs text-ink-subtle">{info.company}</p>
        <h1 className="text-lg font-bold text-ink leading-tight mt-0.5">
          <span className="font-mono">{info.doctor.code}</span> · {info.doctor.name}
        </h1>
        <p className="text-sm text-ink-muted mt-2">
          Agregue sus citas a su calendario. Se hace una sola vez: las citas nuevas, movidas o canceladas se actualizan solas.
        </p>
      </header>

      <div className="px-4 py-4 space-y-2">
        <p className="text-xs text-ink-subtle px-1">¿Qué calendario usa?</p>
        {options.map((o) => (
          <a
            key={o.label}
            href={o.href}
            target={o.href.startsWith('webcal:') ? undefined : '_blank'}
            rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-2xl border border-border bg-white px-4 py-3"
          >
            <CalendarPlus className="w-5 h-5 text-green-600 shrink-0" />
            <span className="flex-1 min-w-0">
              <span className="block text-base text-ink">{o.label}</span>
              <span className="block text-xs text-ink-muted">{o.hint}</span>
            </span>
            <ChevronRight className="w-4 h-4 text-ink-subtle shrink-0" />
          </a>
        ))}

        <p className="text-xs text-ink-muted px-1 pt-3">
          ¿Usa otro calendario?{' '}
          <button onClick={copy} className="text-green-600 underline">Copie el enlace</button>{' '}
          y péguelo donde su calendario pide “suscribirse desde una dirección”.
        </p>
        <p className="text-xs text-ink-subtle px-1 pt-1">
          Este enlace es personal: quien lo tenga ve sus citas. No lo reenvíe.
        </p>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen bg-surface-muted max-w-md mx-auto">{children}</main>;
}
