'use client';
import { useEffect, useState } from 'react';
import { templatesApi } from '@/lib/api';
import { FileText, Plus, Loader2, X, RefreshCw, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

interface Template {
  id: string;
  name: string;
  language: string;
  category: string;
  bodyText: string;
  variableCount: number;
  status: string;
  rejectReason: string | null;
  createdAt: string;
}

const STATUS_STYLES: Record<string, { label: string; bg: string; color: string }> = {
  PENDING:  { label: 'Pendiente', bg: '#FFF7ED', color: '#C2650A' },
  APPROVED: { label: 'Aprobada',  bg: '#E8FBF0', color: '#128C7E' },
  REJECTED: { label: 'Rechazada', bg: '#FEE2E2', color: '#B91C1C' },
};

const CATEGORY_LABELS: Record<string, string> = {
  MARKETING: 'Marketing',
  UTILITY: 'Utilidad',
  AUTHENTICATION: 'Autenticación',
};

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm,  setShowForm]  = useState(false);
  const [isSaving,  setIsSaving]  = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  const [form, setForm] = useState({ name: '', language: 'es', category: 'UTILITY', bodyText: '' });
  const [exampleValues, setExampleValues] = useState<string[]>([]);

  const variableCount = new Set(form.bodyText.match(/\{\{\d+\}\}/g) ?? []).size;

  function handleBodyChange(bodyText: string) {
    const count = new Set(bodyText.match(/\{\{\d+\}\}/g) ?? []).size;
    setForm((f) => ({ ...f, bodyText }));
    setExampleValues((prev) => {
      const next = prev.slice(0, count);
      while (next.length < count) next.push('');
      return next;
    });
  }

  function load() {
    setIsLoading(true);
    templatesApi.list().then(setTemplates).catch(() => toast.error('Error al cargar plantillas')).finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (variableCount > 0 && exampleValues.some((v) => !v.trim())) {
      toast.error('Completá un valor de ejemplo para cada variable');
      return;
    }
    setIsSaving(true);
    try {
      const t = await templatesApi.create({ ...form, exampleValues: variableCount > 0 ? exampleValues : undefined });
      setTemplates((prev) => [t, ...prev]);
      setForm({ name: '', language: 'es', category: 'UTILITY', bodyText: '' });
      setExampleValues([]);
      setShowForm(false);
      toast.success('Plantilla enviada a Meta para aprobación');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Error al crear la plantilla');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRefresh(id: string) {
    setRefreshingId(id);
    try {
      const updated = await templatesApi.refresh(id);
      setTemplates((prev) => prev.map((t) => (t.id === id ? updated : t)));
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Error al actualizar estado');
    } finally {
      setRefreshingId(null);
    }
  }

  async function handleRemove(id: string) {
    try {
      await templatesApi.remove(id);
      setTemplates((prev) => prev.filter((t) => t.id !== id));
      toast.success('Plantilla eliminada');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Error al eliminar');
    }
  }

  return (
    <div className="max-w-2xl mx-auto py-10 px-6 animate-fade-in">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-xl font-bold text-ink mb-1" style={{ letterSpacing: '-0.02em' }}>Plantillas</h1>
          <p className="text-sm text-ink-muted">Mensajes pre-aprobados por Meta para iniciar conversaciones</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary">
          {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showForm ? 'Cancelar' : 'Nueva plantilla'}
        </button>
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="card p-5 mb-5 animate-fade-in">
          <p className="text-sm font-semibold text-ink mb-4">Nueva plantilla</p>
          <div className="space-y-3">
            <div>
              <input
                required placeholder="nombre_de_la_plantilla" value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') }))}
                className="input font-mono text-sm"
              />
              <p className="text-[11px] text-ink-subtle mt-1">Solo minúsculas, números y guión bajo — así lo va a guardar Meta.</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className="input">
                <option value="UTILITY">Utilidad</option>
                <option value="MARKETING">Marketing</option>
                <option value="AUTHENTICATION">Autenticación</option>
              </select>
              <input
                required placeholder="Idioma (ej: es)" value={form.language}
                onChange={(e) => setForm((f) => ({ ...f, language: e.target.value }))} className="input"
              />
            </div>
            <div>
              <textarea
                required placeholder="Hola {{1}}, tu pedido {{2}} está en camino." value={form.bodyText}
                onChange={(e) => handleBodyChange(e.target.value)}
                className="input w-full" rows={3}
              />
              <p className="text-[11px] text-ink-subtle mt-1">
                Usá <code>{'{{1}}'}</code>, <code>{'{{2}}'}</code>, etc. para las partes que van a variar en cada envío.
              </p>
            </div>

            {variableCount > 0 && (
              <div className="space-y-2 p-3 rounded-lg" style={{ background: 'var(--surface-muted)' }}>
                <p className="text-[11px] text-ink-subtle">
                  Meta exige un valor de ejemplo por cada variable para poder aprobar la plantilla:
                </p>
                {exampleValues.map((v, i) => (
                  <input
                    key={i}
                    required
                    placeholder={`Ejemplo para {{${i + 1}}}`}
                    value={v}
                    onChange={(e) => setExampleValues((prev) => prev.map((val, idx) => (idx === i ? e.target.value : val)))}
                    className="input w-full text-sm"
                  />
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-2 mt-4">
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary flex-1">Cancelar</button>
            <button type="submit" disabled={isSaving} className="btn-primary flex-1">
              {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Enviar a Meta
            </button>
          </div>
        </form>
      )}

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-5 h-5 rounded-full border-2 border-green-500 border-t-transparent animate-spin" />
          </div>
        ) : templates.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-ink-subtle text-sm">Sin plantillas todavía</div>
        ) : (
          <div className="divide-y divide-border">
            {templates.map((t, i) => {
              const ss = STATUS_STYLES[t.status] ?? STATUS_STYLES.PENDING;
              return (
                <div key={t.id} className="px-5 py-3.5 animate-fade-in" style={{ animationDelay: `${i * 40}ms` }}>
                  <div className="flex items-start gap-3.5">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: '#E8FBF0', color: '#128C7E' }}>
                      <FileText className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-ink truncate font-mono">{t.name}</p>
                        <span className="text-[11px] font-semibold rounded-full px-2.5 py-1 shrink-0" style={{ background: ss.bg, color: ss.color }}>
                          {ss.label}
                        </span>
                      </div>
                      <p className="text-xs text-ink-subtle">{CATEGORY_LABELS[t.category] ?? t.category} · {t.language}</p>
                      <p className="text-xs text-ink-muted mt-1 whitespace-pre-wrap">{t.bodyText}</p>
                      {t.status === 'REJECTED' && t.rejectReason && (
                        <p className="text-[11px] text-red-500 mt-1">Motivo: {t.rejectReason}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => handleRefresh(t.id)}
                        disabled={refreshingId === t.id}
                        title="Actualizar estado"
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-subtle hover:text-ink hover:bg-black/5"
                      >
                        <RefreshCw className={`w-4 h-4 ${refreshingId === t.id ? 'animate-spin' : ''}`} />
                      </button>
                      <button
                        onClick={() => handleRemove(t.id)}
                        title="Eliminar"
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-subtle hover:text-red-500 hover:bg-red-50"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
