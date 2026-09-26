'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Calendar, Views, SlotInfo } from 'react-big-calendar';
import withDragAndDrop, { EventInteractionArgs } from 'react-big-calendar/lib/addons/dragAndDrop';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css';
import './calendar.css';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { agendaApi } from '@/lib/api';
import { AgendaDay, Appointment, clock, longDate, patientLabel } from '@/lib/agenda';
import { localizer, fromWall, wallAt, wallParts } from './calendar-time';
import { useOptimisticMoves } from './useOptimisticMoves';

const STEP = 15;
/**
 * Mas citas simultaneas que esto en un dia y ese dia se muestra por hora ("12 citas").
 * Con 10 doctores en paralelo, cada cita quedaba como una tira de 15 px sin nombre: no
 * se podia leer ni tocar. El detalle esta en la vista de dia, o filtrando por doctor.
 */
const MAX_PARALLEL = 3;

/**
 * Un color por doctor en la semana: sin columnas por doctor, es lo que permite ver de
 * un vistazo de quien es cada cita. Tonos distinguibles entre si y con texto oscuro legible.
 */
const DOCTOR_COLORS = [
  { bg: '#ecfdf3', border: '#22c55e' },
  { bg: '#eff6ff', border: '#3b82f6' },
  { bg: '#fdf4ff', border: '#c026d3' },
  { bg: '#fff7ed', border: '#f97316' },
  { bg: '#f0fdfa', border: '#14b8a6' },
  { bg: '#fef2f2', border: '#ef4444' },
  { bg: '#fefce8', border: '#ca8a04' },
  { bg: '#eef2ff', border: '#6366f1' },
];

type CalEvent = {
  id: string;
  start: Date;
  end: Date;
  title: string;
  kind: 'appointment' | 'summary';
  appointment?: Appointment;
  /** Solo en los resumenes por hora. */
  date?: string;
  color?: (typeof DOCTOR_COLORS)[number];
};

const DnDCalendar = withDragAndDrop<CalEvent>(Calendar as any);

// Afuera del componente por lo mismo que en la vista de dia: props estables para que un
// arrastre no redibuje todo en cada movimiento del mouse.
const VIEWS = [Views.WEEK];
const noop = () => {};
const FORMATS = {
  timeGutterFormat: 'HH:mm',
  dayFormat: (d: Date) => {
    const text = d.toLocaleDateString('es', { weekday: 'short', day: 'numeric' });
    return text.charAt(0).toUpperCase() + text.slice(1);
  },
  eventTimeRangeFormat: () => '',
};
const movable = (ev: CalEvent) =>
  ev.kind === 'appointment' && !['DONE', 'NO_SHOW', 'CANCELLED'].includes(ev.appointment!.status);
const eventProps = (ev: CalEvent) =>
  ev.kind === 'summary'
    ? { className: 'rbc-ev-summary' }
    : {
        className: clsx('rbc-ev-week', `rbc-wk-${ev.appointment!.status.toLowerCase()}`),
        style: { background: ev.color!.bg, borderColor: ev.color!.border },
      };

function EventBody({ event }: { event: CalEvent }) {
  if (event.kind === 'summary') {
    return <span className="block text-[11px] font-semibold leading-tight">{event.title}</span>;
  }
  const a = event.appointment!;
  return (
    <div className="leading-tight">
      <span className="block text-[10px] text-ink-subtle truncate">
        <b className="font-mono text-ink-muted">{a.doctor?.code}</b> · {clock(wallParts(event.start).minute)}
        {a.rescheduleRequestedAt && <span className="ml-1 text-amber-600 font-medium">· reprogramar</span>}
      </span>
      <span className="block text-[11px] font-medium truncate">{event.title}</span>
    </div>
  );
}
const COMPONENTS = { event: EventBody };

/** Cuantas citas se pisan como maximo en un dia (barrido por inicio y fin). */
function maxParallel(appts: { startMinute?: number; endMinute?: number }[]) {
  const edges = appts.flatMap((a) => [[a.startMinute!, 1], [a.endMinute!, -1]] as const);
  edges.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let now = 0, top = 0;
  for (const [, d] of edges) { now += d; top = Math.max(top, now); }
  return top;
}

function remembered(key: string) {
  try { return localStorage.getItem(key) ?? ''; } catch { return ''; }
}

