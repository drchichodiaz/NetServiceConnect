'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bot, CalendarDays, ChevronLeft, ChevronRight, Loader2, MessageSquare, RefreshCw, User, UserRound } from 'lucide-react';
import clsx from 'clsx';
import toast from 'react-hot-toast';
import { ActivityCategory, ActivityDay, ActivityItem, activityApi, agendaApi } from '@/lib/api';
import { getToken } from '@/lib/auth';
import { Appointment, addDays, hhmm, longDate, toLocal, todayIn } from '@/lib/agenda';
import { useAgendaSettings } from '@/hooks/useAgendaSettings';
import { useInboxStore } from '@/store/inbox.store';
import AppointmentPanel from '@/components/agenda/AppointmentPanel';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

const CATEGORIES: { id: ActivityCategory | ''; label: string }[] = [
  { id: '', label: 'Todo' },
  { id: 'appointments', label: 'Citas' },
  { id: 'handoffs', label: 'Pasadas a operador' },
  { id: 'bot', label: 'Bot' },
  { id: 'team', label: 'Equipo' },
];

// Eventos en vivo que pueden traer una linea nueva a la bitacora.
const LIVE_EVENTS = new Set(['new_message', 'conversation_updated', 'agenda_changed']);

/**
 * La bitacora del dia: que hizo el bot, que hizo el equipo y que hicieron los pacientes,
 * en orden. Es para dar seguimiento a lo que el bot atendio y cerro solo, que en la
 * bandeja no se ve.
 */
