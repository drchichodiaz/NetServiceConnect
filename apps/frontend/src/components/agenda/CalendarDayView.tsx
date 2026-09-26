'use client';
import { useMemo } from 'react';
import { Calendar, Views, SlotInfo } from 'react-big-calendar';
import withDragAndDrop, { EventInteractionArgs } from 'react-big-calendar/lib/addons/dragAndDrop';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import 'react-big-calendar/lib/addons/dragAndDrop/styles.css';
import './calendar.css';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { agendaApi } from '@/lib/api';
import { AgendaDay, Appointment, clock, overlaps, patientLabel } from '@/lib/agenda';
import { localizer, fromWall, wallAt, wallParts } from './calendar-time';

const FREE = '__free';
const STEP = 15;

type Resource = { id: string; title: string; subtitle?: string };
type CalEvent = {
  id: string;
  start: Date;
  end: Date;
  resourceId: string;
  kind: 'appointment' | 'elsewhere' | 'free';
  title: string;
  appointment?: Appointment;
};

const DnDCalendar = withDragAndDrop<CalEvent, Resource>(Calendar as any);

/**
 * El dia de una clinica: una columna por doctor, rayado donde no atiende, "En otra
 * clinica" y, al final, cuantos doctores quedan libres para una cita que empiece en cada
 * cuarto de hora. Se puede arrastrar una cita para moverla o pasarsela a otro doctor, y
 * estirarla para alargarla.
 *
 * Arrastrar no decide nada: llama al mismo "mover" del backend, que valida turnos,
 * ausencias y choques. Si no se puede, el calendario vuelve a pintar el dia como estaba.
 */