/**
 * La semana de una clinica. Las citas de todos los doctores en una columna por dia, con
 * el codigo y el color del doctor. Rayado = a esa hora no atiende nadie en la clinica
 * (o, filtrando, ese doctor).
 *
 * Arrastrar una cita a otro dia u hora la mueve sin elegir doctor: se queda con el suyo
 * si esta libre y si no el sistema asigna otro, porque al paciente no le importa quien
 * lo atiende. Para cambiar de doctor a proposito esta la vista de dia.
 */
export default function CalendarWeekView({
  days,
  today,
  nowMinute,
  onSlot,
  onOpen,
  onDrill,
  onChanged,
}: {
  days: AgendaDay[];
  today: string;
  nowMinute: number;
  onSlot: (date: string, minute: number) => void;
  onOpen: (a: Appointment) => void;
  onDrill: (date: string) => void;
  onChanged: () => void;
}) {
  const tz = days[0]?.timezone ?? 'America/Panama';
  const slotMinutes = days[0]?.slotMinutes ?? 45;
  const byDate = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);

  const doctors = useMemo(() => {
    const map = new Map<string, { id: string; code: string; name: string }>();
    for (const d of days) for (const x of d.doctors) map.set(x.id, { id: x.id, code: x.code, name: x.name });
    return Array.from(map.values()).sort((a, b) => a.code.localeCompare(b.code));
  }, [days]);
  const [doctorId, setDoctorId] = useState('');
  useEffect(() => { setDoctorId(remembered('agenda.weekDoctor')); }, []);
  const pickDoctor = (id: string) => {
    setDoctorId(id);
    try { localStorage.setItem('agenda.weekDoctor', id); } catch { /* sin storage */ }
  };
  const filter = doctors.some((d) => d.id === doctorId) ? doctorId : '';

  // Colores estables: por codigo de doctor, en orden.
  const colorOf = useMemo(() => {
    const map = new Map<string, (typeof DOCTOR_COLORS)[number]>();
    doctors.forEach((d, i) => map.set(d.code, DOCTOR_COLORS[i % DOCTOR_COLORS.length]));
    return map;
  }, [doctors]);

  const { from, to } = useMemo(() => {
    const starts = days.flatMap((d) => [...d.doctors.flatMap((x) => x.windows.map((w) => w.start)), ...d.appointments.map((a) => a.startMinute!)]);
    const ends = days.flatMap((d) => [...d.doctors.flatMap((x) => x.windows.map((w) => w.end)), ...d.appointments.map((a) => a.endMinute!)]);
    const f = starts.length ? Math.floor(Math.min(...starts) / 60) * 60 : 8 * 60;
    const t = ends.length ? Math.ceil(Math.max(...ends) / 60) * 60 : 18 * 60;
    return { from: f, to: Math.min(Math.max(t, f + 60), 24 * 60 - 1) };
  }, [days]);

  const { baseEvents, denseDays } = useMemo(() => {
    const out: CalEvent[] = [];
    const dense: string[] = [];
    for (const d of days) {
      const appts = filter ? d.appointments.filter((a) => a.doctorId === filter) : d.appointments;
      if (!filter && maxParallel(appts) > MAX_PARALLEL) {
        dense.push(d.date);
        const perHour = new Map<number, number>();
        for (const a of appts) {
          const h = Math.floor(a.startMinute! / 60) * 60;
          perHour.set(h, (perHour.get(h) ?? 0) + 1);
        }
        perHour.forEach((n, h) =>
          out.push({
            id: `sum-${d.date}-${h}`,
            start: wallAt(d.date, Math.max(h, from)),
            end: wallAt(d.date, Math.min(h + 60, to)),
            title: `${n} ${n === 1 ? 'cita' : 'citas'}`,
            kind: 'summary',
            date: d.date,
          }),
        );
        continue;
      }
      for (const a of appts) {
        out.push({
          id: a.id,
          start: wallAt(d.date, a.startMinute!),
          end: wallAt(d.date, a.endMinute!),
          title: patientLabel(a.contact),
          kind: 'appointment',
          appointment: a,
          color: colorOf.get(a.doctor?.code ?? '') ?? DOCTOR_COLORS[0],
        });
      }
    }
    return { baseEvents: out, denseDays: dense };
  }, [days, filter, colorOf, from, to]);
  const { shown: events, begin, confirm, undo } = useOptimisticMoves(baseEvents, days);

  /** Si a esa hora de ese dia atiende alguien (o el doctor elegido) en la clinica. */
  const open = useCallback(
    (date: string, m: number) =>
      (byDate.get(date)?.doctors ?? []).some((d) => (!filter || d.id === filter) && d.windows.some((w) => w.start <= m && m < w.end)),
    [byDate, filter],
  );
  const bookable = useCallback((date: string, m: number) => date > today || (date === today && m + slotMinutes > nowMinute), [today, nowMinute, slotMinutes]);

  const move = useCallback(
    async (args: EventInteractionArgs<CalEvent>, resize: boolean) => {
      const ev = args.event;
      const a = ev.appointment;
      if (!a) return;
      const start = args.start as Date;
      const end = args.end as Date;
      if (start.getTime() === ev.start.getTime() && end.getTime() === ev.end.getTime()) return;

      begin(ev.id, start, end);
      try {
        const next = await agendaApi.updateAppointment(a.id, {
          startsAt: fromWall(start, tz),
          minutes: Math.round((end.getTime() - start.getTime()) / 60000),
          // Al alargar, el mismo doctor; al mover, el sistema decide (ver arriba).
          ...(resize && { doctorId: a.doctorId }),
        });
        confirm(ev.id);
        const when = wallParts(start);
        if (!resize && next.doctorId !== a.doctorId) {
          toast.success(`Movida al ${longDate(when.date).toLowerCase()} con ${next.doctor?.code}: ${a.doctor?.code} no estaba libre`);
        }
        onChanged();
      } catch (err: any) {
        undo(ev.id);
        toast.error(err?.response?.data?.message || 'No se pudo mover');
      }
    },
    [begin, confirm, undo, onChanged, tz],
  );
  const onDrop = useCallback((args: EventInteractionArgs<CalEvent>) => move(args, false), [move]);
  const onResize = useCallback((args: EventInteractionArgs<CalEvent>) => move(args, true), [move]);

  const slotProps = useCallback((d: Date) => {
    const { date, minute } = wallParts(d);
    return open(date, minute) ? {} : { className: 'rbc-off' };
  }, [open]);
  const onSelecting = useCallback(({ start }: { start: Date }) => {
    const { date, minute } = wallParts(start);
    return open(date, minute) && bookable(date, minute);
  }, [open, bookable]);
  const onSelectSlot = useCallback((slot: SlotInfo) => {
    const { date, minute } = wallParts(slot.start as Date);
    if (open(date, minute) && bookable(date, minute)) onSlot(date, minute);
  }, [open, bookable, onSlot]);
  const onSelectEvent = useCallback((ev: CalEvent) => {
    if (ev.kind === 'summary') onDrill(ev.date!);
    else onOpen(ev.appointment!);
  }, [onOpen, onDrill]);
  const onDrillDown = useCallback((d: Date) => onDrill(wallParts(d).date), [onDrill]);

  const monday = days[0]?.date ?? today;
  const weekDate = useMemo(() => wallAt(monday, 0), [monday]);
  const min = useMemo(() => wallAt(monday, from), [monday, from]);
  const max = useMemo(() => wallAt(monday, to), [monday, to]);
  const getNow = useCallback(() => wallAt(today, nowMinute), [today, nowMinute]);

  return (
    <div className="rbc-agenda rbc-agenda-week p-4" style={{ minWidth: 56 + 7 * 150 }}>
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <select value={filter} onChange={(e) => pickDoctor(e.target.value)} className="input !w-auto !py-1.5 text-xs">
          <option value="">Todos los doctores</option>
          {doctors.map((d) => <option key={d.id} value={d.id}>{d.code} · {d.name}</option>)}
        </select>
        {denseDays.length > 0 && (
          <p className="text-[11px] text-ink-muted">
            Los días con muchas citas a la vez se muestran por hora. Toque un bloque para ver el día, o elija un doctor.
          </p>
        )}
      </div>
      <DnDCalendar
        localizer={localizer}
        culture="es"
        date={weekDate}
        onNavigate={noop}
        view={Views.WEEK}
        onView={noop}
        views={VIEWS}
        toolbar={false}
        step={STEP}
        timeslots={4}
        min={min}
        max={max}
        getNow={getNow}
        events={events}
        formats={FORMATS}
        components={COMPONENTS}
        slotPropGetter={slotProps}
        eventPropGetter={eventProps}
        selectable
        onSelecting={onSelecting}
        onSelectSlot={onSelectSlot}
        onSelectEvent={onSelectEvent}
        onDrillDown={onDrillDown}
        drilldownView={Views.DAY}
        draggableAccessor={movable}
        resizableAccessor={movable}
        onEventDrop={onDrop}
        onEventResize={onResize}
        dayLayoutAlgorithm="no-overlap"
      />
    </div>
  );
}
