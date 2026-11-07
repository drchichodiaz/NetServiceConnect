'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { ChevronLeft, ChevronRight, Loader2, Plane, Plus, RefreshCw } from 'lucide-react';
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
import AbsenceModal, { AbsenceTarget } from '@/components/agenda/AbsenceModal';
import { useAuthStore } from '@/store/auth.store';

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

/** Que se pide para mostrar una vista, y con que clave se guarda. */
function viewKey(view: View, clinicId: string, date: string) {
  if (view === 'day') return `d:${clinicId}:${date}`;
  if (view === 'week') return `w:${clinicId}:${mondayOf(date)}`;
  return `m:${clinicId}:${date.slice(0, 7)}`;
}
function fetchView(view: View, clinicId: string, date: string): Promise<AgendaDay | AgendaDay[] | MonthSummary> {
  if (view === 'day') return agendaApi.day(clinicId, date);
  if (view === 'week') return agendaApi.week(clinicId, mondayOf(date));
  return agendaApi.month(clinicId, date.slice(0, 7));
}
function stepDate(view: View, date: string, n: number) {
  return view === 'day' ? addDays(date, n) : view === 'week' ? addDays(date, 7 * n) : addMonths(date, n);
}

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
  const [absence, setAbsence] = useState<AbsenceTarget | null>(null);
  // Las ausencias las administra la coordinacion, igual que en Doctores y turnos: la
  // recepcion las ve en gris pero no las cambia.
  const role = useAuthStore((s) => s.user?.role);
  const canManageAbsences = role === 'ADMIN' || role === 'SUPERVISOR';

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

  // Lo ya visto en esta visita, por vista, clinica y fecha. Volver a un dia (o pasar al
  // siguiente, que se pide por adelantado) lo muestra en el acto y lo refresca por detras;
  // antes cada cambio de dia era un "cargando" de casi un segundo, aunque recien se hubiera
  // visto. Se vacia ante cualquier cambio en la agenda, propio o de otra recepcion.
  const cache = useRef(new Map<string, AgendaDay | AgendaDay[] | MonthSummary>());
  const shownKey = useRef('');

  const load = useCallback(async () => {
    if (!clinicId || !date) return;
    const key = viewKey(view, clinicId, date);
    shownKey.current = key;
    const show = (data: AgendaDay | AgendaDay[] | MonthSummary) => {
      if (view === 'day') setDay(data as AgendaDay);
      else if (view === 'week') setWeek(data as AgendaDay[]);
      else setMonth(data as MonthSummary);
    };
    const cached = cache.current.get(key);
    if (cached) show(cached);
    setLoading(true);
    try {
      const data = await fetchView(view, clinicId, date);
      cache.current.set(key, data);
      if (shownKey.current === key) show(data);
    } catch (err: any) {
      if (shownKey.current === key) toast.error(err?.response?.data?.message || 'No se pudo cargar la agenda');
    } finally {
      if (shownKey.current === key) setLoading(false);
    }

    // El anterior y el siguiente, por adelantado: es a donde se va casi siempre.
    for (const n of [1, -1]) {
      const other = stepDate(view, date, n);
      const otherKey = viewKey(view, clinicId, other);
      if (!cache.current.has(otherKey)) {
        fetchView(view, clinicId, other).then((d) => cache.current.set(otherKey, d)).catch(() => {});
      }
    }
  }, [clinicId, date, view]);

  /** Recarga sin lo guardado: algo cambio y lo guardado ya no vale. */
  const reload = useCallback(() => {
    cache.current.clear();
    return load();
  }, [load]);

  // El codigo del calendario se baja mientras llegan los datos, no despues: antes la
  // pantalla esperaba los datos y recien ahi empezaba a descargarlo.
  useEffect(() => {
    import('@/components/agenda/CalendarDayView');
    import('@/components/agenda/CalendarWeekView');
    import('@/components/agenda/CalendarMonthView');
  }, []);

  useEffect(() => { load(); }, [load]);

  // Una sola recarga por rafaga: al mover una cita llegan casi juntos el "listo" del
  // propio pedido y el aviso en vivo de que la agenda cambio. Antes eran dos recargas
  // seguidas del dia entero; ahora se juntan en una.
  const loadRef = useRef(reload);
  loadRef.current = reload;
  const reloadTimer = useRef<ReturnType<typeof setTimeout>>();
  const requestReload = useCallback(() => {
    clearTimeout(reloadTimer.current);
    reloadTimer.current = setTimeout(() => loadRef.current(), 400);
  }, []);
  useEffect(() => () => clearTimeout(reloadTimer.current), []);

  // Estables para que el calendario no se redibuje entero en cada render de la pagina.
  const openCreateAt = useCallback((d: string, minute: number) => setCreating({ date: d, minute }), []);
  const dateRef = useRef(date);
  dateRef.current = date;
  const openCreateToday = useCallback((minute: number) => setCreating({ date: dateRef.current, minute }), []);
  const openAbsence = useCallback((t: Omit<AbsenceTarget, 'date'>) => setAbsence({ ...t, date: dateRef.current }), []);

  // En vivo: si otra recepcion (u otra clinica que comparte doctor) cambia algo, se recarga.
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    const es = new EventSource(`${API}/events?token=${token}`);
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        // Un cambio en otra clinica tambien importa: puede ocupar a un doctor que hoy esta aca.
        if (data.type === 'agenda_changed') requestReload();
      } catch { /* evento que no es JSON */ }
    };
    return () => es.close();
  }, [requestReload]);

  function pickClinic(id: string) {
    setClinicId(id);
    remember('agenda.clinic', id);
  }
  function pickView(v: View) {
    setView(v);
    remember('agenda.view', v);
  }
  const drill = useCallback((d: string) => {
    setDate(d);
    setView('day');
    remember('agenda.view', 'day');
  }, []);
  function step(n: number) {
    setDate((d) => stepDate(view, d, n));
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
          <button onClick={reload} className="btn-ghost w-8 h-8 p-0" title="Actualizar">
            <RefreshCw className={clsx('w-4 h-4', loading && 'animate-spin')} />
          </button>
          {canManageAbsences && view === 'day' && (
            <button onClick={() => setAbsence({ date })} className="btn-secondary !py-2" title="Marcar que un doctor falta este día">
              <Plane className="w-4 h-4" /> Ausencia
            </button>
          )}
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
              onSlot={openCreateToday}
              onOpen={setOpen}
              onChanged={requestReload}
              onAbsence={canManageAbsences ? openAbsence : undefined}
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
              onSlot={openCreateAt}
              onOpen={setOpen}
              onDrill={drill}
              onChanged={requestReload}
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
          onCreated={() => { setCreating(null); reload(); }}
        />
      )}
      {absence && (
        <AbsenceModal
          target={absence}
          onClose={() => setAbsence(null)}
          onSaved={() => { setAbsence(null); reload(); }}
        />
      )}
      {open && (
        <AppointmentPanel
          appointment={open}
          timezone={tz}
          onClose={() => setOpen(null)}
          onChanged={reload}
        />
      )}
    </div>
  );
}

function Spinner() {
  return <div className="flex justify-center py-24"><Loader2 className="w-5 h-5 animate-spin text-ink-subtle" /></div>;
}