export default function ActivityPage() {
  const router = useRouter();
  const agenda = useAgendaSettings();
  const [date, setDate] = useState('');
  const [lineId, setLineId] = useState('');
  const [category, setCategory] = useState<ActivityCategory | ''>('');
  const [data, setData] = useState<ActivityDay | null>(null);
  const [loading, setLoading] = useState(false);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [openAppt, setOpenAppt] = useState<Appointment | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const seen = useRef<Set<string> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await activityApi.list({ date: date || undefined, channelAccountId: lineId || undefined, category: category || undefined });
      // Lo que llego desde la ultima carga se resalta un momento, para que se note.
      if (seen.current) {
        const added = next.items.filter((i) => !seen.current!.has(i.id)).map((i) => i.id);
        if (added.length) {
          setFresh(new Set(added));
          setTimeout(() => setFresh(new Set()), 4000);
        }
      }
      seen.current = new Set(next.items.map((i) => i.id));
      setData(next);
      if (!date) setDate(next.date);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo cargar la actividad');
    } finally {
      setLoading(false);
    }
  }, [date, lineId, category]);

  // Al cambiar de dia o de filtro no hay nada "nuevo" que resaltar.
  useEffect(() => { seen.current = null; }, [date, lineId, category]);
  useEffect(() => { load(); }, [load]);

  const today = data ? todayIn(data.timezone) : '';
  const isToday = !!date && date === today;

  // En vivo, solo mirando hoy: varios eventos seguidos se juntan en una recarga.
  const loadRef = useRef(load);
  loadRef.current = load;
  const isTodayRef = useRef(isToday);
  isTodayRef.current = isToday;
  useEffect(() => {
    const token = getToken();
    if (!token) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const es = new EventSource(`${API}/events?token=${token}`);
    es.onmessage = (ev) => {
      try {
        const event = JSON.parse(ev.data);
        if (!LIVE_EVENTS.has(event.type) || !isTodayRef.current) return;
        clearTimeout(timer);
        timer = setTimeout(() => loadRef.current(), 1500);
      } catch { /* heartbeat u otro texto */ }
    };
    return () => { clearTimeout(timer); es.close(); };
  }, []);

  async function openConversation(item: ActivityItem) {
    if (!item.conversationId) return;
    setOpening(item.id);
    try {
      await useInboxStore.getState().openConversation(item.conversationId);
      router.push('/inbox');
    } catch {
      toast.error('No se pudo abrir la conversación');
      setOpening(null);
    }
  }

  async function openAppointment(item: ActivityItem) {
    if (!item.appointmentId) return;
    setOpening(item.id);
    try {
      setOpenAppt(await agendaApi.appointment(item.appointmentId));
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo abrir la cita');
    } finally {
      setOpening(null);
    }
  }

  const lines = data?.lines ?? [];
  const lineLabel = new Map(lines.map((l) => [l.id, l.label]));
  const tz = data?.timezone ?? 'America/Panama';

  return (
    <div className="h-full flex flex-col">
      <header className="flex flex-wrap items-center gap-3 px-6 py-4 border-b border-border bg-white">
        <h1 className="text-lg font-bold text-ink mr-2" style={{ letterSpacing: '-0.02em' }}>Actividad</h1>
        {lines.length > 1 && (
          <select value={lineId} onChange={(e) => setLineId(e.target.value)} className="input !w-auto !py-1.5">
            <option value="">Todas las líneas</option>
            {lines.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
          </select>
        )}
        <div className="flex items-center gap-1">
          <button onClick={() => setDate((d) => addDays(d, -1))} disabled={!date} className="btn-ghost w-8 h-8 p-0" title="Día anterior"><ChevronLeft className="w-4 h-4" /></button>
          <button onClick={() => setDate(today)} disabled={!date || isToday} className="btn-secondary !py-1 !px-3 text-xs">Hoy</button>
          <button onClick={() => setDate((d) => addDays(d, 1))} disabled={!date || isToday} className="btn-ghost w-8 h-8 p-0" title="Día siguiente"><ChevronRight className="w-4 h-4" /></button>
          <input type="date" value={date} max={today || undefined} onChange={(e) => e.target.value && setDate(e.target.value)} className="input !w-auto !py-1 text-xs ml-1" />
        </div>
        {date && <span className="text-sm font-medium text-ink">{longDate(date)}</span>}
        <div className="ml-auto flex items-center gap-2">
          {isToday && <span className="text-[11px] text-green-700 flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-green-500" /> En vivo</span>}
          <button onClick={load} className="btn-ghost w-8 h-8 p-0" title="Actualizar">
            <RefreshCw className={clsx('w-4 h-4', loading && 'animate-spin')} />
          </button>
        </div>
      </header>

      <div className="px-6 py-2 border-b border-border bg-white flex gap-1 overflow-x-auto">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            onClick={() => setCategory(c.id)}
            className={clsx('text-xs px-3 py-1.5 rounded-lg whitespace-nowrap', category === c.id ? 'bg-surface-subtle text-ink font-medium' : 'text-ink-muted hover:text-ink')}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto bg-surface-muted">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 py-4">
          {!data ? (
            <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-ink-subtle" /></div>
          ) : data.items.length === 0 ? (
            <div className="card p-10 text-center text-sm text-ink-muted">
              {category ? 'No hubo nada de este tipo ese día.' : isToday ? 'Todavía no pasó nada hoy.' : 'No pasó nada ese día.'}
            </div>
          ) : (
            <div className="card divide-y divide-border">
              {data.items.map((item) => (
                <div key={item.id} className={clsx('flex items-start gap-3 px-4 py-3 transition-colors duration-700', fresh.has(item.id) && 'bg-green-50')}>
                  {/* En el celular la hora y quien lo hizo van arriba, y el texto ocupa todo el ancho. */}
                  <div className="flex-1 min-w-0 flex flex-col sm:flex-row sm:items-start gap-1.5 sm:gap-3">
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-xs font-mono text-ink-subtle w-11 shrink-0">{hhmm(toLocal(item.at, tz).minute)}</span>
                      <ActorBadge item={item} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-ink">{item.text}</p>
                      {lines.length > 1 && item.channelAccountId && (
                        <p className="text-[11px] text-ink-subtle mt-0.5">{lineLabel.get(item.channelAccountId)}</p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {item.appointmentId && agenda?.enabled && (
                      <button onClick={() => openAppointment(item)} disabled={opening === item.id} className="btn-ghost w-8 h-8 p-0" title="Ver la cita">
                        <CalendarDays className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {item.canOpenConversation && (
                      <button onClick={() => openConversation(item)} disabled={opening === item.id} className="btn-ghost w-8 h-8 p-0" title="Ver la conversación">
                        {opening === item.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <MessageSquare className="w-3.5 h-3.5" />}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
          {data?.truncated && (
            <p className="text-[11px] text-ink-subtle text-center mt-3">Se muestran los últimos 3.000 eventos del día. Filtre por línea o por tipo para ver el resto.</p>
          )}
        </div>
      </div>

      {openAppt && (
        <AppointmentPanel appointment={openAppt} timezone={tz} onClose={() => setOpenAppt(null)} onChanged={load} />
      )}
    </div>
  );
}

function ActorBadge({ item }: { item: ActivityItem }) {
  if (item.actor === 'bot') {
    return (
      <span className="flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md bg-green-100 text-green-700 shrink-0 w-28">
        <Bot className="w-3 h-3" /> Bot
      </span>
    );
  }
  if (item.actor === 'patient') {
    return (
      <span className="flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md bg-sky-100 text-sky-700 shrink-0 w-28">
        <UserRound className="w-3 h-3" /> Cliente
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md bg-surface-subtle text-ink shrink-0 w-28 truncate" title={item.actorName ?? undefined}>
      <User className="w-3 h-3 shrink-0" /> <span className="truncate">{item.actorName ?? 'Equipo'}</span>
    </span>
  );
}
