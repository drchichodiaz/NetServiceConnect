'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CalendarPlus, CalendarX, ChevronRight, Loader2 } from 'lucide-react';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

interface CalendarInfo {
  doctor: { code: string; name: string };
  company: string;
  /** Null los dos mientras el calendario no este creado y compartido. */
  googleEmail: string | null;
  googleCalendarId: string | null;
}

/**
 * Donde el doctor agrega su calendario de Google, desde el boton del WhatsApp que le
 * manda la clinica. Sin usuario ni menu, y sin citas: solo lleva a Google Calendar, que
 * es quien las muestra y quien exige la cuenta con la que se compartio.
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

  return (
    <Shell>
      <header className="px-5 pt-6 pb-4 bg-white border-b border-border">
        <p className="text-xs text-ink-subtle">{info.company}</p>
        <h1 className="text-lg font-bold text-ink leading-tight mt-0.5">
          <span className="font-mono">{info.doctor.code}</span> · {info.doctor.name}
        </h1>
        <p className="text-sm text-ink-muted mt-2">
          Agregue sus citas a su Google Calendar. Se hace una sola vez: las citas nuevas, movidas o canceladas aparecen solas.
        </p>
      </header>

      <div className="px-4 py-4 space-y-3">
        {info.googleCalendarId ? (
          <>
            <a
              href={`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(info.googleCalendarId)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-3 rounded-2xl border border-green-400 bg-white px-4 py-4 shadow-card-md"
            >
              <CalendarPlus className="w-5 h-5 text-green-600 shrink-0" />
              <span className="flex-1 min-w-0 text-base font-semibold text-ink">Agregar a Google Calendar</span>
              <ChevronRight className="w-4 h-4 text-ink-subtle shrink-0" />
            </a>
            <p className="text-xs text-ink-muted px-1">
              El calendario está compartido con <b className="text-ink font-medium">{info.googleEmail}</b>. Tiene que abrirlo con esa cuenta de Google; si le pide elegir una, elija esa.
            </p>
            <p className="text-xs text-ink-subtle px-1">
              Si esa no es su cuenta, avísele a la clínica para que la corrija.
            </p>
          </>
        ) : (
          <p className="text-sm text-ink-muted px-1 py-8 text-center">
            Su calendario todavía no está listo. Vuelva a abrir este enlace en unos minutos.
          </p>
        )}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen bg-surface-muted max-w-md mx-auto">{children}</main>;
}
