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
import { AgendaDay, Appointment, clock, longDate, patientLabel } from '@/lib/agenda';
import { localizer, fromWall, wallAt, wallParts } from './calendar-time';

const STEP = 15;

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

type CalEvent = { id: string; start: Date; end: Date; title: string; appointment: Appointment };

const DnDCalendar = withDragAndDrop<CalEvent>(Calendar as any);

/**
 * La semana de una clinica. Las citas de todos los doctores en una columna por dia, con
 * el codigo y el color del doctor. Rayado = a esa hora no atiende nadie en la clinica.
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

  // Colores estables: por codigo de doctor, en orden.
  const colorOf = useMemo(() => {
    const codes = Array.from(new Set(days.flatMap((d) => d.doctors.map((x) => x.code)))).sort();
    const map = new Map<string, (typeof DOCTOR_COLORS)[number]>();
    codes.forEach((c, i) => map.set(c, DOCTOR_COLORS[i % DOCTOR_COLORS.length]));
    return map;
  }, [days]);

  const { from, to } = useMemo(() => {
    const starts = days.flatMap((d) => [...d.doctors.flatMap((x) => x.windows.map((w) => w.start)), ...d.appointments.map((a) => a.startMinute!)]);
    const ends = days.flatMap((d) => [...d.doctors.flatMap((x) => x.windows.map((w) => w.end)), ...d.appointments.map((a) => a.endMinute!)]);
    const f = starts.length ? Math.floor(Math.min(...starts) / 60) * 60 : 8 * 60;
    const t = ends.length ? Math.ceil(Math.max(...ends) / 60) * 60 : 18 * 60;
    return { from: f, to: Math.min(Math.max(t, f + 60), 24 * 60 - 1) };
  }, [days]);

  const events: CalEvent[] = useMemo(
    () =>
      days.flatMap((d) =>
        d.appointments.map((a) => ({
          id: a.id,
          start: wallAt(d.date, a.startMinute!),
          end: wallAt(d.date, a.endMinute!),
          title: patientLabel(a.contact),
          appointment: a,
        })),
      ),
    [days],
  );

  /** Si a esa hora de ese dia atiende al menos un doctor en la clinica. */
  const open = (date: string, m: number) => (byDate.get(date)?.doctors ?? []).some((d) => d.windows.some((w) => w.start <= m && m < w.end));
  const bookable = (date: string, m: number) => date > today || (date === today && m + slotMinutes > nowMinute);

  async function move(args: EventInteractionArgs<CalEvent>, resize: boolean) {
    const a = args.event.appointment;
    const start = args.start as Date;
    const end = args.end as Date;
    try {
      const next = await agendaApi.updateAppointment(a.id, {
        startsAt: fromWall(start, tz),
        minutes: Math.round((end.getTime() - start.getTime()) / 60000),
        // Al alargar, el mismo doctor; al mover, el sistema decide (ver arriba).
        ...(resize && { doctorId: a.doctorId }),
      });
      const when = wallParts(start);
      toast.success(
        resize
          ? `Ahora termina a las ${clock(wallParts(end).minute)}`
          : `Movida al ${longDate(when.date).toLowerCase()}, ${clock(when.minute)}${next.doctorId !== a.doctorId ? ` con ${next.doctor?.code}` : ''}`,
      );
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo mover');
    } finally {
      onChanged();
    }
  }

  const movable = (ev: CalEvent) => !['DONE', 'NO_SHOW', 'CANCELLED'].includes(ev.appointment.status);
  const monday = days[0]?.date ?? today;

  return (
    <div className="rbc-agenda rbc-agenda-week p-4" style={{ minWidth: 56 + 7 * 150 }}>
      <DnDCalendar
        localizer={localizer}
        culture="es"
        date={wallAt(monday, 0)}
        onNavigate={() => {}}
        view={Views.WEEK}
        onView={() => {}}
        views={[Views.WEEK]}
        toolbar={false}
        step={STEP}
        timeslots={4}
        min={wallAt(monday, from)}
        max={wallAt(monday, to)}
        getNow={() => wallAt(today, nowMinute)}
        events={events}
        formats={{
          timeGutterFormat: 'HH:mm',
          dayFormat: (d: Date) => {
            const text = d.toLocaleDateString('es', { weekday: 'short', day: 'numeric' });
            return text.charAt(0).toUpperCase() + text.slice(1);
          },
          eventTimeRangeFormat: () => '',
        }}
        components={{ event: EventBody }}
        slotPropGetter={(d: Date) => {
          const { date, minute } = wallParts(d);
          return open(date, minute) ? {} : { className: 'rbc-off' };
        }}
        eventPropGetter={(ev: CalEvent) => {
          const c = colorOf.get(ev.appointment.doctor?.code ?? '') ?? DOCTOR_COLORS[0];
          return {
            className: clsx('rbc-ev-week', `rbc-wk-${ev.appointment.status.toLowerCase()}`),
            style: { background: c.bg, borderColor: c.border },
          };
        }}
        selectable
        onSelecting={({ start }: { start: Date }) => {
          const { date, minute } = wallParts(start);
          return open(date, minute) && bookable(date, minute);
        }}
        onSelectSlot={(slot: SlotInfo) => {
          const { date, minute } = wallParts(slot.start as Date);
          if (open(date, minute) && bookable(date, minute)) onSlot(date, minute);
        }}
        onSelectEvent={(ev: CalEvent) => onOpen(ev.appointment)}
        onDrillDown={(d: Date) => onDrill(wallParts(d).date)}
        drilldownView={Views.DAY}
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
  const a = event.appointment;
  return (
    <div className="leading-tight">
      <span className="block text-[10px] text-ink-subtle truncate">
        <b className="font-mono text-ink-muted">{a.doctor?.code}</b> · {clock(a.startMinute!)}
        {a.rescheduleRequestedAt && <span className="ml-1 text-amber-600 font-medium">· reprogramar</span>}
      </span>
      <span className="block text-[11px] font-medium truncate">{event.title}</span>
    </div>
  );
}
