'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { campaignsApi, templatesApi, whatsappApi } from '@/lib/api';
import type { Campaign, CampaignPreview, MessageTemplate, VariableMapping } from '@/lib/api';
import { Upload, Loader2, AlertTriangle, CheckCircle2, FileSpreadsheet, X, Search, BookUser } from 'lucide-react';
import toast from 'react-hot-toast';
import { TemplatePreview } from '@/app/settings/templates/components/TemplatePreview';

/**
 * Campos del propio contacto, usables como valor de una variable sin que esten en
 * ningun Excel. Llevan nombre reservado para no chocar con una columna que se llame
 * igual, y son lo unico disponible cuando la campaña sale de los contactos del sistema.
 */
const CONTACT_FIELDS = [
  { key: '__name__', label: 'Nombre del contacto' },
  { key: '__company__', label: 'Empresa del contacto' },
  { key: '__phone__', label: 'Teléfono del contacto' },
  { key: '__email__', label: 'Email del contacto' },
];

type Source = 'CONTACTS' | 'FILE';

interface Props {
  onClose: () => void;
  onCreated: (campaign: Campaign) => void;
}

/**
 * Armar una campaña: que se manda, a quien, y con que datos se llenan las variables.
 *
 * El paso de revision no es decoracion: una campaña no se puede deshacer, y es la
 * unica oportunidad de ver cuantos van a recibir el mensaje, cuantos estan dados de
 * baja y con que valores se van a llenar las variables antes de que salga el primero.
 */
