'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { ChevronLeft, ChevronRight, Loader2, Plus, RefreshCw } from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { agendaApi } from '@/lib/api';
import { getToken } from '@/lib/auth';
import {
  AgendaDay,
  Appointment,
  MonthSummary,
  addDays,
  addMonths,
  longDate,
  mondayOf,
  monthLabel,
  toLocal,
  todayIn,
  weekLabel,
} from '@/lib/agenda';
import { useAgendaSettings } from '@/hooks/useAgendaSettings';
import { useClinics } from '@/components/agenda/useClinics';
import CreateAppointmentModal from '@/components/agenda/CreateAppointmentModal';
import AppointmentPanel from '@/components/agenda/AppointmentPanel';

// La libreria de calendario toca el DOM al cargarse: solo del lado del cliente.
const CalendarDayView = dynamic(() => import('@/components/agenda/CalendarDayView'), { ssr: false });
const CalendarWeekView = dynamic(() => import('@/components/agenda/CalendarWeekView'), { ssr: false });
const CalendarMonthView = dynamic(() => import('@/components/agenda/CalendarMonthView'), { ssr: false });

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

type View = 'day' | 'week' | 'month';
const VIEWS: { id: View; label: string }[] = [
  { id: 'day', label: 'Día' },
  { id: 'week', label: 'Semana' },
  { id: 'month', label: 'Mes' },
];

function remembered(key: string): string {
  try { return localStorage.getItem(key) ?? ''; } catch { return ''; }
}
function remember(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* sin storage */ }
}

