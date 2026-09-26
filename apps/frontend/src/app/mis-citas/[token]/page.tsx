'use client';
import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { CalendarX, Clock, Loader2, MapPin, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import { AppointmentStatus, clock, longDate, toLocal } from '@/lib/agenda';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';
const REFRESH_MS = 60_000;

interface DoctorDay {
  doctor: { code: string; name: string };
  company: string;
  date: string;
  timezone: string;
  windows: { start: number; end: number; clinic: string }[];
  appointments: {
    id: string;
    startMinute: number;
    endMinute: number;
    patient: string;
    reason: string | null;
    status: AppointmentStatus;
    clinic: string;
  }[];
}

type Failure = { kind: 'expired'; date?: string } | { kind: 'invalid' } | { kind: 'offline' };

const STATUS: Partial<Record<AppointmentStatus, { label: string; className: string }>> = {
  CONFIRMED: { label: 'Confirmó', className: 'bg-green-100 text-green-700' },
  ARRIVED: { label: 'Llegó', className: 'bg-sky-100 text-sky-700' },
  DONE: { label: 'Atendido', className: 'bg-gray-100 text-gray-500' },
  NO_SHOW: { label: 'No vino', className: 'bg-red-100 text-red-600' },
};

/**
 * Las citas del dia de un doctor, desde el enlace del WhatsApp de la mañana. Sin
 * usuario ni menu: la abre en el celular entre paciente y paciente. Se actualiza sola,
 * asi una cita agregada a media mañana aparece sin que tenga que hacer nada.
 */
export default function MisCitasPage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<DoctorDay | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/public/agenda/doctor-day/${encodeURIComponent(token)}`, { cache: 'no-store' });
      if (res.status === 410) {
        const body = await res.json().catch(() => ({}));
        setFailure({ kind: 'expired', date: body?.date });
        setData(null);
      } else if (!res.ok) {
        setFailure({ kind: 'invalid' });
        setData(null);
      } else {
        setData(await res.json());
        setFailure(null);
        setUpdatedAt(new Date());
      }
    } catch {
      // Sin conexion: se deja lo que ya se veia y se avisa arriba.
      setFailure((f) => f ?? { kind: 'offline' });
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    const onFocus = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', onFocus);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [load]);

  if (!data && loading) {
    return <Shell><div className="flex justify-center py-24"><Loader2 className="w-6 h-6 animate-spin text-ink-subtle" /></div></Shell>;
  }

  if (!data && failure) {
    return (
      <Shell>
        <div className="py-20 text-center px-6">
          <CalendarX className="w-10 h-10 mx-auto text-ink-ghost mb-4" />
          {failure.kind === 'expired' ? (
            <>
              <p className="text-base font-semibold text-ink">Este enlace ya venció</p>
              <p className="text-sm text-ink-muted mt-1">
                Era para {failure.date ? longDate(failure.date).toLowerCase() : 'otro día'}. Cada mañana le llega uno nuevo por WhatsApp.
              </p>
            </>
          ) : failure.kind === 'offline' ? (
            <p className="text-sm text-ink-muted">No hay conexión. Vuelva a intentar en un momento.</p>
          ) : (
            <p className="text-base font-semibold text-ink">Este enlace no es válido</p>
          )}
        </div>
      </Shell>
    );
  }

  if (!data) return null;

  const now = toLocal(new Date(), data.timezone).minute;
  const nextId = data.appointments.find((a) => a.endMinute > now && a.status !== 'DONE' && a.status !== 'NO_SHOW')?.id;
  const manyClinics = new Set(data.appointments.map((a) => a.clinic)).size > 1;

  return (
    <Shell>
      <header className="px-5 pt-6 pb-4 bg-white border-b border-border">
        <p className="text-xs text-ink-subtle">{data.company}</p>
        <h1 className="text-lg font-bold text-ink leading-tight mt-0.5">
          <span className="font-mono">{data.doctor.code}</span> · {data.doctor.name}
        </h1>
        <p className="text-sm text-ink-muted mt-0.5">{longDate(data.date)}</p>
        {data.windows.length > 0 && (
          <div className="mt-3 space-y-1">
            {data.windows.map((w, i) => (
              <p key={i} className="text-xs text-ink flex items-center gap-1.5">
                <MapPin className="w-3.5 h-3.5 text-green-600" />
                {w.clinic} · {clock(w.start)} a {clock(w.end)}
              </p>
            ))}
          </div>
        )}
      </header>

      <div className="px-4 py-3 flex items-center justify-between text-xs text-ink-subtle">
        <span>
          {data.appointments.length} {data.appointments.length === 1 ? 'cita' : 'citas'}
          {failure?.kind === 'offline' && <span className="text-amber-600"> · sin conexión</span>}
        </span>
        <button onClick={load} className="flex items-center gap-1 text-ink-muted" aria-label="Actualizar">
          <RefreshCw className={clsx('w-3.5 h-3.5', loading && 'animate-spin')} />
          {updatedAt && `Actualizado ${clock(toLocal(updatedAt, data.timezone).minute)}`}
        </button>
      </div>

      {data.appointments.length === 0 ? (
        <p className="text-center text-sm text-ink-muted py-16">No tiene citas hoy.</p>
      ) : (
        <ol className="px-4 pb-10 space-y-2">
          {data.appointments.map((a) => {
            const past = a.endMinute <= now || a.status === 'DONE' || a.status === 'NO_SHOW';
            const isNext = a.id === nextId;
            const status = STATUS[a.status];
            return (
              <li
                key={a.id}
                className={clsx(
                  'rounded-2xl border bg-white px-4 py-3',
                  isNext ? 'border-green-400 shadow-card-md' : 'border-border',
                  past && 'opacity-55',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-ink flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-ink-subtle" />
                    {clock(a.startMinute)} – {clock(a.endMinute)}
                  </span>
                  <span className="flex items-center gap-1.5">
                    {isNext && <span className="badge bg-green-500 text-white">Sigue</span>}
                    {status && <span className={clsx('badge', status.className)}>{status.label}</span>}
                  </span>
                </div>
                <p className="text-base text-ink mt-1">{a.patient}</p>
                {(a.reason || manyClinics) && (
                  <p className="text-xs text-ink-muted mt-0.5">
                    {a.reason}
                    {a.reason && manyClinics && ' · '}
                    {manyClinics && a.clinic}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="min-h-screen bg-surface-muted max-w-md mx-auto">{children}</main>;
}
