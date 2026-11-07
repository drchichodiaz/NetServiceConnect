'use client';
import { useEffect, useState } from 'react';
import { Loader2, Plane, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { agendaApi } from '@/lib/api';
import { DayAbsence, Doctor, hhmm, longDate, quarterOptions } from '@/lib/agenda';
import ModalPortal from '@/components/ui/ModalPortal';

const TIME_OPTIONS = quarterOptions(5 * 60, 24 * 60);

export interface AbsenceTarget {
  date: string;
  /** Sin doctor: se elige en el modal (botón "Ausencia" de la barra). */
  doctor?: { id: string; code: string; name: string };
  /** Con ausencia: se edita esa. */
  absence?: DayAbsence;
  /** Horario sugerido para una ausencia nueva de unas horas: el turno de ese día. */
  suggested?: { start: number; end: number };
}

/**
 * Marcar, cambiar o quitar una ausencia sin salir de la agenda. Es la misma ausencia de
 * "Doctores y turnos": el doctor falta en todas las clínicas, y las citas que ya tenía
 * en ese horario no se tocan (se avisa para que la recepción las mueva).
 */
export default function AbsenceModal({
  target,
  onClose,
  onSaved,
}: {
  target: AbsenceTarget;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = target.absence;
  const [doctors, setDoctors] = useState<Doctor[] | null>(null);
  const [doctorId, setDoctorId] = useState(target.doctor?.id ?? '');
  const [allDay, setAllDay] = useState(editing ? editing.allDay : true);
  const [start, setStart] = useState(editing && !editing.allDay ? editing.start : target.suggested?.start ?? 8 * 60);
  const [end, setEnd] = useState(editing && !editing.allDay ? editing.end : target.suggested?.end ?? 13 * 60);
  const [note, setNote] = useState(editing?.note ?? '');
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null);

  useEffect(() => {
    if (target.doctor) return;
    agendaApi.doctors()
      .then((list) => setDoctors(list.filter((d) => d.isActive)))
      .catch(() => { toast.error('No se pudo cargar la lista de doctores'); setDoctors([]); });
  }, [target.doctor]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && !busy) onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  function warnAffected(n: number) {
    if (n > 0) {
      toast(`Guardado. Ojo: tiene ${n} cita(s) en ese horario. Muévalas o páselas a otro doctor.`, { icon: '⚠️', duration: 8000 });
    } else {
      toast.success('Ausencia guardada');
    }
  }

  async function save() {
    if (!doctorId) {
      toast.error('Elija el doctor');
      return;
    }
    if (!allDay && end <= start) {
      toast.error('La hora de fin tiene que ser después de la de inicio');
      return;
    }
    setBusy('save');
    try {
      const hours = allDay ? {} : { startMinute: start, endMinute: end };
      const res = editing
        ? await agendaApi.updateException(editing.id, { allDay, ...hours, note })
        : await agendaApi.createException({ doctorId, date: target.date, kind: 'ABSENT', ...hours, note: note || undefined });
      warnAffected(res.affectedAppointments);
      onSaved();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo guardar la ausencia');
      setBusy(null);
    }
  }

  async function remove() {
    if (!editing) return;
    if (!confirm('¿Quitar esta ausencia? El doctor vuelve a quedar disponible en su turno.')) return;
    setBusy('delete');
    try {
      await agendaApi.deleteException(editing.id);
      toast.success('Ausencia quitada');
      onSaved();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo quitar la ausencia');
      setBusy(null);
    }
  }

  return (
    <ModalPortal>
      <div
        className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-6"
        onMouseDown={(e) => { if (e.target === e.currentTarget && !busy) onClose(); }}
      >
        <div className="card w-full max-w-md p-6 my-4 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-base font-bold text-ink flex items-center gap-2">
                <Plane className="w-4 h-4 text-ink-subtle" />
                {editing ? 'Ausencia' : 'Marcar ausencia'}
              </h2>
              <p className="text-xs text-ink-muted mt-0.5">{longDate(target.date)}</p>
            </div>
            <button onClick={onClose} className="btn-ghost w-8 h-8 p-0" title="Cerrar"><X className="w-4 h-4" /></button>
          </div>

          <div>
            <label className="text-[11px] text-ink-subtle block mb-1">Doctor</label>
            {target.doctor ? (
              <p className="text-sm text-ink">
                <span className="font-mono font-semibold">{target.doctor.code}</span> · {target.doctor.name}
              </p>
            ) : !doctors ? (
              <p className="text-xs text-ink-muted flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Cargando…</p>
            ) : (
              <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} className="input w-full text-sm">
                <option value="">Elegir…</option>
                {doctors.map((d) => <option key={d.id} value={d.id}>{d.code} · {d.name}</option>)}
              </select>
            )}
          </div>

          <div>
            <label className="text-[11px] text-ink-subtle block mb-1">Cuándo falta</label>
            <div className="flex rounded-lg border border-border overflow-hidden text-xs w-fit">
              <button type="button" onClick={() => setAllDay(true)} className={allDay ? 'px-3 py-1.5 bg-surface-subtle text-ink font-medium' : 'px-3 py-1.5 text-ink-muted hover:text-ink'}>
                Todo el día
              </button>
              <button type="button" onClick={() => setAllDay(false)} className={!allDay ? 'px-3 py-1.5 bg-surface-subtle text-ink font-medium' : 'px-3 py-1.5 text-ink-muted hover:text-ink'}>
                Unas horas
              </button>
            </div>
            {!allDay && (
              <div className="flex items-center gap-2 mt-2">
                <select value={start} onChange={(e) => setStart(Number(e.target.value))} className="input !w-auto text-sm">
                  {TIME_OPTIONS.slice(0, -1).map((m) => <option key={m} value={m}>{hhmm(m)}</option>)}
                </select>
                <span className="text-xs text-ink-muted">a</span>
                <select value={end} onChange={(e) => setEnd(Number(e.target.value))} className="input !w-auto text-sm">
                  {TIME_OPTIONS.slice(1).map((m) => <option key={m} value={m}>{hhmm(m)}</option>)}
                </select>
              </div>
            )}
          </div>

          <div>
            <label className="text-[11px] text-ink-subtle block mb-1">Motivo (opcional)</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Vacaciones, congreso, médico…" className="input w-full text-sm" />
          </div>

          <p className="text-[11px] text-ink-subtle">
            Falta en todas las clínicas: el bot no ofrece ese horario. Las citas que ya tenía no se cancelan solas.
          </p>

          <div className="flex items-center justify-between gap-2 pt-1">
            {editing ? (
              <button onClick={remove} disabled={!!busy} className="btn-ghost text-xs px-2.5 py-1.5 flex items-center gap-1.5 text-red-500 hover:text-red-600">
                {busy === 'delete' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                Quitar ausencia
              </button>
            ) : <span />}
            <div className="flex items-center gap-2">
              <button onClick={onClose} disabled={!!busy} className="btn-ghost text-xs px-3 py-1.5">Cancelar</button>
              <button onClick={save} disabled={!!busy} className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1.5">
                {busy === 'save' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Guardar
              </button>
            </div>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
