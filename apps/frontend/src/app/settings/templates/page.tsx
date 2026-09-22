'use client';
import { useEffect, useRef, useState } from 'react';
import { templatesApi, whatsappApi } from '@/lib/api';
import type { MessageTemplate, TemplateButton } from '@/lib/api';
import { FileText, Plus, Loader2, X, RefreshCw, Trash2, Upload, Image as ImageIcon } from 'lucide-react';
import toast from 'react-hot-toast';
import { TemplatePreview } from './components/TemplatePreview';
import { ButtonsEditor } from './components/ButtonsEditor';

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

const MAX_HEADER_TEXT = 60;
const MAX_FOOTER_TEXT = 60;
const MAX_BODY_TEXT = 1024;

type HeaderMode = 'NONE' | 'TEXT' | 'IMAGE';

const EMPTY_FORM = { name: '', language: 'es', category: 'UTILITY', bodyText: '', headerText: '', footerText: '' };

function countVars(text: string) {
  return new Set(text.match(/\{\{\d+\}\}/g) ?? []).size;
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm,  setShowForm]  = useState(false);
  const [isSaving,  setIsSaving]  = useState(false);
  const [refreshingId, setRefreshingId] = useState<string | null>(null);

  const [form, setForm] = useState(EMPTY_FORM);
  const [accounts, setAccounts] = useState<any[]>([]);
  // WABA donde se va a crear la plantilla. Meta la guarda ahí y queda disponible para
  // todas las líneas de esa cuenta — de ahí que el selector muestre cuáles son.
  const [wabaId, setWabaId] = useState('');

  const [headerMode, setHeaderMode] = useState<HeaderMode>('NONE');
  const [headerExampleValues, setHeaderExampleValues] = useState<string[]>([]);
  // Lo que devuelve la subida: el handle es para Meta, path y mime se guardan con la
  // plantilla. previewUrl es local y solo sirve para la vista previa de esta pantalla.
  const [headerImage, setHeaderImage] = useState<{ handle: string; path: string; mime: string; previewUrl: string } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [buttons, setButtons] = useState<TemplateButton[]>([]);
  const [exampleValues, setExampleValues] = useState<string[]>([]);

  // Solo tiene sentido decir de que cuenta es una plantilla si hay mas de una: con un
  // solo WABA la etiqueta seria la misma en todas las filas.
  const wabaIds = Array.from(new Set(accounts.map((a) => a.wabaId).filter(Boolean)));
  const multiWaba = wabaIds.length > 1;

  function linesOfWaba(id?: string | null) {
    if (!id) return [];
    return accounts
      .filter((a) => a.wabaId === id && a.isActive)
      .map((a) => a.label?.trim() || a.phoneNumber || 'Línea sin nombre');
  }

  function wabaLabel(id?: string | null) {
    if (!id) return 'Cuenta desconocida';
    const lines = linesOfWaba(id);
    return lines.length > 0 ? lines.join(', ') : `WABA ${id}`;
  }

  const variableCount = countVars(form.bodyText);
  const headerVariableCount = headerMode === 'TEXT' ? countVars(form.headerText) : 0;

  function handleBodyChange(bodyText: string) {
    const count = countVars(bodyText);
    setForm((f) => ({ ...f, bodyText }));
    setExampleValues((prev) => {
      const next = prev.slice(0, count);
      while (next.length < count) next.push('');
      return next;
    });
  }

  function handleHeaderTextChange(headerText: string) {
    const count = countVars(headerText);
    setForm((f) => ({ ...f, headerText }));
    setHeaderExampleValues((prev) => (count > 0 ? [prev[0] ?? ''] : []));
  }

  function resetForm() {
    setForm(EMPTY_FORM);
    setExampleValues([]);
    setHeaderMode('NONE');
    setHeaderExampleValues([]);
    if (headerImage) URL.revokeObjectURL(headerImage.previewUrl);
    setHeaderImage(null);
    setButtons([]);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  /**
   * La imagen se sube apenas se elige, no al guardar: Meta necesita un "handle" suyo
   * para poder aprobar la plantilla, y tenerlo antes permite mostrar la vista previa
   * y avisar de un archivo rechazado sin perder el resto del formulario.
   */
  async function handlePickImage(file: File | undefined) {
    if (!file) return;
    setIsUploading(true);
    try {
      const result = await templatesApi.uploadHeaderMedia(file);
      if (headerImage) URL.revokeObjectURL(headerImage.previewUrl);
      setHeaderImage({ ...result, previewUrl: URL.createObjectURL(file) });
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo subir la imagen');
      if (fileInputRef.current) fileInputRef.current.value = '';
    } finally {
      setIsUploading(false);
    }
  }

  function load() {
    setIsLoading(true);
    templatesApi.list().then(setTemplates).catch(() => toast.error('Error al cargar plantillas')).finally(() => setIsLoading(false));
    // Para poder decir a que cuenta pertenece cada plantilla cuando el tenant tiene
    // lineas en mas de un WABA — que es justo cuando una plantilla puede "no existir".
    whatsappApi.listAccounts()
      .then((accs) => {
        setAccounts(accs);
        const preferred = accs.find((a: any) => a.isDefault && a.isActive) ?? accs.find((a: any) => a.isActive);
        setWabaId((prev) => prev || preferred?.wabaId || '');
      })
      .catch(() => setAccounts([]));
  }

  useEffect(() => { load(); }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (variableCount > 0 && exampleValues.some((v) => !v.trim())) {
      toast.error('Completá un valor de ejemplo para cada variable del cuerpo');
      return;
    }
    if (headerVariableCount > 0 && !headerExampleValues[0]?.trim()) {
      toast.error('Completá el valor de ejemplo de la variable del encabezado');
      return;
    }
    if (headerMode === 'IMAGE' && !headerImage) {
      toast.error('Subí la imagen del encabezado');
      return;
    }

    setIsSaving(true);
    try {
      const t = await templatesApi.create({
        name: form.name,
        language: form.language,
        category: form.category,
        bodyText: form.bodyText,
        wabaId: wabaId || undefined,
        exampleValues: variableCount > 0 ? exampleValues : undefined,
        ...(headerMode === 'TEXT' && {
          headerFormat: 'TEXT' as const,
          headerText: form.headerText,
          headerExampleValues: headerVariableCount > 0 ? headerExampleValues : undefined,
        }),
        ...(headerMode === 'IMAGE' && headerImage && {
          headerFormat: 'IMAGE' as const,
          headerMediaHandle: headerImage.handle,
          headerMediaPath: headerImage.path,
          headerMediaMime: headerImage.mime,
        }),
        ...(form.footerText.trim() && { footerText: form.footerText.trim() }),
        ...(buttons.length > 0 && { buttons }),
      });
      setTemplates((prev) => [t, ...prev]);
      resetForm();
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
    // Con el formulario abierto la pantalla se ensancha para que entre la vista previa al lado.
    <div className={`${showForm ? 'max-w-5xl' : 'max-w-2xl'} mx-auto py-10 px-6 animate-fade-in transition-all`}>
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-xl font-bold text-ink mb-1" style={{ letterSpacing: '-0.02em' }}>Plantillas</h1>
          <p className="text-sm text-ink-muted">Mensajes pre-aprobados por Meta para iniciar conversaciones</p>
        </div>
        <button
          onClick={() => { if (showForm) resetForm(); setShowForm(!showForm); }}
          className="btn-primary shrink-0"
        >
          {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showForm ? 'Cancelar' : 'Nueva plantilla'}
        </button>
      </div>

      {showForm && (
        <div className="grid lg:grid-cols-[minmax(0,1fr)_300px] gap-5 mb-5 items-start">
          <form onSubmit={handleCreate} className="card p-5 animate-fade-in">
            <p className="text-sm font-semibold text-ink mb-4">Nueva plantilla</p>
            <div className="space-y-4">
              {/* Selector de cuenta — oculto con un solo WABA, no hay nada que elegir */}
              {multiWaba && (
                <div>
                  <label className="text-xs font-semibold text-ink block mb-1.5">
                    Cuenta de WhatsApp Business
                  </label>
                  <select value={wabaId} onChange={(e) => setWabaId(e.target.value)} className="input w-full">
                    {wabaIds.map((id) => (
                      <option key={id} value={id}>
                        {linesOfWaba(id).length > 0 ? linesOfWaba(id).join(', ') : `WABA ${id}`}
                      </option>
                    ))}
                  </select>
                  <div
                    className="rounded-lg px-3 py-2.5 mt-2 text-[11px]"
                    style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
                  >
                    <p className="text-ink-muted">
                      Meta guarda la plantilla en esta cuenta. Va a quedar disponible para
                      {linesOfWaba(wabaId).length === 1 ? ' la línea:' : ' estas líneas:'}
                    </p>
                    {linesOfWaba(wabaId).length > 0 ? (
                      <ul className="mt-1.5 space-y-0.5">
                        {linesOfWaba(wabaId).map((name) => (
                          <li key={name} className="flex items-center gap-1.5 text-ink">
                            <span className="w-1 h-1 rounded-full shrink-0" style={{ background: '#25D366' }} />
                            {name}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-ink-subtle mt-1">Esta cuenta no tiene líneas activas.</p>
                    )}
                    <p className="text-ink-subtle mt-2">
                      Para usarla desde una línea de otra cuenta, hay que crearla también allí.
                    </p>
                  </div>
                </div>
              )}

              <div>
                <label className="text-xs font-semibold text-ink block mb-1.5">Nombre</label>
                <input
                  required placeholder="nombre_de_la_plantilla" value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') }))}
                  className="input font-mono text-sm w-full"
                />
                <p className="text-[11px] text-ink-subtle mt-1">Solo minúsculas, números y guión bajo — así lo va a guardar Meta.</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-semibold text-ink block mb-1.5">Categoría</label>
                  <select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} className="input w-full">
                    <option value="UTILITY">Utilidad</option>
                    <option value="MARKETING">Marketing</option>
                    <option value="AUTHENTICATION">Autenticación</option>
                  </select>
                </div>
                <div>
                  <label className="text-xs font-semibold text-ink block mb-1.5">Idioma</label>
                  <input
                    required placeholder="es" value={form.language}
                    onChange={(e) => setForm((f) => ({ ...f, language: e.target.value }))} className="input w-full"
                  />
                </div>
              </div>

              {/* ── Encabezado ─────────────────────────────────────────────── */}
              <div className="pt-1" style={{ borderTop: '1px solid var(--border)' }}>
                <label className="text-xs font-semibold text-ink block mb-1.5 mt-3">Encabezado (opcional)</label>
                <div className="flex gap-1.5 mb-2">
                  {([
                    ['NONE', 'Sin encabezado'],
                    ['TEXT', 'Texto'],
                    ['IMAGE', 'Imagen'],
                  ] as [HeaderMode, string][]).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => setHeaderMode(mode)}
                      className={headerMode === mode ? 'btn-primary text-xs py-1.5 px-3' : 'btn-secondary text-xs py-1.5 px-3'}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {headerMode === 'TEXT' && (
                  <>
                    <input
                      required
                      maxLength={MAX_HEADER_TEXT}
                      placeholder="Resultados listos, {{1}}"
                      value={form.headerText}
                      onChange={(e) => handleHeaderTextChange(e.target.value)}
                      className="input w-full text-sm"
                    />
                    <p className="text-[11px] text-ink-subtle mt-1">
                      Una sola línea, hasta {MAX_HEADER_TEXT} caracteres. Admite una variable, que tiene que ser{' '}
                      <code>{'{{1}}'}</code>. ({form.headerText.length}/{MAX_HEADER_TEXT})
                    </p>
                    {headerVariableCount > 0 && (
                      <input
                        required
                        placeholder="Ejemplo para {{1}} del encabezado"
                        value={headerExampleValues[0] ?? ''}
                        onChange={(e) => setHeaderExampleValues([e.target.value])}
                        className="input w-full text-sm mt-1.5"
                      />
                    )}
                  </>
                )}

                {headerMode === 'IMAGE' && (
                  <div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png"
                      onChange={(e) => handlePickImage(e.target.files?.[0])}
                      className="hidden"
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={isUploading}
                      className="btn-secondary w-full justify-center"
                    >
                      {isUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : headerImage ? <ImageIcon className="w-4 h-4" /> : <Upload className="w-4 h-4" />}
                      {isUploading ? 'Subiendo…' : headerImage ? 'Cambiar imagen' : 'Subir imagen'}
                    </button>
                    <p className="text-[11px] text-ink-subtle mt-1">
                      JPG o PNG, hasta 5 MB. Se sube a Meta al elegirla, para que pueda aprobar la plantilla.
                      La misma imagen se manda en todos los envíos.
                    </p>
                  </div>
                )}
              </div>

              {/* ── Cuerpo ─────────────────────────────────────────────────── */}
              <div className="pt-1" style={{ borderTop: '1px solid var(--border)' }}>
                <label className="text-xs font-semibold text-ink block mb-1.5 mt-3">Cuerpo</label>
                <textarea
                  required maxLength={MAX_BODY_TEXT}
                  placeholder="Hola {{1}}, tu pedido {{2}} está en camino." value={form.bodyText}
                  onChange={(e) => handleBodyChange(e.target.value)}
                  className="input w-full" rows={3}
                />
                <p className="text-[11px] text-ink-subtle mt-1">
                  Usá <code>{'{{1}}'}</code>, <code>{'{{2}}'}</code>, etc. para las partes que van a variar en cada
                  envío. ({form.bodyText.length}/{MAX_BODY_TEXT})
                </p>

                {variableCount > 0 && (
                  <div className="space-y-2 p-3 rounded-lg mt-2" style={{ background: 'var(--surface-muted)' }}>
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

              {/* ── Pie ────────────────────────────────────────────────────── */}
              <div className="pt-1" style={{ borderTop: '1px solid var(--border)' }}>
                <label className="text-xs font-semibold text-ink block mb-1.5 mt-3">Pie de página (opcional)</label>
                <input
                  maxLength={MAX_FOOTER_TEXT}
                  placeholder="Respondé BAJA para no recibir más avisos"
                  value={form.footerText}
                  onChange={(e) => setForm((f) => ({ ...f, footerText: e.target.value }))}
                  className="input w-full text-sm"
                />
                <p className="text-[11px] text-ink-subtle mt-1">
                  Texto chico bajo el mensaje, sin variables. ({form.footerText.length}/{MAX_FOOTER_TEXT})
                </p>
              </div>

              {/* ── Botones ────────────────────────────────────────────────── */}
              <div className="pt-4" style={{ borderTop: '1px solid var(--border)' }}>
                <ButtonsEditor buttons={buttons} onChange={setButtons} />
              </div>
            </div>

            <div className="flex gap-2 mt-5">
              <button type="button" onClick={() => { resetForm(); setShowForm(false); }} className="btn-secondary flex-1">
                Cancelar
              </button>
              <button type="submit" disabled={isSaving || isUploading} className="btn-primary flex-1">
                {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Enviar a Meta
              </button>
            </div>
          </form>

          <div className="lg:sticky lg:top-6">
            <TemplatePreview
              headerFormat={headerMode === 'NONE' ? null : headerMode}
              headerText={form.headerText}
              headerImageUrl={headerImage?.previewUrl}
              bodyText={form.bodyText}
              footerText={form.footerText}
              buttons={buttons}
              exampleValues={exampleValues}
              headerExampleValues={headerExampleValues}
            />
          </div>
        </div>
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
                      <p className="text-xs text-ink-subtle">
                        {CATEGORY_LABELS[t.category] ?? t.category} · {t.language}
                        {multiWaba && <> · {wabaLabel(t.wabaId)}</>}
                      </p>

                      {/* Qué trae la plantilla además del cuerpo, de un vistazo */}
                      {(t.headerFormat || t.footerText || (t.buttons?.length ?? 0) > 0) && (
                        <div className="flex flex-wrap gap-1 mt-1.5">
                          {t.headerFormat === 'IMAGE' && <Chip>Imagen</Chip>}
                          {t.headerFormat === 'TEXT' && <Chip>Encabezado</Chip>}
                          {t.footerText && <Chip>Pie</Chip>}
                          {(t.buttons?.length ?? 0) > 0 && (
                            <Chip>{t.buttons!.length} {t.buttons!.length === 1 ? 'botón' : 'botones'}</Chip>
                          )}
                        </div>
                      )}

                      {t.headerFormat === 'TEXT' && t.headerText && (
                        <p className="text-xs text-ink font-semibold mt-1.5">{t.headerText}</p>
                      )}
                      <p className="text-xs text-ink-muted mt-1 whitespace-pre-wrap">{t.bodyText}</p>
                      {t.footerText && <p className="text-[11px] text-ink-subtle mt-1">{t.footerText}</p>}
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

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="text-[10px] font-medium rounded px-1.5 py-0.5 text-ink-muted"
      style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
    >
      {children}
    </span>
  );
}
