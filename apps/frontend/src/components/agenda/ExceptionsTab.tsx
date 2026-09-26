'use client';
import { useEffect, useMemo, useState } from 'react';
import { Loader2, Trash2, Plane, ArrowRightLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import { agendaApi } from '@/lib/api';
import { Doctor, DoctorException, hhmm, longDate, quarterOptions, todayIn } from '@/lib/agenda';
import { Clinic, clinicName } from './useClinics';

const TIME_OPTIONS = quarterOptions(5 * 60, 24 * 60);

/**
 * Lo que cambia un solo dia: una ausencia (vacaciones, "fuera de clinica") o que ese
 * dia el doctor va a otra clinica. Reemplaza al evento "Fuera de clinica" que tapaba el
 * dia entero en el calendario compartido.
 */
export default function ExceptionsTab({ clinics, timezone }: { clinics: Clinic[]; timezone: string }) {
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [rows, setRows] = useState<DoctorException[] | null>(null);
  const today = todayIn(timezone);

  const [doctorId, setDoctorId] = useState('');
  const [date, setDate] = useState(today);
  const [kind, setKind] = useState<'ABSENT' | 'WORKS_AT'>('ABSENT');
  const [allDay, setAllDay] = useState(true);
  const [start, setStart] = useState(8 * 60);
  const [end, setEnd] = useState(13 * 60);
  const [clinicId, setClinicId] = useState(clinics[0]?.id ?? '');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  async function load() {
    try {
      const [docs, list] = await Promise.all([agendaApi.doctors(), agendaApi.exceptions({ from: today })]);
      setDoctors(docs.filter((d) => d.isActive));
      setRows(list);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo cargar');
      setRows([]);
    }
  }
  useEffect(() => { load(); }, []);

  const byDate = useMemo(() => {
    const map = new Map<string, DoctorException[]>();
    for (const r of rows ?? []) map.set(r.date, [...(map.get(r.date) ?? []), r]);
    return Array.from(map.entries());
  }, [rows]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!doctorId) {
      toast.error('Elija el doctor');
      return;
    }
    const withHours = kind === 'WORKS_AT' || !allDay;
    setSaving(true);
    try {
      const created = await agendaApi.createException({
        doctorId,
        date,
        kind,
        ...(withHours && { startMinute: start, endMinute: end }),
        ...(kind === 'WORKS_AT' && { channelAccountId: clinicId }),
        note: note || undefined,
      });
      if (created.affectedAppointments > 0) {
        toast(`Guardado. Ojo: tiene ${created.affectedAppointments} cita(s) en ese horario. Muévalas o páselas a otro doctor desde la agenda.`, { icon: '⚠️', duration: 8000 });
      } else {
        toast.success('Guardado');
      }
      setNote('');
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    if (!confirm('¿Quitar este cambio? El doctor vuelve a su turno de siempre ese día.')) return;
    try {
      await agendaApi.deleteException(id);
      setRows((r) => (r ?? []).filter((x) => x.id !== id));
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo quitar');
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={submit} className="card p-5 space-y-3">
        <div className="flex gap-2">
          {(['ABSENT', 'WORKS_AT'] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={kind === k ? 'btn-primary !py-1.5 text-xs' : 'btn-secondary !py-1.5 text-xs'}
            >
              {k === 'ABSENT' ? <><Plane className="w-3.5 h-3.5" /> Ausencia</> : <><ArrowRightLeft className="w-3.5 h-3.5" /> Va a otra clínica</>}
            </button>
          ))}
        </div>
        <p className="text-xs text-ink-muted">
          {kind === 'ABSENT'
            ? 'Vacaciones, un permiso o "fuera de clínica". Ese horario no se le da a ningún paciente.'
            : 'Ese día reemplaza su turno de siempre: atiende solo donde y cuando diga acá.'}
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] text-ink-subtle block mb-1">Doctor</label>
            <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} className="input">
              <option value="">Elegir…</option>
              {doctors.map((d) => <option key={d.id} value={d.id}>{d.code} · {d.name}</option>)}
            </select>
          </div>
          <div>
            <label className="text-[11px] text-ink-subtle block mb-1">Día</label>
            <input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} className="input" />
          </div>
        </div>

        {kind === 'ABSENT' && (
          <label className="flex items-center gap-2 text-xs text-ink cursor-pointer">
            <input type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} className="w-3.5 h-3.5" />
            El día entero
          </label>
        )}

        {(kind === 'WORKS_AT' || !allDay) && (
          <div className="flex flex-wrap items-end gap-2">
            {kind === 'WORKS_AT' && (
              <div className="flex-1 min-w-[160px]">
                <label className="text-[11px] text-ink-subtle block mb-1">Clínica</label>
                <select value={clinicId} onChange={(e) => setClinicId(e.target.value)} className="input">
                  {clinics.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="text-[11px] text-ink-subtle block mb-1">Desde</label>
              <select value={start} onChange={(e) => setStart(Number(e.target.value))} className="input !w-auto">
                {TIME_OPTIONS.map((m) => <option key={m} value={m}>{hhmm(m)}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[11px] text-ink-subtle block mb-1">Hasta</label>
              <select value={end} onChange={(e) => setEnd(Number(e.target.value))} className="input !w-auto">
                {TIME_OPTIONS.map((m) => <option key={m} value={m}>{hhmm(m)}</option>)}
              </select>
            </div>
          </div>
        )}

        <div>
          <label className="text-[11px] text-ink-subtle block mb-1">Nota (opcional)</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Vacaciones, congreso…" className="input" maxLength={200} />
        </div>

        <div className="flex justify-end">
          <button type="submit" disabled={saving} className="btn-primary">
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Guardar
          </button>
        </div>
      </form>

      <div>
        <h3 className="text-sm font-semibold text-ink mb-2">Próximos 60 días</h3>
        {!rows && <Loader2 className="w-5 h-5 animate-spin text-ink-subtle" />}
        {rows && rows.length === 0 && <p className="text-xs text-ink-subtle">No hay ausencias ni cambios cargados.</p>}
        <div className="space-y-3">
          {byDate.map(([d, list]) => (
            <div key={d} className="card p-3">
              <p className="text-xs font-semibold text-ink mb-2">{longDate(d)}</p>
              <div className="space-y-1.5">
                {list.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-3 text-xs">
                    <span className="text-ink">
                      <b className="font-mono">{r.doctor.code}</b>{' '}
                      {r.kind === 'ABSENT'
                        ? r.startMinute === null
                          ? 'ausente todo el día'
                          : `ausente de ${hhmm(r.startMinute)} a ${hhmm(r.endMinute!)}`
                        : `en ${clinicName(clinics, r.channelAccountId)} de ${hhmm(r.startMinute!)} a ${hhmm(r.endMinute!)}`}
                      {r.note && <span className="text-ink-subtle"> · {r.note}</span>}
                    </span>
                    <button onClick={() => remove(r.id)} className="btn-ghost w-7 h-7 p-0" title="Quitar">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
