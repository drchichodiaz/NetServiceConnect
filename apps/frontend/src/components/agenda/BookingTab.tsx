'use client';
import { useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { agendaApi } from '@/lib/api';
import { AgendaSettings } from '@/lib/agenda';
import { setAgendaSettingsCache } from '@/hooks/useAgendaSettings';

const DAYS = [3, 7, 14, 21, 30, 60];
const CUTOFF = [0, 2, 4, 12, 24, 48, 72];

const NOTICE = [
  { minutes: 0, label: 'Sin anticipación' },
  { minutes: 60, label: '1 hora' },
  { minutes: 120, label: '2 horas' },
  { minutes: 240, label: '4 horas' },
  { minutes: 720, label: '12 horas' },
  { minutes: 1440, label: '1 día' },
  { minutes: 2880, label: '2 días' },
];

/**
 * Lo que el paciente puede hacer solo por WhatsApp: reservar desde la opción "Agendar
 * cita" del bot, y cambiar o cancelar su cita desde el botón "Reprogramar" del recordatorio.
 */
export default function BookingTab({ settings }: { settings: AgendaSettings }) {
  const [form, setForm] = useState(settings);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const saved = await agendaApi.updateSettings({
        bookingDaysAhead: form.bookingDaysAhead,
        bookingMinNoticeMinutes: form.bookingMinNoticeMinutes,
        patientCanReschedule: form.patientCanReschedule,
        patientCanCancel: form.patientCanCancel,
        selfServiceCutoffHours: form.selfServiceCutoffHours,
      } as any);
      setForm(saved);
      setAgendaSettingsCache(saved);
      toast.success('Guardado');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }

  // Un valor guardado que no esta en la lista (cargado por API) se muestra igual.
  const days = DAYS.includes(form.bookingDaysAhead) ? DAYS : [...DAYS, form.bookingDaysAhead].sort((a, b) => a - b);
  const notice = NOTICE.some((n) => n.minutes === form.bookingMinNoticeMinutes)
    ? NOTICE
    : [...NOTICE, { minutes: form.bookingMinNoticeMinutes, label: `${form.bookingMinNoticeMinutes} minutos` }].sort((a, b) => a.minutes - b.minutes);
  const cutoff = CUTOFF.includes(form.selfServiceCutoffHours) ? CUTOFF : [...CUTOFF, form.selfServiceCutoffHours].sort((a, b) => a - b);
  const selfService = form.patientCanReschedule || form.patientCanCancel;

  return (
    <div className="space-y-5">
      <p className="text-sm text-ink-muted">
        Con la opción <b className="text-ink">Agendar cita</b> del menú del bot, el paciente elige día y hora entre los horarios
        libres de la clínica a la que escribe, y la cita queda en la agenda con el doctor que esté libre. La opción se agrega
        desde <Link href="/settings/bot" className="text-green-700 underline">Bot</Link>.
      </p>

      <div className="card p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label className="text-[11px] text-ink-subtle block mb-1">Días que se ofrecen</label>
          <select value={form.bookingDaysAhead} onChange={(e) => setForm({ ...form, bookingDaysAhead: Number(e.target.value) })} className="input">
            {days.map((d) => <option key={d} value={d}>{d === 1 ? 'Solo hoy' : `Los próximos ${d} días`}</option>)}
          </select>
        </div>
        <div>
          <label className="text-[11px] text-ink-subtle block mb-1">Anticipación mínima</label>
          <select value={form.bookingMinNoticeMinutes} onChange={(e) => setForm({ ...form, bookingMinNoticeMinutes: Number(e.target.value) })} className="input">
            {notice.map((n) => <option key={n.minutes} value={n.minutes}>{n.label}</option>)}
          </select>
          <p className="text-[11px] text-ink-subtle mt-1">No se ofrece un horario que empieza antes de esto.</p>
        </div>
      </div>

      <div className="card p-5 space-y-3">
        <div>
          <p className="text-sm font-semibold text-ink">Cuando el paciente toca “Reprogramar” en el recordatorio</p>
          <p className="text-xs text-ink-muted">
            Sin nada marcado, le escribe alguien de la clínica, como hasta ahora. Lo que se marque acá lo resuelve el
            bot, y la agenda muestra lo que hizo el paciente.
          </p>
        </div>
        {[
          {
            key: 'patientCanReschedule' as const,
            label: 'Puede elegir otro horario',
            help: 'Elige día y hora entre los libres, igual que al reservar. La cita se mueve, no se crea otra.',
          },
          {
            key: 'patientCanCancel' as const,
            label: 'Puede cancelar su cita',
            help: 'Con una confirmación antes. El horario queda libre en el momento.',
          },
        ].map((o) => (
          <label key={o.key} className="flex items-start gap-2 cursor-pointer rounded-lg p-3" style={{ background: 'var(--surface-muted)' }}>
            <input
              type="checkbox"
              checked={form[o.key]}
              onChange={(e) => setForm({ ...form, [o.key]: e.target.checked })}
              className="w-3.5 h-3.5 mt-0.5"
            />
            <span className="text-xs text-ink">
              {o.label}
              <span className="block text-[11px] text-ink-subtle">{o.help}</span>
            </span>
          </label>
        ))}
        {selfService && (
          <div className="sm:w-1/2">
            <label className="text-[11px] text-ink-subtle block mb-1">Hasta cuánto antes de la cita</label>
            <select value={form.selfServiceCutoffHours} onChange={(e) => setForm({ ...form, selfServiceCutoffHours: Number(e.target.value) })} className="input">
              {cutoff.map((h) => <option key={h} value={h}>{h === 0 ? 'Hasta que empiece' : `Hasta ${h} horas antes`}</option>)}
            </select>
            <p className="text-[11px] text-ink-subtle mt-1">Más cerca de la cita, le escribe alguien de la clínica.</p>
          </div>
        )}
        {selfService && !settings.reminderTemplateId && (
          <p className="text-[11px] text-amber-600">
            Hoy no se manda el recordatorio: elija su plantilla en la pestaña Avisos para que el paciente tenga el botón.
          </p>
        )}
      </div>

      <div className="flex justify-end">
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Guardar
        </button>
      </div>
    </div>
  );
}
