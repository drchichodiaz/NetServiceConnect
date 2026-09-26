'use client';
import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { agendaApi, templatesApi, MessageTemplate } from '@/lib/api';
import { AgendaSettings, hhmm } from '@/lib/agenda';
import { setAgendaSettingsCache } from '@/hooks/useAgendaSettings';

type TemplateKey = 'confirmationTemplateId' | 'reminderTemplateId' | 'doctorSummaryTemplateId' | 'delayTemplateId';

/** Que plantilla va en cada aviso y que variables espera, en el orden en que se llenan. */
const NOTICES: { key: TemplateKey; title: string; when: string; variables: string }[] = [
  {
    key: 'confirmationTemplateId',
    title: 'Confirmación de la cita',
    when: 'Al paciente, apenas se agenda.',
    variables: '{{1}} clínica · {{2}} día · {{3}} hora',
  },
  {
    key: 'reminderTemplateId',
    title: 'Recordatorio',
    when: 'Al paciente, antes de la cita. Con los botones “Confirmo” y “Reprogramar”.',
    variables: '{{1}} día · {{2}} hora · {{3}} clínica',
  },
  {
    key: 'doctorSummaryTemplateId',
    title: 'Resumen del día del doctor',
    when: 'Al doctor, cada mañana. Con un botón de enlace a sus citas.',
    variables: '{{1}} doctor · {{2}} cantidad de citas · {{3}} clínica · {{4}} desde · {{5}} hasta',
  },
  {
    key: 'delayTemplateId',
    title: 'Aviso de atraso',
    when: 'Al paciente que sigue, cuando una consulta se alarga.',
    variables: '{{1}} clínica',
  },
];

export default function NoticesTab({ settings }: { settings: AgendaSettings }) {
  const [form, setForm] = useState(settings);
  const [templates, setTemplates] = useState<MessageTemplate[] | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    templatesApi.list().then(setTemplates).catch(() => setTemplates([]));
  }, []);

  async function save() {
    setSaving(true);
    try {
      const saved = await agendaApi.updateSettings({
        slotMinutes: form.slotMinutes,
        reminderHoursBefore: form.reminderHoursBefore,
        doctorSummaryHour: form.doctorSummaryHour,
        confirmationTemplateId: form.confirmationTemplateId ?? '',
        reminderTemplateId: form.reminderTemplateId ?? '',
        doctorSummaryTemplateId: form.doctorSummaryTemplateId ?? '',
        delayTemplateId: form.delayTemplateId ?? '',
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

  // Una plantilla con el mismo nombre existe una vez por WABA: se ofrece una sola.
  const options = (templates ?? []).filter(
    (t, i, all) => all.findIndex((x) => x.name === t.name && x.language === t.language) === i,
  );

  return (
    <div className="space-y-5">
      <div className="card p-5 grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div>
          <label className="text-[11px] text-ink-subtle block mb-1">Duración de la cita</label>
          <select value={form.slotMinutes} onChange={(e) => setForm({ ...form, slotMinutes: Number(e.target.value) })} className="input">
            {[15, 30, 45, 60, 75, 90, 120].map((m) => <option key={m} value={m}>{m} minutos</option>)}
          </select>
        </div>
        <div>
          <label className="text-[11px] text-ink-subtle block mb-1">Recordatorio</label>
          <select value={form.reminderHoursBefore} onChange={(e) => setForm({ ...form, reminderHoursBefore: Number(e.target.value) })} className="input">
            {[2, 4, 12, 24, 48].map((h) => <option key={h} value={h}>{h} horas antes</option>)}
          </select>
          {form.reminderHoursBefore !== 24 && (
            <p className="text-[11px] text-amber-600 mt-1">Si la plantilla dice “mañana”, déjelo en 24 horas: solo se manda para citas del día siguiente.</p>
          )}
        </div>
        <div>
          <label className="text-[11px] text-ink-subtle block mb-1">Resumen del doctor</label>
          <select value={form.doctorSummaryHour} onChange={(e) => setForm({ ...form, doctorSummaryHour: Number(e.target.value) })} className="input">
            {[5, 6, 7, 8, 9].map((h) => <option key={h} value={h}>{hhmm(h * 60)}</option>)}
          </select>
        </div>
      </div>

      <div className="card divide-y divide-border">
        {NOTICES.map((n) => {
          const selected = options.find((t) => t.id === form[n.key]) ?? templates?.find((t) => t.id === form[n.key]);
          return (
            <div key={n.key} className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3 items-start">
              <div>
                <p className="text-sm font-semibold text-ink">{n.title}</p>
                <p className="text-xs text-ink-muted">{n.when}</p>
                <p className="text-[11px] text-ink-subtle mt-1 font-mono">{n.variables}</p>
              </div>
              <div>
                <select
                  value={form[n.key] ?? ''}
                  onChange={(e) => setForm({ ...form, [n.key]: e.target.value || null })}
                  className="input"
                  disabled={!templates}
                >
                  <option value="">No mandar este aviso</option>
                  {options.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}{t.status === 'APPROVED' ? '' : ` (${t.status === 'PENDING' ? 'esperando a Meta' : 'rechazada'})`}
                    </option>
                  ))}
                </select>
                {selected && selected.status !== 'APPROVED' && (
                  <p className="text-[11px] text-amber-600 mt-1">No sale hasta que Meta la apruebe.</p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex justify-end">
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Guardar
        </button>
      </div>
    </div>
  );
}
