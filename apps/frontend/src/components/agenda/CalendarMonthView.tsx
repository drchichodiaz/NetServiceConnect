'use client';
import { useMemo } from 'react';
import { Calendar, Views } from 'react-big-calendar';
import 'react-big-calendar/lib/css/react-big-calendar.css';
import './calendar.css';
import clsx from 'clsx';
import { MonthDay, MonthSummary } from '@/lib/agenda';
import { localizer, wallAt, wallParts } from './calendar-time';

type CalEvent = { id: string; start: Date; end: Date; allDay: true; day: MonthDay };

/**
 * El mes de una clinica. No lista pacientes —con 30 o 40 citas por dia seria ilegible—:
 * cada dia dice cuantas citas tiene y que tan lleno esta, que es lo que se mira a esta
 * escala ("¿que dia de la semana que viene tiene lugar?"). Un clic lleva al dia.
 */
export default function CalendarMonthView({
  summary,
  today,
  onDrill,
}: {
  summary: MonthSummary;
  today: string;
  onDrill: (date: string) => void;
}) {
  const byDate = useMemo(() => new Map(summary.days.map((d) => [d.date, d])), [summary]);

  // Un "evento" por dia con citas: es la forma de pintar el resumen dentro de la casilla
  // sin reemplazar la grilla del mes de la libreria. Un dia abierto y sin citas queda en
  // blanco: repetir "0 citas" en todo el mes es ruido, y el blanco ya se lee como libre.
  const events: CalEvent[] = useMemo(
    () =>
      summary.days
        .filter((d) => d.appointments > 0)
        .map((d) => ({ id: d.date, start: wallAt(d.date, 0), end: wallAt(d.date, 0), allDay: true as const, day: d })),
    [summary],
  );

  return (
    <div className="rbc-agenda rbc-agenda-month p-4" style={{ minWidth: 7 * 110 }}>
      <Calendar
        localizer={localizer}
        culture="es"
        date={wallAt(`${summary.month}-01`, 0)}
        onNavigate={() => {}}
        view={Views.MONTH}
        onView={() => {}}
        views={[Views.MONTH]}
        toolbar={false}
        getNow={() => wallAt(today, 0)}
        events={events}
        popup={false}
        formats={{
          dateFormat: 'd',
          weekdayFormat: (d: Date) => {
            const text = d.toLocaleDateString('es', { weekday: 'short' });
            return text.charAt(0).toUpperCase() + text.slice(1);
          },
        }}
        components={{ event: DayBody }}
        eventPropGetter={(ev: CalEvent) => ({ className: clsx('rbc-ev-month', level(ev.day)) })}
        dayPropGetter={(d: Date) => {
          const day = byDate.get(wallParts(d).date);
          return { className: clsx(day && day.occupancy === null && day.appointments === 0 && 'rbc-closed') };
        }}
        selectable
        onSelectSlot={({ start }) => onDrill(wallParts(start as Date).date)}
        onSelectEvent={(ev: CalEvent) => onDrill(ev.day.date)}
        onDrillDown={(d: Date) => onDrill(wallParts(d).date)}
        drilldownView={Views.DAY}
      />
      <div className="flex flex-wrap gap-4 mt-3 text-[11px] text-ink-muted">
        <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded-sm border border-border bg-white" /> Sin citas</span>
        <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded-sm rbc-legend-low" /> Con lugar</span>
        <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded-sm rbc-legend-mid" /> Casi lleno (más de 70 %)</span>
        <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded-sm rbc-legend-full" /> Lleno (90 % o más)</span>
        <span className="flex items-center gap-1.5"><i className="w-3 h-3 rounded-sm rbc-legend-closed" /> Sin atención</span>
      </div>
    </div>
  );
}

function level(d: MonthDay) {
  if (d.occupancy === null) return 'rbc-occ-none';
  if (d.occupancy >= 0.9) return 'rbc-occ-full';
  if (d.occupancy > 0.7) return 'rbc-occ-mid';
  return 'rbc-occ-low';
}

function DayBody({ event }: { event: CalEvent }) {
  const d = event.day;
  return (
    <div className="leading-tight">
      <span className="block text-xs font-semibold">
        {d.appointments} {d.appointments === 1 ? 'cita' : 'citas'}
      </span>
      <span className="block text-[10px] opacity-80">
        {d.occupancy === null ? 'sin atención' : `${Math.round(d.occupancy * 100)} % lleno`}
      </span>
    </div>
  );
}
