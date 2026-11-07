'use client';
import { createContext, useCallback, useContext, useMemo } from 'react';
import { Calendar, Views, SlotInfo } from 'react-big-calendar';
import withDragAndDrop, { EventInteractionArgs } from 'react-big-calendar/lib/addons/dragAndDrop';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css';
import './calendar.css';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { agendaApi } from '@/lib/api';
import { AgendaDay, Appointment, DayAbsence, clock, hhmm, patientLabel, peakOverlap } from '@/lib/agenda';
import type { AbsenceTarget } from './AbsenceModal';
import { localizer, fromWall, wallAt, wallParts } from './calendar-time';
import { useOptimisticMoves } from './useOptimisticMoves';

const FREE = '__free';
const STEP = 15;

type Resource = { id: string; title: string; subtitle?: string; absentAllDay?: boolean };
type CalEvent = {
  id: string;
  start: Date;
  end: Date;
  resourceId: string;
  kind: 'appointment' | 'elsewhere' | 'free' | 'absent';
  title: string;
  appointment?: Appointment;
  absence?: DayAbsence;
};

/**
 * El encabezado de cada doctor es un componente fijo de la libreria (no recibe props
 * nuestras), asi que lo que necesita para abrir "Marcar ausencia" le llega por contexto.
 */
const HeaderActions = createContext<{ onHeader?: (doctorId: string) => void }>({});

const DnDCalendar = withDragAndDrop<CalEvent, Resource>(Calendar as any);

// Todo lo que no depende de los datos va afuera del componente. La libreria compara
// sus props por identidad: una funcion u objeto nuevo en cada render la obliga a
// redibujar todas las citas, y durante un arrastre eso pasa en cada movimiento del
// mouse. Era buena parte de lo que se sentia "pegajoso".
const VIEWS = [Views.DAY];
const noop = () => {};
const FORMATS = { timeGutterFormat: 'HH:mm', eventTimeRangeFormat: () => '' };
const resourceId = (r: Resource) => r.id;
const resourceTitle = (r: Resource) => r.title;
const eventResource = (e: CalEvent) => e.resourceId;
const movable = (ev: CalEvent) =>
  ev.kind === 'appointment' && !!ev.appointment && !['DONE', 'NO_SHOW', 'CANCELLED'].includes(ev.appointment.status);
const eventProps = (ev: CalEvent) => ({
  className: clsx(
    ev.kind === 'free' && 'rbc-ev-free',
    ev.kind === 'elsewhere' && 'rbc-ev-elsewhere',
    ev.kind === 'absent' && 'rbc-ev-absent',
    ev.kind === 'appointment' && `rbc-ev-appt rbc-st-${ev.appointment!.status.toLowerCase()}`,
  ),
});

function EventBody({ event }: { event: CalEvent }) {
  if (event.kind === 'free') return <span className="rbc-free-count">{event.title}</span>;
  if (event.kind === 'elsewhere') return <span className="text-[10px] text-ink-muted">En otra clínica</span>;
  if (event.kind === 'absent') {
    const a = event.absence!;
    return (
      <span className="block leading-tight">
        <span className="block text-[11px] font-semibold text-ink-muted">Ausente{a.allDay ? ' todo el día' : ` ${hhmm(a.start)}–${hhmm(a.end)}`}</span>
        {a.note && <span className="block text-[10px] text-ink-subtle truncate">{a.note}</span>}
      </span>
    );
  }
  const a = event.appointment!;
  return (
    <div className="leading-tight">
      <span className="block text-[10px] text-ink-subtle">
        {/* La hora sale del evento y no de la cita: recien soltada, todavia no volvio del servidor. */}
        {clock(wallParts(event.start).minute)}
        {a.rescheduleRequestedAt && <span className="ml-1 text-amber-600 font-medium">· pide reprogramar</span>}
      </span>
      <span className="block text-xs font-medium truncate">{event.title}</span>
      {a.reason && <span className="block text-[10px] text-ink-muted truncate">{a.reason}</span>}
    </div>
  );
}

function ResourceHeader({ resource }: { resource: Resource }) {
  const { onHeader } = useContext(HeaderActions);
  const body = (
    <>
      <span className="flex items-center gap-1.5 font-mono text-xs font-semibold text-ink">
        {resource.title}
        {resource.absentAllDay && (
          <span className="font-sans text-[10px] font-semibold rounded-full px-1.5 py-px" style={{ background: '#E5E7EB', color: '#4B5563' }}>Ausente</span>
        )}
      </span>
      {resource.subtitle && <span className="block text-[11px] font-normal text-ink-subtle truncate">{resource.subtitle}</span>}
    </>
  );
  if (!onHeader || resource.id === FREE) return <div className="text-left px-2 py-1">{body}</div>;
  return (
    <button
      type="button"
      onClick={() => onHeader(resource.id)}
      className="w-full text-left px-2 py-1 rounded hover:bg-surface-muted transition-colors"
      title="Marcar una ausencia de este doctor"
    >
      {body}
    </button>
  );
}