export default function CalendarDayView({
  day,
  isPast,
  nowMinute,
  onSlot,
  onOpen,
  onChanged,
}: {
  day: AgendaDay;
  isPast: boolean;
  nowMinute: number | null;
  onSlot: (minute: number) => void;
  onOpen: (a: Appointment) => void;
  onChanged: () => void;
}) {
  const date = day.date;
  const tz = day.timezone;

  const { from, to } = useMemo(() => {
    const starts = [...day.doctors.flatMap((d) => d.windows.map((w) => w.start)), ...day.appointments.map((a) => a.startMinute!)];
    const ends = [...day.doctors.flatMap((d) => d.windows.map((w) => w.end)), ...day.appointments.map((a) => a.endMinute!)];
    const f = starts.length ? Math.floor(Math.min(...starts) / 60) * 60 : 8 * 60;
    const t = ends.length ? Math.ceil(Math.max(...ends) / 60) * 60 : 18 * 60;
    // El calendario no admite un fin en la medianoche siguiente.
    return { from: f, to: Math.min(Math.max(t, f + 60), 24 * 60 - 1) };
  }, [day]);

  const bookable = (m: number) => !isPast && (nowMinute === null || m + day.slotMinutes > nowMinute);
  const windowsOf = (doctorId: string) => day.doctors.find((d) => d.id === doctorId)?.windows ?? [];
  const inWindow = (doctorId: string, m: number) => windowsOf(doctorId).some((w) => w.start <= m && m < w.end);

  const resources: Resource[] = useMemo(
    () => [
      ...day.doctors.map((d) => ({ id: d.id, title: d.code, subtitle: d.name })),
      { id: FREE, title: 'Libres' },
    ],
    [day],
  );

  const events: CalEvent[] = useMemo(
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

  // Detras de las citas: lo ocupado en otras clinicas y, en la ultima columna, cuantos
  // doctores pueden tomar una cita entera que empiece en cada cuarto de hora.
  const background: CalEvent[] = useMemo(() => {
    const out: CalEvent[] = [];
    for (const d of day.doctors) {
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
        (d) => d.windows.some((w) => w.start <= slot.start && slot.end <= w.end) && !(busy.get(d.id) ?? []).some((b) => overlaps(b, slot)),
      ).length;
      if (n > 0) out.push({ id: `free-${m}`, start: wallAt(date, m), end: wallAt(date, m + STEP), resourceId: FREE, kind: 'free', title: String(n) });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [day, date, from, to, nowMinute, isPast]);

  async function move(args: EventInteractionArgs<CalEvent>, resize: boolean) {
    const ev = args.event;
    const a = ev.appointment;
    if (!a) return;
    const start = args.start as Date;
    const end = args.end as Date;
    const target = (args.resourceId as string | undefined) ?? ev.resourceId;
    if (target === FREE) return;
    const minutes = Math.round((end.getTime() - start.getTime()) / 60000);
    try {
      await agendaApi.updateAppointment(a.id, {
        startsAt: fromWall(start, tz),
        minutes,
        // Siempre explicito: al soltarla en un doctor, es ese doctor o ninguno. Sin esto
        // el backend podria reasignarla a otro libre, y no es lo que se arrastro.
        doctorId: resize ? a.doctorId : target,
      });
      toast.success(resize ? `Ahora termina a las ${clock(wallParts(end).minute)}` : `Movida a las ${clock(wallParts(start).minute)}`);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo mover');
    } finally {
      onChanged();
    }
  }

  const movable = (ev: CalEvent) =>
    ev.kind === 'appointment' && !!ev.appointment && !['DONE', 'NO_SHOW', 'CANCELLED'].includes(ev.appointment.status);

  return (
    <div className="rbc-agenda rbc-agenda-day p-4" style={{ minWidth: 56 + 72 + day.doctors.length * 192 }}>
      <DnDCalendar
        localizer={localizer}
        culture="es"
        date={wallAt(date, 0)}
        onNavigate={() => {}}
        view={Views.DAY}
        onView={() => {}}
        views={[Views.DAY]}
        toolbar={false}
        step={STEP}
        timeslots={4}
        min={wallAt(date, from)}
        max={wallAt(date, to)}
        getNow={() => (nowMinute !== null ? wallAt(date, nowMinute) : wallAt(date, -60))}
        events={events}
        backgroundEvents={background}
        resources={resources}
        resourceIdAccessor={(r: Resource) => r.id}
        resourceTitleAccessor={(r: Resource) => r.title}
        resourceAccessor={(e: CalEvent) => e.resourceId}
        formats={{ timeGutterFormat: 'HH:mm', eventTimeRangeFormat: () => '' }}
        components={{
          event: EventBody,
          resourceHeader: ({ resource }: { resource: Resource }) => (
            <div className="text-left px-2 py-1">
              <span className="block font-mono text-xs font-semibold text-ink">{resource.title}</span>
              {resource.subtitle && <span className="block text-[11px] font-normal text-ink-subtle truncate">{resource.subtitle}</span>}
            </div>
          ),
        }}
        slotPropGetter={(d: Date, resourceId?: string | number) => {
          if (resourceId === FREE) return { className: 'rbc-free-col' };
          if (!resourceId) return {};
          const m = wallParts(d).minute;
          return inWindow(String(resourceId), m) ? {} : { className: 'rbc-off' };
        }}
        eventPropGetter={(ev: CalEvent) => ({
          className: clsx(
            ev.kind === 'free' && 'rbc-ev-free',
            ev.kind === 'elsewhere' && 'rbc-ev-elsewhere',
            ev.kind === 'appointment' && `rbc-ev-appt rbc-st-${ev.appointment!.status.toLowerCase()}`,
          ),
        })}
        selectable
        onSelecting={({ start, resourceId }: { start: Date; resourceId?: string | number }) => {
          const m = wallParts(start).minute;
          return resourceId !== FREE && !!resourceId && inWindow(String(resourceId), m) && bookable(m);
        }}
        onSelectSlot={(slot: SlotInfo) => {
          const m = wallParts(slot.start as Date).minute;
          if (slot.resourceId === FREE || !slot.resourceId) return;
          if (inWindow(String(slot.resourceId), m) && bookable(m)) onSlot(m);
        }}
        onSelectEvent={(ev: CalEvent) => {
          if (ev.kind === 'appointment' && ev.appointment) onOpen(ev.appointment);
          if (ev.kind === 'free') onSlot(wallParts(ev.start).minute);
        }}
        draggableAccessor={movable}
        resizableAccessor={movable}
        onEventDrop={(args) => move(args, false)}
        onEventResize={(args) => move(args, true)}
        dayLayoutAlgorithm="no-overlap"
      />
    </div>
  );
}

function EventBody({ event }: { event: CalEvent }) {
  if (event.kind === 'free') return <span className="rbc-free-count">{event.title}</span>;
  if (event.kind === 'elsewhere') return <span className="text-[10px] text-ink-muted">En otra clínica</span>;
  const a = event.appointment!;
  return (
    <div className="leading-tight">
      <span className="block text-[10px] text-ink-subtle">
        {clock(a.startMinute!)}
        {a.rescheduleRequestedAt && <span className="ml-1 text-amber-600 font-medium">· pide reprogramar</span>}
      </span>
      <span className="block text-xs font-medium truncate">{event.title}</span>
      {a.reason && <span className="block text-[10px] text-ink-muted truncate">{a.reason}</span>}
    </div>
  );
}
