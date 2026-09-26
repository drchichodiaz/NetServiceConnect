'use client';
import { useEffect, useState } from 'react';
import { Loader2, X, Clock, Plus, CalendarClock, Ban, AlertTriangle, MessageCircle, Send } from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { agendaApi } from '@/lib/api';
import {
  Appointment,
  AppointmentStatus,
  FreeDoctor,
  STATUS_LABEL,
  clock,
  fromLocal,
  hhmm,
  longDate,
  patientLabel,
  quarterOptions,
  toLocal,
  todayIn,
} from '@/lib/agenda';
import ModalPortal from '@/components/ui/ModalPortal';

const TIME_OPTIONS = quarterOptions(6 * 60, 21 * 60);

/** Lo que la recepcion marca en el dia: en ese orden se usan. */
const STATUS_ACTIONS: AppointmentStatus[] = ['CONFIRMED', 'ARRIVED', 'DONE', 'NO_SHOW'];

export default function AppointmentPanel({
  appointment,
  timezone,
  onClose,
  onChanged,
}: {
  appointment: Appointment;
  timezone: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [appt, setAppt] = useState(appointment);
  const [busy, setBusy] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [clash, setClash] = useState<{ message: string; nextId?: string } | null>(null);
  const [warned, setWarned] = useState(false);

  const start = toLocal(appt.startsAt, timezone);
  const end = toLocal(appt.endsAt, timezone);
  const closed = appt.status === 'CANCELLED' || appt.status === 'DONE' || appt.status === 'NO_SHOW';

  async function run(key: string, fn: () => Promise<Appointment>, ok?: string) {
    setBusy(key);
    setClash(null);
    try {
      const next = await fn();
      setAppt(next);
      if (ok) toast.success(ok);
      onChanged();
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'No se pudo';
      if (key === 'extend' && err?.response?.status === 409) setClash({ message: msg, nextId: err?.response?.data?.nextAppointmentId });
      else toast.error(msg);
    } finally {
      setBusy(null);
    }
  }

  async function cancel() {
    if (!confirm('¿Cancelar la cita? El horario queda libre para otro paciente.')) return;
    await run('cancel', () => agendaApi.setAppointmentStatus(appt.id, 'CANCELLED'), 'Cita cancelada');
  }

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-6" onClick={onClose}>
        <div className="card w-full max-w-md p-6 my-4 space-y-4" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-bold text-ink">{patientLabel(appt.contact)}</h2>
              {appt.contact.name && appt.contact.phone && <p className="text-xs text-ink-subtle">+{appt.contact.phone}</p>}
            </div>
            <button onClick={onClose} className="btn-ghost w-8 h-8 p-0"><X className="w-4 h-4" /></button>
          </div>

          <div className="rounded-xl bg-surface-muted p-3 text-sm space-y-1">
            <p className="text-ink"><Clock className="w-3.5 h-3.5 inline mr-1.5 text-ink-subtle" />{longDate(start.date)}, {clock(start.minute)} – {clock(end.minute)}</p>
            <p className="text-ink-muted text-xs">Doctor <b className="font-mono text-ink">{appt.doctor?.code}</b> {appt.doctor?.name}</p>
            {appt.reason && <p className="text-ink-muted text-xs">Motivo: {appt.reason}</p>}
            {appt.notes && <p className="text-ink-muted text-xs whitespace-pre-wrap">{appt.notes}</p>}
            <p className="text-xs pt-1"><StatusChip status={appt.status} /></p>
            {appt.rescheduleRequestedAt && appt.status !== 'CANCELLED' && (
              <p className="text-xs text-amber-700 pt-1">El paciente pidió reprogramar.</p>
            )}
            <Notices appt={appt} />
          </div>

          {!closed && (
            <>
              <div>
                <p className="text-[11px] text-ink-subtle mb-1.5">Marcar como</p>
                <div className="grid grid-cols-4 gap-1.5">
                  {STATUS_ACTIONS.map((s) => (
                    <button
                      key={s}
                      disabled={!!busy || appt.status === s}
                      onClick={() => run(s, () => agendaApi.setAppointmentStatus(appt.id, s))}
                      className={clsx('text-xs rounded-lg py-2 border transition-colors', appt.status === s ? 'bg-green-50 border-green-300 text-green-700 font-medium' : 'border-border text-ink hover:bg-surface-muted')}
                    >
                      {busy === s ? <Loader2 className="w-3 h-3 animate-spin mx-auto" /> : STATUS_LABEL[s]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <button disabled={!!busy} onClick={() => run('extend', () => agendaApi.extendAppointment(appt.id), 'Se alargó 15 minutos')} className="btn-secondary !py-1.5 text-xs">
                  {busy === 'extend' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} 15 min
                </button>
                <button disabled={!!busy} onClick={() => setMoving(!moving)} className="btn-secondary !py-1.5 text-xs">
                  <CalendarClock className="w-3.5 h-3.5" /> Mover o cambiar doctor
                </button>
                <button disabled={!!busy} onClick={cancel} className="btn-ghost !py-1.5 text-xs text-red-500 hover:text-red-600">
                  <Ban className="w-3.5 h-3.5" /> Cancelar cita
                </button>
              </div>

              {clash && (
                <p className="text-xs text-amber-700 bg-amber-50 rounded-lg p-2.5 flex gap-2">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {clash.message}. No se puede alargar sin mover esa cita.
                </p>
              )}
              {clash?.nextId && (
                <button
                  disabled={!!busy || warned}
                  onClick={async () => {
                    setBusy('delay');
                    try {
                      await agendaApi.notifyDelay(clash.nextId!);
                      setWarned(true);
                      toast.success('Se le avisó al paciente que viene del atraso');
                    } catch (err: any) {
                      toast.error(err?.response?.data?.message || 'No se pudo avisar');
                    } finally {
                      setBusy(null);
                    }
                  }}
                  className="btn-secondary w-full !py-2 text-xs"
                >
                  {busy === 'delay' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                  {warned ? 'Aviso de atraso enviado' : 'Avisarle por WhatsApp del atraso al paciente que sigue'}
                </button>
              )}

              {moving && (
                <MoveForm
                  appt={appt}
                  timezone={timezone}
                  onMoved={(next) => { setAppt(next); setMoving(false); onChanged(); }}
                />
              )}
            </>
          )}

        </div>
      </div>
    </ModalPortal>
  );
}

function MoveForm({ appt, timezone, onMoved }: { appt: Appointment; timezone: string; onMoved: (a: Appointment) => void }) {
  const start = toLocal(appt.startsAt, timezone);
  const length = Math.round((new Date(appt.endsAt).getTime() - new Date(appt.startsAt).getTime()) / 60000);
  const [date, setDate] = useState(start.date);
  const [minute, setMinute] = useState(start.minute);
  const [doctorId, setDoctorId] = useState(appt.doctorId);
  const [free, setFree] = useState<FreeDoctor[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    setFree(null);
    agendaApi
      .freeDoctors({ channelAccountId: appt.channelAccountId, startsAt: fromLocal(date, minute, timezone), minutes: length, excludeAppointmentId: appt.id })
      .then((list) => alive && setFree(list))
      .catch(() => alive && setFree([]));
    return () => { alive = false; };
  }, [date, minute, appt.id, appt.channelAccountId, length, timezone]);

  const doctorFree = free?.some((d) => d.id === doctorId);

  async function save() {
    setSaving(true);
    try {
      const next = await agendaApi.updateAppointment(appt.id, {
        startsAt: fromLocal(date, minute, timezone),
        ...(doctorFree && { doctorId }),
      });
      toast.success(`Movida: ${longDate(date)} ${clock(minute)} con ${next.doctor?.code}`);
      onMoved(next);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo mover');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-xl border border-border p-3 space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <input type="date" value={date} min={todayIn(timezone)} onChange={(e) => setDate(e.target.value)} className="input !py-1.5" />
        <select value={minute} onChange={(e) => setMinute(Number(e.target.value))} className="input !py-1.5">
          {TIME_OPTIONS.map((m) => <option key={m} value={m}>{hhmm(m)}</option>)}
        </select>
      </div>
      {!free ? (
        <p className="text-xs text-ink-muted"><Loader2 className="w-3 h-3 inline animate-spin mr-1" /> Buscando doctores libres…</p>
      ) : free.length === 0 ? (
        <p className="text-xs text-amber-700">No hay doctores libres a esa hora en esta clínica.</p>
      ) : (
        <select value={doctorFree ? doctorId : ''} onChange={(e) => setDoctorId(e.target.value)} className="input !py-1.5 text-xs">
          {!doctorFree && <option value="">Asignar automáticamente ({free[0].code})</option>}
          {free.map((d) => <option key={d.id} value={d.id}>{d.code} · {d.name} ({d.appointmentsToday} citas)</option>)}
        </select>
      )}
      <p className="text-[11px] text-ink-subtle">Al cambiarle la hora, el paciente vuelve a recibir el recordatorio para el horario nuevo.</p>
      <button onClick={save} disabled={saving || !free || free.length === 0} className="btn-primary w-full !py-2 text-xs">
        {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Guardar cambio
      </button>
    </div>
  );
}

export function StatusChip({ status }: { status: AppointmentStatus }) {
  const styles: Record<AppointmentStatus, string> = {
    SCHEDULED: 'bg-surface-subtle text-ink-muted',
    CONFIRMED: 'bg-green-100 text-green-700',
    ARRIVED: 'bg-sky-100 text-sky-700',
    DONE: 'bg-gray-100 text-gray-500',
    NO_SHOW: 'bg-red-100 text-red-600',
    CANCELLED: 'bg-red-50 text-red-400 line-through',
  };
  return <span className={clsx('badge', styles[status])}>{STATUS_LABEL[status]}</span>;
}

/** Que avisos le llegaron al paciente, o por que no. */
function Notices({ appt }: { appt: Appointment }) {
  const lines: string[] = [];
  if (appt.confirmationSentAt) lines.push('Confirmación enviada');
  if (appt.reminderSentAt) lines.push('Recordatorio enviado');
  if (appt.confirmedAt && appt.status === 'CONFIRMED') lines.push('El paciente confirmó');
  if (!lines.length && !appt.notifyError) return null;
  return (
    <div className="pt-1 space-y-1">
      {lines.length > 0 && (
        <p className="text-[11px] text-ink-muted flex items-center gap-1.5">
          <MessageCircle className="w-3 h-3 text-green-600" /> {lines.join(' · ')}
        </p>
      )}
      {appt.notifyError && (
        <p className="text-[11px] text-red-600 flex items-start gap-1.5">
          <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" /> No se le pudo avisar: {appt.notifyError}
        </p>
      )}
    </div>
  );
}