const COMPONENTS = { event: EventBody, resourceHeader: ResourceHeader };

/**
 * El dia de una clinica: una columna por doctor, rayado donde no atiende, "En otra
 * clinica" y, al final, cuantos doctores quedan libres para una cita que empiece en cada
 * cuarto de hora. Se puede arrastrar una cita para moverla o pasarsela a otro doctor, y
 * estirarla para alargarla.
 *
 * Arrastrar no decide nada: llama al mismo "mover" del backend, que valida turnos,
 * ausencias y choques. Si no se puede, la cita vuelve a su lugar con el motivo.
 */
export default function CalendarDayView({
  day,
  isPast,
  nowMinute,
  onSlot,
  onOpen,
  onChanged,
  onAbsence,
}: {
  day: AgendaDay;
  isPast: boolean;
  nowMinute: number | null;
  onSlot: (minute: number) => void;
  onOpen: (a: Appointment) => void;
  onChanged: () => void;
  /** Solo para quien puede administrar ausencias (coordinación). */
  onAbsence?: (target: Omit<AbsenceTarget, 'date'>) => void;
}) {
  const date = day.date;
  const tz = day.timezone;

  const { from, to } = useMemo(() => {
    // Con el turno sin la ausencia: si no, un doctor que falta toda la mañana achica la grilla.
    const spans = day.doctors.flatMap((d) => [...d.windows, ...(d.baseWindows ?? [])]);
    const starts = [...spans.map((w) => w.start), ...day.appointments.map((a) => a.startMinute!)];
    const ends = [...spans.map((w) => w.end), ...day.appointments.map((a) => a.endMinute!)];
    const f = starts.length ? Math.floor(Math.min(...starts) / 60) * 60 : 8 * 60;
    const t = ends.length ? Math.ceil(Math.max(...ends) / 60) * 60 : 18 * 60;
    // El calendario no admite un fin en la medianoche siguiente.
    return { from: f, to: Math.min(Math.max(t, f + 60), 24 * 60 - 1) };
  }, [day]);

  const bookable = useCallback((m: number) => !isPast && (nowMinute === null || m + day.slotMinutes > nowMinute), [isPast, nowMinute, day.slotMinutes]);
  const windowsByDoctor = useMemo(() => new Map(day.doctors.map((d) => [d.id, d.windows])), [day]);
  const inWindow = useCallback(
    (doctorId: string, m: number) => (windowsByDoctor.get(doctorId) ?? []).some((w) => w.start <= m && m < w.end),
    [windowsByDoctor],
  );

  const resources: Resource[] = useMemo(
    () => [
      ...day.doctors.map((d) => ({ id: d.id, title: d.code, subtitle: d.name, absentAllDay: (d.absences ?? []).some((a) => a.allDay) })),
      { id: FREE, title: 'Libres' },
    ],
    [day],
  );

  const baseEvents: CalEvent[] = useMemo(
    () =>
      day.appointments.map((a) => ({
        id: a.id,
        start: wallAt(date, a.startMinute!),
        end: wallAt(date, a.endMinute!),
        resourceId: a.doctorId,
        kind: 'appointment' as const,
        title: patientLabel(a.contact),
        appointment: a,
      })),
    [day, date],
  );
  const { shown: events, begin, confirm, undo } = useOptimisticMoves(baseEvents, day);

  // Detras de las citas: lo ocupado en otras clinicas y, en la ultima columna, cuantos
  // doctores pueden tomar una cita entera que empiece en cada cuarto de hora.
  const background: CalEvent[] = useMemo(() => {
    const out: CalEvent[] = [];
    for (const d of day.doctors) {
      // La ausencia en gris, recortada a lo que muestra la grilla. La del dia entero la
      // cubre toda: el doctor no esta en ningun horario.
      for (const a of d.absences ?? []) {
        const s = Math.max(a.allDay ? from : a.start, from);
        const e = Math.min(a.allDay ? to : a.end, to);
        if (e > s) out.push({ id: `absent-${a.id}`, start: wallAt(date, s), end: wallAt(date, e), resourceId: d.id, kind: 'absent', title: 'Ausente', absence: a });
      }
      d.busyElsewhere.forEach((b, i) =>
        out.push({ id: `else-${d.id}-${i}`, start: wallAt(date, b.start), end: wallAt(date, b.end), resourceId: d.id, kind: 'elsewhere', title: 'En otra clínica' }),
      );
    }
    const busy = new Map<string, { start: number; end: number }[]>();
    for (const d of day.doctors) busy.set(d.id, [...d.busyElsewhere]);
    for (const a of day.appointments) busy.get(a.doctorId)?.push({ start: a.startMinute!, end: a.endMinute! });
    for (let m = from; m < to; m += STEP) {
      if (!bookable(m)) continue;
      const slot = { start: m, end: m + day.slotMinutes };
      const n = day.doctors.filter(
        (d) => d.windows.some((w) => w.start <= slot.start && slot.end <= w.end) && peakOverlap(busy.get(d.id) ?? [], slot) < (d.maxConcurrent ?? 1),
      ).length;
      if (n > 0) out.push({ id: `free-${m}`, start: wallAt(date, m), end: wallAt(date, m + STEP), resourceId: FREE, kind: 'free', title: String(n) });
    }
    return out;
  }, [day, date, from, to, bookable]);

  const move = useCallback(
    async (args: EventInteractionArgs<CalEvent>, resize: boolean) => {
      const ev = args.event;
      const a = ev.appointment;
      if (!a) return;
      const start = args.start as Date;
      const end = args.end as Date;
      const target = (args.resourceId as string | undefined) ?? ev.resourceId;
      if (target === FREE) return;
      if (start.getTime() === ev.start.getTime() && end.getTime() === ev.end.getTime() && target === ev.resourceId) return;

      begin(ev.id, start, end, target);
      try {
        await agendaApi.updateAppointment(a.id, {
          startsAt: fromWall(start, tz),
          minutes: Math.round((end.getTime() - start.getTime()) / 60000),
          // Siempre explicito: al soltarla en un doctor, es ese doctor o ninguno. Sin esto
          // el backend podria reasignarla a otro libre, y no es lo que se arrastro.
          doctorId: resize ? a.doctorId : target,
        });
        confirm(ev.id);
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

  const slotProps = useCallback(
    (d: Date, rid?: string | number) => {
      if (rid === FREE) return { className: 'rbc-free-col' };
      if (!rid) return {};
      return inWindow(String(rid), wallParts(d).minute) ? {} : { className: 'rbc-off' };
    },
    [inWindow],
  );
  const onSelecting = useCallback(
    ({ start, resourceId: rid }: { start: Date; resourceId?: string | number }) => {
      const m = wallParts(start).minute;
      return rid !== FREE && !!rid && inWindow(String(rid), m) && bookable(m);
    },
    [inWindow, bookable],
  );
  const onSelectSlot = useCallback(
    (slot: SlotInfo) => {
      const m = wallParts(slot.start as Date).minute;
      if (slot.resourceId === FREE || !slot.resourceId) return;
      if (inWindow(String(slot.resourceId), m) && bookable(m)) onSlot(m);
    },
    [inWindow, bookable, onSlot],
  );
  const onSelectEvent = useCallback(
    (ev: CalEvent) => {
      if (ev.kind === 'appointment' && ev.appointment) onOpen(ev.appointment);
      if (ev.kind === 'free') onSlot(wallParts(ev.start).minute);
      if (ev.kind === 'absent' && ev.absence && onAbsence) {
        const d = day.doctors.find((x) => x.id === ev.resourceId);
        if (d) onAbsence({ doctor: { id: d.id, code: d.code, name: d.name }, absence: ev.absence });
      }
    },
    [onOpen, onSlot, onAbsence, day],
  );

  const headerActions = useMemo(
    () => ({
      onHeader: onAbsence
        ? (doctorId: string) => {
            const d = day.doctors.find((x) => x.id === doctorId);
            if (!d) return;
            // Si ya falta todo el dia, se abre esa ausencia en vez de cargar otra igual.
            const allDay = (d.absences ?? []).find((a) => a.allDay);
            const shift = d.baseWindows?.[0] ?? d.windows[0];
            onAbsence({
              doctor: { id: d.id, code: d.code, name: d.name },
              absence: allDay,
              suggested: shift ? { start: shift.start, end: shift.end } : undefined,
            });
          }
        : undefined,
    }),
    [onAbsence, day],
  );

  const dayDate = useMemo(() => wallAt(date, 0), [date]);
  const min = useMemo(() => wallAt(date, from), [date, from]);
  const max = useMemo(() => wallAt(date, to), [date, to]);
  const getNow = useCallback(() => (nowMinute !== null ? wallAt(date, nowMinute) : wallAt(date, -60)), [date, nowMinute]);

  return (
    <HeaderActions.Provider value={headerActions}>
    <div className="rbc-agenda rbc-agenda-day p-4" style={{ minWidth: 56 + 72 + day.doctors.length * 192 }}>
      <DnDCalendar
        localizer={localizer}
        culture="es"
        date={dayDate}
        onNavigate={noop}
        view={Views.DAY}
        onView={noop}
        views={VIEWS}
        toolbar={false}
        step={STEP}
        timeslots={4}
        min={min}
        max={max}
        getNow={getNow}
        events={events}
        backgroundEvents={background}
        resources={resources}
        resourceIdAccessor={resourceId}
        resourceTitleAccessor={resourceTitle}
        resourceAccessor={eventResource}
        formats={FORMATS}
        components={COMPONENTS}
        slotPropGetter={slotProps}
        eventPropGetter={eventProps}
        selectable
        onSelecting={onSelecting}
        onSelectSlot={onSelectSlot}
        onSelectEvent={onSelectEvent}
        draggableAccessor={movable}
        resizableAccessor={movable}
        onEventDrop={onDrop}
        onEventResize={onResize}
        dayLayoutAlgorithm="no-overlap"
      />
    </div>
    </HeaderActions.Provider>
  );
}