export function NewCampaignWizard({ onClose, onCreated }: Props) {
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [accounts, setAccounts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState('');
  const [accountId, setAccountId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [ratePerMinute, setRatePerMinute] = useState(20);

  // Arranca en contactos del sistema: es el caso mas comun y no pide preparar nada.
  const [source, setSource] = useState<Source>('CONTACTS');
  const [contactSearch, setContactSearch] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<CampaignPreview | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Por cada hueco de la plantilla, de donde sale su valor.
  const [mapping, setMapping] = useState<Record<string, string>>({});

  const template = templates.find((t) => t.id === templateId) ?? null;

  useEffect(() => {
    whatsappApi
      .listActiveAccounts()
      .then((accs) => {
        setAccounts(accs);
        setAccountId((accs.find((a: any) => a.isDefault) ?? accs[0])?.id ?? '');
      })
      .catch(() => setAccounts([]));
  }, []);

  // Las plantillas utilizables dependen de la línea: Meta las guarda por WABA.
  useEffect(() => {
    if (!accountId) return;
    setLoading(true);
    setTemplateId('');
    setPreview(null);
    templatesApi
      .list({ channelAccountId: accountId })
      .then((list: MessageTemplate[]) => setTemplates(list.filter((t) => t.status === 'APPROVED')))
      .catch(() => toast.error('Error al cargar plantillas'))
      .finally(() => setLoading(false));
  }, [accountId]);

  // Cambiar de plantilla o de fuente invalida lo revisado: los huecos y la lista son otros.
  useEffect(() => {
    setMapping({});
    setPreview(null);
  }, [templateId, source]);

  /** De donde puede salir el valor de una variable, segun la fuente elegida. */
  const columns = useMemo(
    () => [...CONTACT_FIELDS, ...(preview?.extraColumns ?? []).map((c) => ({ key: c, label: c }))],
    [preview],
  );

  /** Los huecos que hay que completar, en el orden en que los ve quien arma la campaña. */
  const slots = useMemo(() => {
    if (!preview) return [];
    const out: { key: string; label: string; target: VariableMapping['target']; index: number }[] = [];
    for (let i = 0; i < preview.needs.header; i++) {
      out.push({ key: `header:${i}`, label: `Encabezado {{${i + 1}}}`, target: 'header', index: i });
    }
    for (let i = 0; i < preview.needs.body; i++) {
      out.push({ key: `body:${i}`, label: `Cuerpo {{${i + 1}}}`, target: 'body', index: i });
    }
    for (const b of preview.needs.buttons) {
      out.push({ key: `button:${b.index}`, label: `Enlace de "${b.text}"`, target: 'button', index: b.index });
    }
    return out;
  }, [preview]);

  const missingSlots = slots.filter((s) => !mapping[s.key]);

  /** Propone un mapeo obvio para no obligar a elegir lo mismo de siempre. */
  function guessMapping(result: CampaignPreview) {
    const guessed: Record<string, string> = {};
    const lower = result.extraColumns.map((c) => c.toLowerCase());
    for (let i = 0; i < result.needs.body; i++) {
      if (i === 0) guessed[`body:${i}`] = '__name__';
      else {
        const idx = lower.findIndex((c) => c.includes('orden') || c.includes('codigo') || c.includes('código'));
        const col = idx >= 0 ? result.extraColumns[idx] : undefined;
        if (col && !Object.values(guessed).includes(col)) guessed[`body:${i}`] = col;
      }
    }
    setMapping(guessed);
  }

  async function handleFile(picked: File | undefined) {
    if (!picked) return;
    if (!templateId) {
      toast.error('Elegí primero la plantilla');
      return;
    }
    setFile(picked);
    setIsPreviewing(true);
    try {
      const result = await campaignsApi.preview(templateId, picked);
      setPreview(result);
      guessMapping(result);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo leer el archivo');
      setFile(null);
      setPreview(null);
      if (fileRef.current) fileRef.current.value = '';
    } finally {
      setIsPreviewing(false);
    }
  }

  async function handleContactsPreview() {
    if (!templateId) {
      toast.error('Elegí primero la plantilla');
      return;
    }
    setIsPreviewing(true);
    try {
      const result = await campaignsApi.previewContacts({
        templateId,
        contactSearch: contactSearch.trim() || undefined,
      });
      setPreview(result);
      guessMapping(result);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo armar la lista');
      setPreview(null);
    } finally {
      setIsPreviewing(false);
    }
  }

  async function handleCreate() {
    if (!template || !preview) return;
    if (missingSlots.length > 0) {
      toast.error(`Falta indicar de dónde sale ${missingSlots[0].label}`);
      return;
    }
    setIsSaving(true);
    try {
      const campaign = await campaignsApi.create({
        name: name.trim(),
        templateId,
        channelAccountId: accountId,
        ratePerMinute,
        mapping: slots.map((s) => ({ target: s.target, index: s.index, column: mapping[s.key] })),
        source,
        ...(source === 'FILE'
          ? { file: file! }
          : { contactSearch: contactSearch.trim() || undefined }),
      });
      toast.success('Campaña creada. Revisala y arrancala cuando quieras.');
      onCreated(campaign);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo crear la campaña');
    } finally {
      setIsSaving(false);
    }
  }

  const hasRecipients = source === 'FILE' ? !!file : !!preview;
  const canCreate =
    !!template && !!preview && preview.ready > 0 && hasRecipients && !!name.trim() && missingSlots.length === 0 && !isPreviewing;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-6">
      <div className="card w-full max-w-3xl p-6 my-4">
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="text-lg font-bold text-ink" style={{ letterSpacing: '-0.02em' }}>Nueva campaña</h2>
            <p className="text-sm text-ink-muted">Enviar una plantilla aprobada a muchos contactos</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-subtle hover:bg-black/5">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="space-y-5">
          {/* ── 1. Qué se manda ─────────────────────────────────────────── */}
          <section>
            <p className="text-xs font-semibold text-ink mb-2">1 · Qué se manda</p>
            <div className="space-y-3">
              <input
                placeholder="Nombre de la campaña (solo lo ves vos)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="input w-full"
              />
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-ink-subtle block mb-1">Línea que envía</label>
                  <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className="input w-full">
                    {accounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.label?.trim() || a.phoneNumber}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-ink-subtle block mb-1">Plantilla aprobada</label>
                  <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className="input w-full" disabled={loading}>
                    <option value="">{loading ? 'Cargando…' : 'Elegí una plantilla…'}</option>
                    {templates.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              {!loading && templates.length === 0 && (
                <p className="text-xs text-ink-muted">
                  Esta línea no tiene plantillas aprobadas. Creá una en Configuración → Plantillas y esperá que Meta la apruebe.
                </p>
              )}

              {template && (
                <TemplatePreview
                  headerFormat={template.headerFormat}
                  headerText={template.headerText}
                  bodyText={template.bodyText}
                  footerText={template.footerText}
                  buttons={template.buttons}
                />
              )}
            </div>
          </section>

          {/* ── 2. A quién ──────────────────────────────────────────────── */}
          <section className="pt-4" style={{ borderTop: '1px solid var(--border)' }}>
            <p className="text-xs font-semibold text-ink mb-2">2 · A quién</p>

            <div className="flex gap-1.5 mb-3">
              <button
                type="button"
                onClick={() => setSource('CONTACTS')}
                className={source === 'CONTACTS' ? 'btn-primary text-xs py-1.5 px-3' : 'btn-secondary text-xs py-1.5 px-3'}
              >
                <BookUser className="w-3.5 h-3.5" />
                Contactos del sistema
              </button>
              <button
                type="button"
                onClick={() => setSource('FILE')}
                className={source === 'FILE' ? 'btn-primary text-xs py-1.5 px-3' : 'btn-secondary text-xs py-1.5 px-3'}
              >
                <FileSpreadsheet className="w-3.5 h-3.5" />
                Subir un Excel
              </button>
            </div>

            {source === 'CONTACTS' ? (
              <div>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-ink-subtle" />
                    <input
                      placeholder="Filtrar por nombre, teléfono, email o empresa (vacío = todos)"
                      value={contactSearch}
                      onChange={(e) => setContactSearch(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleContactsPreview()}
                      className="input w-full pl-9"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleContactsPreview}
                    disabled={!templateId || isPreviewing}
                    className="btn-secondary shrink-0"
                  >
                    {isPreviewing ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                    Ver a cuántos
                  </button>
                </div>
                <p className="text-[11px] text-ink-subtle mt-1">
                  Solo entran los contactos que tienen WhatsApp. Las variables de la plantilla se llenan
                  con los datos de su ficha (nombre, empresa…) o con un texto igual para todos.
                </p>
              </div>
            ) : (
              <div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.csv"
                  onChange={(e) => handleFile(e.target.files?.[0])}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={!templateId || isPreviewing}
                  className="btn-secondary w-full justify-center"
                >
                  {isPreviewing ? <Loader2 className="w-4 h-4 animate-spin" /> : file ? <FileSpreadsheet className="w-4 h-4" /> : <Upload className="w-4 h-4" />}
                  {isPreviewing ? 'Leyendo…' : file ? file.name : 'Subir Excel o CSV'}
                </button>
                <p className="text-[11px] text-ink-subtle mt-1">
                  Necesita una columna <strong>Teléfono</strong>. Las demás columnas quedan disponibles para
                  las variables de la plantilla — que es lo que el Excel permite y los contactos del sistema no:
                  un dato distinto para cada persona. Mismo formato que importar contactos.
                </p>
              </div>
            )}

            {preview && (
              <div className="rounded-lg p-3 mt-2.5 text-xs" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  <span className="flex items-center gap-1.5 text-ink">
                    <CheckCircle2 className="w-3.5 h-3.5" style={{ color: '#128C7E' }} />
                    <strong>{preview.ready}</strong> van a recibir el mensaje
                  </span>
                  {preview.optedOut > 0 && (
                    <span className="text-ink-muted">{preview.optedOut} dados de baja (se saltean)</span>
                  )}
                  {preview.duplicated > 0 && <span className="text-ink-muted">{preview.duplicated} repetidos</span>}
                  {preview.invalid > 0 && <span className="text-ink-muted">{preview.invalid} sin teléfono válido</span>}
                </div>

                {preview.errors.length > 0 && (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-ink-subtle">Ver las filas con problemas</summary>
                    <ul className="mt-1.5 space-y-0.5 max-h-32 overflow-y-auto">
                      {preview.errors.map((e, i) => (
                        <li key={i} className="text-ink-subtle">Fila {e.row}: {e.reason}</li>
                      ))}
                    </ul>
                  </details>
                )}

                {preview.ready === 0 && (
                  <p className="flex items-center gap-1.5 mt-2 text-red-600">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    No hay nadie a quien enviarle con esta selección.
                  </p>
                )}
              </div>
            )}
          </section>

          {/* ── 3. Con qué datos ────────────────────────────────────────── */}
          {preview && slots.length > 0 && (
            <section className="pt-4" style={{ borderTop: '1px solid var(--border)' }}>
              <p className="text-xs font-semibold text-ink mb-2">3 · Con qué datos se llenan las variables</p>
              <div className="space-y-2">
                {slots.map((slot) => (
                  <div key={slot.key} className="flex items-center gap-2">
                    <span className="text-xs text-ink-muted w-36 shrink-0">{slot.label}</span>
                    <select
                      value={mapping[slot.key] ?? ''}
                      onChange={(e) => setMapping((m) => ({ ...m, [slot.key]: e.target.value }))}
                      className="input flex-1 text-sm"
                    >
                      <option value="">Elegí de dónde sale…</option>
                      {columns.map((c) => (
                        <option key={c.key} value={c.key}>{c.label}</option>
                      ))}
                    </select>
                    {preview.sample[0] && mapping[slot.key] && (
                      <span className="text-[11px] text-ink-subtle w-28 truncate" title="Ejemplo del primero de la lista">
                        ej: {mapping[slot.key] === '__name__'
                          ? preview.sample[0].name
                          : mapping[slot.key] === '__phone__'
                            ? preview.sample[0].phone
                            : preview.sample[0].values[mapping[slot.key]] || '—'}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Ritmo ───────────────────────────────────────────────────── */}
          {preview && (
            <section className="pt-4" style={{ borderTop: '1px solid var(--border)' }}>
              <label className="text-xs font-semibold text-ink block mb-1.5">Ritmo de envío</label>
              <div className="flex items-center gap-2">
                <input
                  type="number" min={1} max={600} value={ratePerMinute}
                  onChange={(e) => setRatePerMinute(Number(e.target.value) || 1)}
                  className="input w-24 text-sm"
                />
                <span className="text-xs text-ink-muted">mensajes por minuto</span>
              </div>
              <p className="text-[11px] text-ink-subtle mt-1">
                Meta limita a cuántas personas distintas se les puede escribir por día, y un número nuevo
                arranca con un límite bajo. Ir despacio también cuida la calificación de calidad de la línea.
                A {ratePerMinute}/min, {preview.ready} mensajes tardan {Math.ceil(preview.ready / ratePerMinute)} min.
              </p>
            </section>
          )}
        </div>

        <div className="flex gap-2 mt-6">
          <button onClick={onClose} className="btn-secondary flex-1">Cancelar</button>
          <button onClick={handleCreate} disabled={!canCreate || isSaving} className="btn-primary flex-1">
            {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Crear campaña
          </button>
        </div>
        <p className="text-[11px] text-ink-subtle text-center mt-2">
          Crear la campaña no manda nada todavía. Después la revisás y la arrancás vos.
        </p>
      </div>
    </div>
  );
}