export default function AgendaPage() {
  const settings = useAgendaSettings();
  const clinics = useClinics();
  const tz = settings?.timezone ?? 'America/Panama';

  const [clinicId, setClinicId] = useState('');
  const [date, setDate] = useState('');
  const [view, setView] = useState<View>('day');
  const [day, setDay] = useState<AgendaDay | null>(null);
  const [week, setWeek] = useState<AgendaDay[] | null>(null);
  const [month, setMonth] = useState<MonthSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState<{ date?: string; minute?: number } | null>(null);
  const [open, setOpen] = useState<Appointment | null>(null);

  // Arranca cuando se sabe la zona y que clinicas puede ver.
  useEffect(() => {
    if (settings && !date) setDate(todayIn(settings.timezone));
  }, [settings, date]);
  useEffect(() => {
    if (clinics?.length && !clinicId) {
      const saved = remembered('agenda.clinic');
      setClinicId(clinics.some((c) => c.id === saved) ? saved : clinics[0].id);
      const savedView = remembered('agenda.view') as View;
      if (VIEWS.some((v) => v.id === savedView)) setView(savedView);
    }
  }, [clinics, clinicId]);

  const load = useCallback(async () => {
    if (!clinicId || !date) return;
    setLoading(true);
    try {
      if (view === 'day') {
        setDay(await agendaApi.day(clinicId, date));
      } else if (view === 'week') {
        const monday = mondayOf(date);
        setWeek(await Promise.all(Array.from({ length: 7 }, (_, i) => agendaApi.day(clinicId, addDays(monday, i)))));
      } else {
        setMonth(await agendaApi.month(clinicId, date.slice(0, 7)));
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo cargar la agenda');
    } finally {
      setLoading(false);
    }
  }, [clinicId, date, view]);

  useEffect(() => { load(); }, [load]);

  // En vivo: si otra recepcion (u otra clinica que comparte doctor) cambia algo, se recarga.
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    const es = new EventSource(`${API}/events?token=${token}`);
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        // Un cambio en otra clinica tambien importa: puede ocupar a un doctor que hoy esta aca.
        if (data.type === 'agenda_changed') loadRef.current();
      } catch { /* evento que no es JSON */ }
    };
    return () => es.close();
  }, []);

  function pickClinic(id: string) {
    setClinicId(id);
    remember('agenda.clinic', id);
  }
  function pickView(v: View) {
    setView(v);
    remember('agenda.view', v);
  }
  function drill(d: string) {
    setDate(d);
    pickView('day');
  }
  function step(n: number) {
    setDate((d) => (view === 'day' ? addDays(d, n) : view === 'week' ? addDays(d, 7 * n) : addMonths(d, n)));
  }

  if (!settings || !clinics) return <Spinner />;
  if (!settings.enabled) {
    return <div className="max-w-2xl mx-auto py-16 px-6 text-sm text-ink-muted">La agenda no está activada para esta empresa.</div>;
  }
  if (clinics.length === 0) {
    return <div className="max-w-2xl mx-auto py-16 px-6 text-sm text-ink-muted">No tiene ninguna clínica asignada. Pídale a un administrador que le dé acceso a la línea de su clínica.</div>;
  }

  const now = toLocal(new Date(), tz);
  const today = now.date;
  const title = !date ? '' : view === 'day' ? longDate(date) : view === 'week' ? weekLabel(mondayOf(date)) : monthLabel(date);
  const isCurrent = view === 'day' ? date === today : view === 'week' ? mondayOf(date) === mondayOf(today) : date.slice(0, 7) === today.slice(0, 7);
  const unit = view === 'day' ? 'Día' : view === 'week' ? 'Semana' : 'Mes';

  return (
    <div className="h-full flex flex-col">
      <header className="flex flex-wrap items-center gap-3 px-6 py-4 border-b border-border bg-white">
        <h1 className="text-lg font-bold text-ink mr-2" style={{ letterSpacing: '-0.02em' }}>Agenda</h1>
        {clinics.length > 1 ? (
          <select value={clinicId} onChange={(e) => pickClinic(e.target.value)} className="input !w-auto !py-1.5">
            {clinics.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        ) : (
          <span className="text-sm text-ink-muted">{clinics[0].label}</span>
        )}
        <div className="flex items-center gap-1">
          <button onClick={() => step(-1)} className="btn-ghost w-8 h-8 p-0" title={`${unit} anterior`}><ChevronLeft className="w-4 h-4" /></button>
          <button onClick={() => setDate(today)} disabled={isCurrent} className="btn-secondary !py-1 !px-3 text-xs">Hoy</button>
          <button onClick={() => step(1)} className="btn-ghost w-8 h-8 p-0" title={`${unit} siguiente`}><ChevronRight className="w-4 h-4" /></button>
          <input type="date" value={date} onChange={(e) => e.target.value && setDate(e.target.value)} className="input !w-auto !py-1 text-xs ml-1" />
        </div>
        <span className="text-sm font-medium text-ink">{title}</span>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex rounded-lg border border-border overflow-hidden text-xs">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                onClick={() => pickView(v.id)}
                className={clsx('px-3 py-1.5', view === v.id ? 'bg-surface-subtle text-ink font-medium' : 'text-ink-muted hover:text-ink')}
              >
                {v.label}
              </button>
            ))}
          </div>
          <button onClick={load} className="btn-ghost w-8 h-8 p-0" title="Actualizar">
            <RefreshCw className={clsx('w-4 h-4', loading && 'animate-spin')} />
          </button>
          <button onClick={() => setCreating({})} className="btn-primary !py-2">
            <Plus className="w-4 h-4" /> Crear cita
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-auto bg-surface-muted">
        {view === 'day' &&
          (!day || day.date !== date ? (
            <Spinner />
          ) : day.doctors.length === 0 ? (
            <div className="max-w-md mx-auto py-16 text-center text-sm text-ink-muted">
              Ningún doctor atiende en esta clínica este día.
              <span className="block text-xs text-ink-subtle mt-1">Los turnos se cargan en “Doctores y turnos”.</span>
            </div>
          ) : (
            <CalendarDayView
              day={day}
              isPast={date < today}
              nowMinute={date === today ? now.minute : null}
              onSlot={(minute) => setCreating({ date, minute })}
              onOpen={setOpen}
              onChanged={load}
            />
          ))}

        {view === 'week' &&
          (!week || week[0].date !== mondayOf(date) ? (
            <Spinner />
          ) : (
            <CalendarWeekView
              days={week}
              today={today}
              nowMinute={now.minute}
              onSlot={(d, minute) => setCreating({ date: d, minute })}
              onOpen={setOpen}
              onDrill={drill}
              onChanged={load}
            />
          ))}

        {view === 'month' &&
          (!month || month.month !== date.slice(0, 7) ? (
            <Spinner />
          ) : (
            <CalendarMonthView summary={month} today={today} onDrill={drill} />
          ))}
      </div>

      {creating && (
        <CreateAppointmentModal
          clinics={clinics}
          timezone={tz}
          slotMinutes={settings.slotMinutes}
          initial={{ channelAccountId: clinicId, date: creating.date, minute: creating.minute }}
          onClose={() => setCreating(null)}
          onCreated={() => { setCreating(null); load(); }}
        />
      )}
      {open && (
        <AppointmentPanel
          appointment={open}
          timezone={tz}
          onClose={() => setOpen(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

function Spinner() {
  return <div className="flex justify-center py-24"><Loader2 className="w-5 h-5 animate-spin text-ink-subtle" /></div>;
}
