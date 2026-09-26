'use client';
import { useEffect, useRef, useState } from 'react';
import { Loader2, X, Search, UserPlus, Stethoscope, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { agendaApi, contactsApi } from '@/lib/api';
import { Appointment, FreeDoctor, clock, fromLocal, hhmm, longDate, nextBookable, patientLabel, quarterOptions, todayIn } from '@/lib/agenda';
import ModalPortal from '@/components/ui/ModalPortal';
import { Clinic } from './useClinics';

type Patient = { id: string; name: string | null; phone: string | null };

const TIME_OPTIONS = quarterOptions(6 * 60, 21 * 60);

/**
 * Crear una cita. Se abre desde un horario libre de la grilla o desde una conversacion
 * (con el paciente ya cargado, que es lo que evita que falte el telefono).
 *
 * La recepcion elige clinica, dia y hora; el doctor lo propone el sistema (el libre con
 * menos citas ese dia) y se puede cambiar por otro de los libres.
 */
export default function CreateAppointmentModal({
  clinics,
  timezone,
  slotMinutes,
  initial,
  onClose,
  onCreated,
}: {
  clinics: Clinic[];
  timezone: string;
  slotMinutes: number;
  initial: { channelAccountId?: string; date?: string; minute?: number; patient?: Patient };
  onClose: () => void;
  onCreated: (appt: Appointment) => void;
}) {
  const today = todayIn(timezone);
  const fallback = nextBookable(timezone);
  const [clinicId, setClinicId] = useState(initial.channelAccountId && clinics.some((c) => c.id === initial.channelAccountId) ? initial.channelAccountId : clinics[0]?.id ?? '');
  const [date, setDate] = useState(initial.minute !== undefined ? initial.date ?? today : fallback.date);
  const [minute, setMinute] = useState(initial.minute ?? fallback.minute);
  const [minutes, setMinutes] = useState(slotMinutes);
  const [patient, setPatient] = useState<Patient | null>(initial.patient ?? null);
  const [mode, setMode] = useState<'search' | 'new'>('search');
  const [phone, setPhone] = useState('');
  const [name, setName] = useState('');
  const [reason, setReason] = useState('');
  const [notes, setNotes] = useState('');
  const [free, setFree] = useState<FreeDoctor[] | null>(null);
  const [doctorId, setDoctorId] = useState('');
  const [saving, setSaving] = useState(false);
  const [recheck, setRecheck] = useState(0);

  // Quien esta libre, cada vez que cambia el horario.
  useEffect(() => {
    if (!clinicId || !date) return;
    let alive = true;
    setFree(null);
    agendaApi
      .freeDoctors({ channelAccountId: clinicId, startsAt: fromLocal(date, minute, timezone), minutes })
      .then((list) => {
        if (!alive) return;
        setFree(list);
        if (doctorId && !list.some((d) => d.id === doctorId)) setDoctorId('');
      })
      .catch(() => alive && setFree([]));
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clinicId, date, minute, minutes, timezone, recheck]);

  const assigned = doctorId ? free?.find((d) => d.id === doctorId) : free?.[0];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!patient && mode === 'search') {
      toast.error('Elija el paciente, o cárguelo como nuevo');
      return;
    }
    setSaving(true);
    try {
      const appt = await agendaApi.createAppointment({
        channelAccountId: clinicId,
        startsAt: fromLocal(date, minute, timezone),
        minutes,
        ...(patient ? { contactId: patient.id } : { phone, name: name || undefined }),
        ...(doctorId && { doctorId }),
        reason: reason || undefined,
        notes: notes || undefined,
      });
      toast.success(`Cita agendada con ${appt.doctor?.code ?? 'el doctor'} · ${longDate(date)} ${clock(minute)}`);
      onCreated(appt);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo agendar');
      // Si alguien tomo el horario mientras tanto, se vuelve a preguntar quien queda libre.
      if (err?.response?.status === 409) setRecheck((n) => n + 1);
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-6">
        <form onSubmit={submit} className="card w-full max-w-lg p-6 my-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-ink">Crear cita</h2>
            <button type="button" onClick={onClose} className="btn-ghost w-8 h-8 p-0"><X className="w-4 h-4" /></button>
          </div>

          {/* Paciente */}
          <div>
            <label className="text-[11px] text-ink-subtle block mb-1">Paciente</label>
            {patient ? (
              <div className="flex items-center justify-between rounded-xl border border-border px-3.5 py-2.5">
                <div className="text-sm">
                  <span className="font-medium text-ink">{patientLabel(patient)}</span>
                  {patient.name && patient.phone && <span className="text-ink-subtle"> · +{patient.phone}</span>}
                </div>
                {!initial.patient && (
                  <button type="button" onClick={() => setPatient(null)} className="text-xs text-ink-muted hover:text-ink">Cambiar</button>
                )}
              </div>
            ) : (
              <>
                <div className="flex gap-1 mb-2">
                  <button type="button" onClick={() => setMode('search')} className={clsx('text-xs px-2.5 py-1 rounded-lg', mode === 'search' ? 'bg-surface-subtle text-ink font-medium' : 'text-ink-muted')}>
                    <Search className="w-3 h-3 inline mr-1" />Buscar
                  </button>
                  <button type="button" onClick={() => setMode('new')} className={clsx('text-xs px-2.5 py-1 rounded-lg', mode === 'new' ? 'bg-surface-subtle text-ink font-medium' : 'text-ink-muted')}>
                    <UserPlus className="w-3 h-3 inline mr-1" />Paciente nuevo
                  </button>
                </div>
                {mode === 'search' ? (
                  <PatientSearch onPick={setPatient} />
                ) : (
                  <div className="grid grid-cols-2 gap-2">
                    <input required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="WhatsApp con código de país" className="input" />
                    <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Nombre" className="input" />
                  </div>
                )}
              </>
            )}
          </div>

          {/* Cuando y donde */}
          <div className="grid grid-cols-2 gap-3">
            {clinics.length > 1 && (
              <div className="col-span-2">
                <label className="text-[11px] text-ink-subtle block mb-1">Clínica</label>
                <select value={clinicId} onChange={(e) => setClinicId(e.target.value)} className="input">
                  {clinics.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="text-[11px] text-ink-subtle block mb-1">Día</label>
              <input type="date" required value={date} min={today} onChange={(e) => setDate(e.target.value)} className="input" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[11px] text-ink-subtle block mb-1">Hora</label>
                <select value={minute} onChange={(e) => setMinute(Number(e.target.value))} className="input !px-2">
                  {TIME_OPTIONS.map((m) => <option key={m} value={m}>{hhmm(m)}</option>)}
                </select>
              </div>
              <div>
                <label className="text-[11px] text-ink-subtle block mb-1">Dura</label>
                <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="input !px-2">
                  {[15, 30, 45, 60, 75, 90, 120].map((m) => <option key={m} value={m}>{m} min</option>)}
                </select>
              </div>
            </div>
          </div>

          {/* Doctor */}
          <div className="rounded-xl p-3 bg-surface-muted">
            {!free ? (
              <p className="text-xs text-ink-muted flex items-center gap-2"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Buscando doctores libres…</p>
            ) : free.length === 0 ? (
              <p className="text-xs text-amber-700 flex items-center gap-2">
                <AlertTriangle className="w-3.5 h-3.5" /> No hay doctores libres en esta clínica a esa hora. Pruebe otro horario.
              </p>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs text-ink flex items-start gap-2 min-w-0">
                  <Stethoscope className="w-3.5 h-3.5 text-green-600 shrink-0 mt-0.5" />
                  <div className="min-w-0">
                    <p className="truncate">Doctor: <b className="font-mono">{assigned?.code}</b> {assigned?.name}</p>
                    {!doctorId && <p className="text-ink-subtle">El libre con menos citas ese día</p>}
                  </div>
                </div>
                {free.length > 1 && (
                  <select value={doctorId} onChange={(e) => setDoctorId(e.target.value)} className="input !w-auto !py-1 !px-2 text-xs">
                    <option value="">Automático</option>
                    {free.map((d) => <option key={d.id} value={d.id}>{d.code} · {d.appointmentsToday} citas</option>)}
                  </select>
                )}
              </div>
            )}
          </div>

          <div className="space-y-2">
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motivo (limpieza, evaluación…)" className="input" maxLength={200} />
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notas para la clínica (opcional)" className="input min-h-[60px]" maxLength={1000} />
          </div>

          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancelar</button>
            <button type="submit" disabled={saving || !free || free.length === 0} className="btn-primary flex-1">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Agendar
            </button>
          </div>
        </form>
      </div>
    </ModalPortal>
  );
}

function PatientSearch({ onPick }: { onPick: (p: Patient) => void }) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Patient[] | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    clearTimeout(timer.current);
    if (q.trim().length < 2) {
      setResults(null);
      return;
    }
    timer.current = setTimeout(() => {
      contactsApi
        .list(q.trim())
        .then((rows: any) => {
          const list = Array.isArray(rows) ? rows : rows?.data ?? rows?.items ?? [];
          // Solo los que tienen WhatsApp: sin telefono no hay a quien avisarle.
          setResults(list.filter((c: any) => c.phone).slice(0, 8));
        })
        .catch(() => setResults([]));
    }, 250);
    return () => clearTimeout(timer.current);
  }, [q]);

  return (
    <div className="relative">
      <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nombre o teléfono" className="input" />
      {results && (
        <div className="absolute left-0 right-0 mt-1 card p-1 z-10 max-h-56 overflow-y-auto">
          {results.length === 0 && <p className="text-xs text-ink-subtle p-2">Nadie con ese nombre o teléfono. Use “Paciente nuevo”.</p>}
          {results.map((c) => (
            <button key={c.id} type="button" onClick={() => onPick(c)} className="w-full text-left px-3 py-2 rounded-lg hover:bg-surface-muted text-sm">
              <span className="text-ink">{patientLabel(c)}</span>
              {c.name && <span className="text-ink-subtle text-xs"> · +{c.phone}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
