'use client';
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, Clock, HelpCircle, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';
import { agendaApi } from '@/lib/api';
import { ClinicCalendar, GoogleSyncStatus } from '@/lib/agenda';

/** Cada cuanto se vuelve a pedir el estado: el mismo paso con que Connect escribe en Google. */
const STATUS_MS = 15_000;
/** Connect revisa cada 15 segundos: sin revisar hace mas que esto, algo lo detuvo. */
const STALLED_MS = 2 * 60_000;
/** Una cita espera segundos; si espera mas que esto, no esta saliendo. */
const LATE_MS = 2 * 60_000;

function ago(iso: string) {
  const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return `hace ${seconds} s`;
  if (seconds < 3600) return `hace ${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `hace ${Math.round(seconds / 3600)} h`;
  return `hace ${Math.round(seconds / 86400)} días`;
}

/**
 * "Ultima sincronizacion": si las citas estan llegando a Google. Importa porque un
 * calendario que dejo de actualizarse se ve igual que uno al dia, y el doctor confia en el.
 */
function SyncStatus() {
  const [status, setStatus] = useState<GoogleSyncStatus | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => agendaApi.googleSyncStatus().then((s) => alive && setStatus(s)).catch(() => {});
    load();
    const timer = setInterval(load, STATUS_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  if (!status) return null;

  const stalled = !status.lastTickAt || Date.now() - new Date(status.lastTickAt).getTime() > STALLED_MS;
  const late = !!status.oldestPendingAt && Date.now() - new Date(status.oldestPendingAt).getTime() > LATE_MS;
  const waiting = `${status.pending} ${status.pending === 1 ? 'cita espera' : 'citas esperan'} a escribirse en Google`;

  const view = stalled
    ? {
        Icon: AlertTriangle,
        className: 'text-red-600',
        title: 'Google Calendar no se está actualizando',
        detail: status.lastTickAt ? `La última revisión fue ${ago(status.lastTickAt)}.` : 'Todavía no se hizo ninguna revisión desde que arrancó el servidor.',
      }
    : late || (status.lastFailure && status.pending > 0)
      ? {
          Icon: AlertTriangle,
          className: 'text-amber-600',
          title: `${waiting}${status.oldestPendingAt ? ` (la más vieja, ${ago(status.oldestPendingAt)})` : ''}`,
          detail: status.lastFailure ? `Google respondió: ${status.lastFailure}` : 'Se sigue reintentando.',
        }
      : status.pending > 0
        ? { Icon: Clock, className: 'text-ink-muted', title: waiting, detail: 'Salen en unos segundos.' }
        : {
            Icon: CheckCircle2,
            className: 'text-green-700',
            title: 'Google Calendar al día',
            detail: `Última revisión ${ago(status.lastTickAt!)}.${status.lastFailure ? ` Aviso de Google: ${status.lastFailure}` : ''}`,
          };

  return (
    <div className="card p-4 flex items-start gap-3">
      <view.Icon className={clsx('w-4 h-4 mt-0.5 shrink-0', view.className)} />
      <div className="min-w-0">
        <p className={clsx('text-sm font-semibold', view.className)}>{view.title}</p>
        <p className="text-xs text-ink-muted">{view.detail}</p>
      </div>
    </div>
  );
}

const sameList = (a: string[], b: string[]) => [...a].sort().join() === [...b].sort().join();
const parse = (text: string) => text.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);

/**
 * El calendario de Google de cada clinica: todas sus citas, de cualquier doctor, para
 * quien las tiene que ver (recepcion, coordinacion). Aca solo se carga con quien se
 * comparte; el calendario se crea y se llena solo unos segundos despues de guardar.
 */
export default function GoogleCalendarTab() {
  const [calendars, setCalendars] = useState<ClinicCalendar[] | null>(null);
  // Plegada siempre al entrar.
  const [help, setHelp] = useState(false);

  const load = useCallback(async () => {
    try {
      setCalendars(await agendaApi.clinicCalendars());
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudieron cargar los calendarios');
      setCalendars((c) => c ?? []);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  // Mientras alguno se este creando o compartiendo, se vuelve a pedir para mostrar el resultado.
  const applying = !!calendars?.some((c) => !c.error && !sameList(c.emails, c.sharedEmails));
  useEffect(() => {
    if (!applying) return;
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [applying, load]);

  if (!calendars) {
    return <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-ink-subtle" /></div>;
  }

  return (
    <div className="space-y-3">
      <SyncStatus />

      <div className="card">
        <button onClick={() => setHelp(!help)} className="w-full flex items-center justify-between p-4 text-sm font-medium text-ink">
          <span className="flex items-center gap-2"><HelpCircle className="w-4 h-4 text-ink-subtle" /> ¿Cómo funciona el calendario de la clínica?</span>
          <ChevronDown className={clsx('w-4 h-4 text-ink-subtle transition-transform', help && 'rotate-180')} />
        </button>
        {help && (
          <div className="px-4 pb-4 text-xs text-ink-muted space-y-2">
            <p>Cada clínica tiene un calendario de Google con todas sus citas. Cada cita aparece como “Dr.02 · Paciente”, con un color por doctor.</p>
            <p>Se comparte con las cuentas de Google que cargue acá. A cada una le llega un correo de Google para agregarlo; lo acepta una vez.</p>
            <p>Es solo para ver: las citas se crean, se mueven y se cancelan en Connect, y el calendario se actualiza solo en unos segundos.</p>
            <p>Quien tenga el calendario ve el nombre de todos los pacientes de esa clínica. Si quita una cuenta de la lista, deja de verlo. Si las quita todas, el calendario se conserva con su historial y vuelve a compartirse cuando cargue una cuenta.</p>
            <p>El calendario de cada doctor, con solo sus citas, se activa cargando su Gmail en la pestaña Doctores.</p>
          </div>
        )}
      </div>

      {calendars.map((c) => (
        <ClinicCard key={c.channelAccountId} calendar={c} onSaved={(saved) => setCalendars(calendars.map((x) => (x.channelAccountId === saved.channelAccountId ? saved : x)))} />
      ))}
    </div>
  );
}

function ClinicCard({ calendar, onSaved }: { calendar: ClinicCalendar; onSaved: (c: ClinicCalendar) => void }) {
  const [text, setText] = useState(calendar.emails.join('\n'));
  const [saving, setSaving] = useState(false);
  const emails = parse(text);
  const dirty = !sameList(emails, calendar.emails);

  async function save() {
    setSaving(true);
    try {
      onSaved(await agendaApi.setClinicCalendar(calendar.channelAccountId, emails));
      toast.success(emails.length ? 'Guardado. El calendario se comparte en unos segundos.' : 'Guardado. El calendario se deja de compartir.');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }

  const status = calendar.error
    ? { text: `No se pudo aplicar: ${calendar.error}`, className: 'text-red-600' }
    : calendar.emails.length === 0
      ? { text: calendar.sharedEmails.length ? 'Dejando de compartir…' : 'No se comparte con nadie.', className: 'text-ink-subtle' }
      : sameList(calendar.emails, calendar.sharedEmails)
        ? { text: `Compartido con ${calendar.sharedEmails.length} ${calendar.sharedEmails.length === 1 ? 'cuenta' : 'cuentas'}.`, className: 'text-green-700' }
        : { text: 'Aplicando los cambios…', className: 'text-ink-subtle' };

  return (
    <div className="card p-4 space-y-2">
      <p className="text-sm font-semibold text-ink">{calendar.clinic}</p>
      <label className="text-[11px] text-ink-subtle block">Cuentas de Google con las que se comparte (una por línea)</label>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={Math.max(2, emails.length + 1)}
        placeholder="recepcion@gmail.com"
        className="input font-mono text-xs"
      />
      <div className="flex items-center justify-between gap-3">
        <p className={clsx('text-xs', status.className)}>{status.text}</p>
        <button onClick={save} disabled={saving || !dirty} className="btn-primary shrink-0">
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Guardar
        </button>
      </div>
    </div>
  );
}
