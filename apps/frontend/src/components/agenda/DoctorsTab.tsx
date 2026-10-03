'use client';
import { useEffect, useState } from 'react';
import { Plus, Pencil, Loader2, X, Trash2, CalendarClock, CalendarPlus, Copy, Send } from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { agendaApi } from '@/lib/api';
import { useAgendaSettings } from '@/hooks/useAgendaSettings';
import { Doctor, Shift, WEEKDAYS, WEEK_ORDER, hhmm, quarterOptions } from '@/lib/agenda';
import ModalPortal from '@/components/ui/ModalPortal';
import { Clinic, clinicName } from './useClinics';

const TIME_OPTIONS = quarterOptions(5 * 60, 23 * 60);

export default function DoctorsTab({ clinics }: { clinics: Clinic[] }) {
  const [doctors, setDoctors] = useState<Doctor[] | null>(null);
  const [editing, setEditing] = useState<Doctor | 'new' | null>(null);
  const [shiftsFor, setShiftsFor] = useState<Doctor | null>(null);
  const [calendarFor, setCalendarFor] = useState<Doctor | null>(null);

  async function load() {
    try {
      setDoctors(await agendaApi.doctors());
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudieron cargar los doctores');
      setDoctors([]);
    }
  }
  useEffect(() => { load(); }, []);

  if (!doctors) {
    return <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-ink-subtle" /></div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <button onClick={() => setEditing('new')} className="btn-primary">
          <Plus className="w-4 h-4" /> Nuevo doctor
        </button>
      </div>

      {doctors.length === 0 && (
        <div className="card p-8 text-center text-sm text-ink-muted">
          Todavía no hay doctores. Cargue a los doctores generales con el código que usa la clínica (Dr.02, Dra.03…).
        </div>
      )}

      {doctors.map((d) => (
        <div key={d.id} className={clsx('card p-4', !d.isActive && 'opacity-60')}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded-md bg-surface-subtle text-ink">{d.code}</span>
                <span className="font-semibold text-sm text-ink">{d.name}</span>
                {!d.isActive && <span className="badge bg-surface-subtle text-ink-muted">Inactivo</span>}
              </div>
              <p className="text-xs text-ink-subtle mt-1">
                {d.phone ? `WhatsApp +${d.phone}` : 'Sin WhatsApp: no recibe el resumen del día'}
              </p>
            </div>
            <div className="flex gap-1 shrink-0">
              <button onClick={() => setShiftsFor(d)} className="btn-secondary !px-3 !py-1.5 text-xs">
                <CalendarClock className="w-3.5 h-3.5" /> Turnos
              </button>
              {d.isActive && (
                <button onClick={() => setCalendarFor(d)} className="btn-ghost w-8 h-8 p-0" title="Calendario del doctor">
                  <CalendarPlus className="w-3.5 h-3.5" />
                </button>
              )}
              <button onClick={() => setEditing(d)} className="btn-ghost w-8 h-8 p-0" title="Editar">
                <Pencil className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {d.shifts.length === 0 && <span className="text-xs text-ink-subtle">Sin turnos: no aparece en ninguna agenda.</span>}
            {WEEK_ORDER.flatMap((wd) =>
              d.shifts
                .filter((s) => s.weekday === wd)
                .map((s, i) => (
                  <span key={`${wd}-${i}`} className="text-[11px] px-2 py-1 rounded-lg bg-surface-muted text-ink-muted">
                    <b className="text-ink font-medium">{WEEKDAYS[wd].slice(0, 3)}</b> {hhmm(s.startMinute)}–{hhmm(s.endMinute)} · {clinicName(clinics, s.channelAccountId)}
                  </span>
                )),
            )}
          </div>
        </div>
      ))}

      {editing && (
        <DoctorModal
          doctor={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
      {shiftsFor && (
        <ShiftsModal
          doctor={shiftsFor}
          clinics={clinics}
          onClose={() => setShiftsFor(null)}
          onSaved={() => { setShiftsFor(null); load(); }}
        />
      )}
      {calendarFor && <CalendarLinkModal doctor={calendarFor} onClose={() => setCalendarFor(null)} />}
    </div>
  );
}

/**
 * El enlace para que el doctor vea sus citas en su propio calendario (Google, iPhone,
 * Outlook). Lleva a /calendario/<clave>, donde el doctor toca el boton de su calendario
 * y acepta: se suscribe una vez y se actualiza solo. Se le manda por la linea de la
 * clinica, con la plantilla elegida en Avisos; sin plantilla, queda copiar el enlace.
 */
function CalendarLinkModal({ doctor, onClose }: { doctor: Doctor; onClose: () => void }) {
  const settings = useAgendaSettings();
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);

  async function send() {
    setSending(true);
    try {
      await agendaApi.sendCalendarLink(doctor.id);
      toast.success(`Enviado al WhatsApp de ${doctor.name}`);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo enviar');
    } finally {
      setSending(false);
    }
  }

  async function fetchLink(reset: boolean) {
    setBusy(true);
    try {
      const { token } = await agendaApi.calendarLink(doctor.id, reset);
      setUrl(`${window.location.origin}/calendario/${token}`);
      if (reset) toast.success('Enlace nuevo generado. El anterior ya no funciona.');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo obtener el enlace');
      if (!reset) onClose();
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => { fetchLink(false); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success('Enlace copiado');
    } catch {
      toast.error('No se pudo copiar. Selecciónelo y cópielo a mano.');
    }
  }

  function reset() {
    if (!confirm('¿Generar un enlace nuevo? El anterior deja de funcionar y el doctor tiene que suscribirse otra vez.')) return;
    fetchLink(true);
  }

  const cannotSend = !doctor.phone
    ? 'Este doctor no tiene WhatsApp cargado. Copie el enlace y páselo por donde prefiera.'
    : settings && !settings.doctorCalendarTemplateId
      ? 'Para enviarlo por WhatsApp, elija la plantilla “Calendario del doctor” en la pestaña Avisos. Mientras tanto puede copiar el enlace.'
      : null;

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-6">
        <div className="card w-full max-w-md p-6 my-4 space-y-3">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="text-base font-bold text-ink">Calendario de {doctor.code} · {doctor.name}</h2>
              <p className="text-xs text-ink-muted mt-0.5">
                Envíele este enlace al doctor: lo abre, elige su calendario (iPhone, Google u Outlook) y acepta. Lo hace una sola vez; las citas nuevas, movidas o canceladas se actualizan solas.
              </p>
            </div>
            <button onClick={onClose} className="btn-ghost w-8 h-8 p-0 shrink-0"><X className="w-4 h-4" /></button>
          </div>

          {!url ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-ink-subtle" /></div>
          ) : (
            <>
              {cannotSend ? (
                <p className="text-xs text-ink-muted rounded-lg bg-surface-muted p-3">{cannotSend}</p>
              ) : (
                <button onClick={send} disabled={sending || busy} className="btn-primary w-full">
                  {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Enviar al doctor por WhatsApp
                </button>
              )}
              <div className="flex gap-2">
                <input readOnly value={url} onFocus={(e) => e.target.select()} className="input font-mono text-xs" />
                <button onClick={copy} className="btn-secondary shrink-0"><Copy className="w-3.5 h-3.5" /> Copiar</button>
              </div>
              <p className="text-[11px] text-ink-subtle">
                Quien tenga el enlace ve el nombre de los pacientes y el motivo de cada cita. Páselo solo al doctor.
              </p>

              <details className="rounded-lg bg-surface-muted p-3 text-xs text-ink">
                <summary className="cursor-pointer font-medium">¿Cómo funciona?</summary>
                <div className="mt-2 space-y-2 text-ink-muted">
                  <p>El mensaje le llega al doctor desde el WhatsApp de la clínica, con un botón que abre el enlace.</p>
                  <p>
                    Google Calendar a veces no deja agregarlo desde el teléfono: en ese caso el doctor abre el mismo enlace desde una computadora y después lo ve también en el teléfono.
                  </p>
                  <p>
                    Google puede tardar varias horas en mostrar un cambio. Para las citas del mismo día, el doctor sigue teniendo el enlace que le llega cada mañana por WhatsApp.
                  </p>
                </div>
              </details>

              <div className="flex justify-between items-center pt-2">
                <button onClick={reset} disabled={busy} className="btn-ghost text-xs">
                  {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Generar enlace nuevo
                </button>
                <button onClick={onClose} className="btn-secondary">Cerrar</button>
              </div>
            </>
          )}
        </div>
      </div>
    </ModalPortal>
  );
}

function DoctorModal({ doctor, onClose, onSaved }: { doctor: Doctor | null; onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState(doctor?.code ?? '');
  const [name, setName] = useState(doctor?.name ?? '');
  const [phone, setPhone] = useState(doctor?.phone ? `+${doctor.phone}` : '');
  const [isActive, setIsActive] = useState(doctor?.isActive ?? true);
  const [saving, setSaving] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      if (doctor) await agendaApi.updateDoctor(doctor.id, { code, name, phone, isActive });
      else await agendaApi.createDoctor({ code, name, phone });
      toast.success(doctor ? 'Doctor actualizado' : 'Doctor agregado');
      onSaved();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-6">
        <form onSubmit={submit} className="card w-full max-w-md p-6 my-4 space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-ink">{doctor ? 'Editar doctor' : 'Nuevo doctor'}</h2>
            <button type="button" onClick={onClose} className="btn-ghost w-8 h-8 p-0"><X className="w-4 h-4" /></button>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="text-[11px] text-ink-subtle block mb-1">Código</label>
              <input required value={code} onChange={(e) => setCode(e.target.value)} placeholder="Dr.02" className="input" />
            </div>
            <div className="col-span-2">
              <label className="text-[11px] text-ink-subtle block mb-1">Nombre</label>
              <input required value={name} onChange={(e) => setName(e.target.value)} className="input" />
            </div>
          </div>
          <div>
            <label className="text-[11px] text-ink-subtle block mb-1">WhatsApp del doctor</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Número con código de país" className="input" />
            <p className="text-[11px] text-ink-subtle mt-1">Con código de país. Ahí le llega cada mañana el enlace a sus citas del día.</p>
          </div>
          {doctor && (
            <label className="flex items-start gap-2 cursor-pointer rounded-lg p-3 bg-surface-muted">
              <input type="checkbox" checked={!isActive} onChange={(e) => setIsActive(!e.target.checked)} className="w-3.5 h-3.5 mt-0.5" />
              <span className="text-xs text-ink">
                Ya no atiende
                <span className="block text-[11px] text-ink-subtle">
                  No se le asignan citas nuevas. Las que ya tiene siguen en la agenda.
                </span>
              </span>
            </label>
          )}
          <div className="flex gap-2 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancelar</button>
            <button type="submit" disabled={saving} className="btn-primary flex-1">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Guardar
            </button>
          </div>
        </form>
      </div>
    </ModalPortal>
  );
}

/**
 * El turno semanal del doctor, editado entero y guardado de una vez: asi lo pide el
 * backend, y asi se piensa ("los lunes esta en Villa Clarita, los martes en Zona 5").
 */
function ShiftsModal({
  doctor,
  clinics,
  onClose,
  onSaved,
}: {
  doctor: Doctor;
  clinics: Clinic[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [shifts, setShifts] = useState<Shift[]>(doctor.shifts.map(({ weekday, startMinute, endMinute, channelAccountId }) => ({ weekday, startMinute, endMinute, channelAccountId })));
  const [saving, setSaving] = useState(false);
  const firstClinic = clinics[0]?.id ?? '';

  function add(weekday: number) {
    const last = shifts.filter((s) => s.weekday === weekday).sort((a, b) => b.endMinute - a.endMinute)[0];
    const start = last ? Math.min(last.endMinute + 60, 22 * 60) : 8 * 60;
    setShifts([...shifts, { weekday, startMinute: start, endMinute: Math.min(start + 5 * 60, 23 * 60), channelAccountId: last?.channelAccountId ?? firstClinic }]);
  }

  function update(index: number, patch: Partial<Shift>) {
    setShifts(shifts.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  }

  /** Para los de planta: cargar el lunes una vez y repetirlo hasta el viernes. */
  function repeatMonday() {
    const monday = shifts.filter((s) => s.weekday === 1);
    if (monday.length === 0) {
      toast.error('Primero cargue el turno del lunes');
      return;
    }
    const others = shifts.filter((s) => s.weekday === 0 || s.weekday === 6 || s.weekday === 1);
    const copies = [2, 3, 4, 5].flatMap((wd) => monday.map((s) => ({ ...s, weekday: wd })));
    setShifts([...others, ...copies]);
  }

  async function save() {
    setSaving(true);
    try {
      await agendaApi.setShifts(doctor.id, shifts);
      toast.success('Turnos guardados');
      onSaved();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudieron guardar los turnos');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-6">
        <div className="card w-full max-w-2xl p-6 my-4">
          <div className="flex items-start justify-between mb-1">
            <div>
              <h2 className="text-base font-bold text-ink">Turnos de {doctor.code} · {doctor.name}</h2>
              <p className="text-xs text-ink-muted">Se repiten todas las semanas. Los cambios de un solo día se cargan en “Ausencias y cambios”.</p>
            </div>
            <button onClick={onClose} className="btn-ghost w-8 h-8 p-0"><X className="w-4 h-4" /></button>
          </div>

          <div className="flex justify-end my-3">
            <button onClick={repeatMonday} className="btn-ghost text-xs">
              <Copy className="w-3.5 h-3.5" /> Repetir el lunes de martes a viernes
            </button>
          </div>

          <div className="divide-y divide-border">
            {WEEK_ORDER.map((wd) => (
              <div key={wd} className="py-2.5 flex gap-3">
                <div className="w-24 shrink-0 text-sm font-medium text-ink pt-2">{WEEKDAYS[wd]}</div>
                <div className="flex-1 space-y-2">
                  {shifts.map((s, i) =>
                    s.weekday !== wd ? null : (
                      <div key={i} className="flex flex-wrap items-center gap-2">
                        <select value={s.channelAccountId} onChange={(e) => update(i, { channelAccountId: e.target.value })} className="input !w-auto !py-1.5 flex-1 min-w-[140px]">
                          {clinics.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                        </select>
                        <select value={s.startMinute} onChange={(e) => update(i, { startMinute: Number(e.target.value) })} className="input !w-auto !py-1.5">
                          {TIME_OPTIONS.map((m) => <option key={m} value={m}>{hhmm(m)}</option>)}
                        </select>
                        <span className="text-xs text-ink-subtle">a</span>
                        <select value={s.endMinute} onChange={(e) => update(i, { endMinute: Number(e.target.value) })} className="input !w-auto !py-1.5">
                          {TIME_OPTIONS.map((m) => <option key={m} value={m}>{hhmm(m)}</option>)}
                        </select>
                        <button onClick={() => setShifts(shifts.filter((_, j) => j !== i))} className="btn-ghost w-8 h-8 p-0" title="Quitar">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ),
                  )}
                  <button onClick={() => add(wd)} className="text-xs text-green-600 hover:underline pt-1">+ Agregar turno</button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-2 mt-5">
            <button onClick={onClose} className="btn-secondary flex-1">Cancelar</button>
            <button onClick={save} disabled={saving} className="btn-primary flex-1">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Guardar turnos
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}
