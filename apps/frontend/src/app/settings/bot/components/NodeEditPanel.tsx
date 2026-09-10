'use client';
import { useEffect, useState } from 'react';
import { Trash2, Loader2, Plus, X, Play, Plug, AlertCircle, CheckCircle } from 'lucide-react';
import { MenuNode, MenuNodeType } from '@/lib/sortable-tree';
import { menuNodesApi, LookupConfig, LookupTestResult } from '@/lib/api';
import { TYPE_LABEL, ADDABLE_TYPES } from './MenuNodeRow';
import InfoTooltip from '@/components/ui/InfoTooltip';

interface FormState {
  title: string;
  subtitle: string;
  bodyText: string;
  promptText: string;
  active: boolean;
}

interface SavePatch extends Partial<FormState> {
  config?: LookupConfig;
}

interface Props {
  node: MenuNode;
  descendantCount: number;
  saving: boolean;
  onSave: (patch: SavePatch) => void;
  onDelete: () => void;
  onAddChild: (type: MenuNodeType) => void;
  onClose: () => void;
}

function toForm(node: MenuNode): FormState {
  return {
    title: node.title,
    subtitle: node.subtitle ?? '',
    bodyText: node.bodyText ?? '',
    promptText: node.promptText ?? '',
    active: node.active,
  };
}

export default function NodeEditPanel({ node, descendantCount, saving, onSave, onDelete, onAddChild, onClose }: Props) {
  const [form, setForm] = useState<FormState>(toForm(node));
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [showAddMenu, setShowAddMenu] = useState(false);

  useEffect(() => {
    setForm(toForm(node));
    setConfirmingDelete(false);
    setShowAddMenu(false);
  }, [node.id]);

  function saveField<K extends keyof FormState>(key: K, value: FormState[K]) {
    const next = { ...form, [key]: value };
    setForm(next);
    onSave({ [key]: value } as Partial<FormState>);
  }

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">{TYPE_LABEL[node.type]}</p>
        <div className="flex items-center gap-2">
          {saving && <Loader2 className="w-3.5 h-3.5 animate-spin text-ink-subtle" />}
          <button onClick={onClose} className="btn-ghost w-7 h-7 p-0">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-ink flex items-center gap-1.5">
          <span>Título</span>
          <InfoTooltip
            text="Es el texto que ve el cliente como opción del menú de WhatsApp. Elegilo corto y claro, porque WhatsApp lo corta a 24 caracteres."
            example="Horarios"
          />
        </label>
        <input
          value={form.title}
          onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
          onBlur={(e) => saveField('title', e.target.value)}
          className="input w-full text-sm"
          placeholder="Ej: Horarios"
        />
      </div>

      {(node.type === 'TEXT' || node.type === 'MENU') && (
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-ink flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <span>Descripción corta</span>
              <InfoTooltip
                text="Aparece chiquito debajo del título en la lista de WhatsApp. También es lo que el bot usa para encontrar esta opción cuando hay muchas y el cliente escribe en vez de tocar la lista."
                example="Costa del Este, Town Center"
              />
            </span>
            <span className="text-[10px] font-normal text-ink-subtle">Opcional</span>
          </label>
          <input
            value={form.subtitle}
            onChange={(e) => setForm((f) => ({ ...f, subtitle: e.target.value }))}
            onBlur={(e) => saveField('subtitle', e.target.value)}
            className="input w-full text-sm"
            placeholder="Ej: Av. Siempre Viva 742"
          />
        </div>
      )}

      {node.type === 'TEXT' && (
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-ink flex items-center gap-1.5">
            <span>Respuesta del bot</span>
            <InfoTooltip
              text="El mensaje que el bot envía apenas el cliente toca esta opción. Puedes escribir varias líneas, con emojis incluidos."
              example={'Lunes a sábado de 9am a 7pm\nDomingos de 10am a 4pm'}
            />
          </label>
          <textarea
            value={form.bodyText}
            onChange={(e) => setForm((f) => ({ ...f, bodyText: e.target.value }))}
            onBlur={(e) => saveField('bodyText', e.target.value)}
            rows={5}
            className="input w-full text-sm"
            placeholder="Lo que responde el bot cuando el cliente elige esta opción"
          />
        </div>
      )}

      {node.type === 'AI_CHAT' && (
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-ink flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <span>Mensaje de bienvenida</span>
              <InfoTooltip
                text="Lo primero que dice el bot al entrar a este modo, antes de empezar a responder con IA. Las respuestas del chat usan la información del negocio que cargaste en la sección 'Información del negocio (modo IA)', más abajo en esta página — no algo que se configure acá."
                example="Cuéntame qué necesitas y te ayudo."
              />
            </span>
            <span className="text-[10px] font-normal text-ink-subtle">Opcional</span>
          </label>
          <textarea
            value={form.bodyText}
            onChange={(e) => setForm((f) => ({ ...f, bodyText: e.target.value }))}
            onBlur={(e) => saveField('bodyText', e.target.value)}
            rows={2}
            className="input w-full text-sm"
            placeholder="Ej: Cuéntame en qué te puedo ayudar."
          />
        </div>
      )}

      {node.type === 'MENU' && (
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-ink flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <span>Texto del prompt</span>
              <InfoTooltip
                text="El mensaje que aparece arriba de la lista de opciones de este submenú. Si adentro hay más de 9 opciones, el bot deja de mostrar la lista y usa este mismo texto para pedirle al cliente que escriba lo que busca."
                example="¿Cuál es tu sucursal más cercana?"
              />
            </span>
            <span className="text-[10px] font-normal text-ink-subtle">Opcional</span>
          </label>
          <textarea
            value={form.promptText}
            onChange={(e) => setForm((f) => ({ ...f, promptText: e.target.value }))}
            onBlur={(e) => saveField('promptText', e.target.value)}
            rows={2}
            className="input w-full text-sm"
            placeholder='Ej: "¿Cuál es tu sucursal más cercana?"'
          />
        </div>
      )}

      {node.type === 'ORDER_LOOKUP' && (
        <>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-ink flex items-center gap-1.5">
              <span>Qué le pide el bot al cliente</span>
              <InfoTooltip
                text="El mensaje con el que el bot pide el dato a consultar. Ese dato es lo que después se manda al sistema externo."
                example="Decime tu número de pedido y te digo cómo viene."
              />
            </label>
            <textarea
              value={form.promptText}
              onChange={(e) => setForm((f) => ({ ...f, promptText: e.target.value }))}
              onBlur={(e) => saveField('promptText', e.target.value)}
              rows={2}
              className="input w-full text-sm"
              placeholder="Ej: Decime tu número de pedido"
            />
          </div>

          <LookupConfigSection node={node} onSave={onSave} />
        </>
      )}

      <div className="flex items-center justify-between pt-3" style={{ borderTop: '1px solid var(--border)' }}>
        <span className="text-xs font-semibold text-ink flex items-center gap-1.5">
          <span>Activa</span>
          <InfoTooltip
            text="Si la desactivas, esta opción (y sus opciones adentro, si tiene) deja de aparecer en el menú del bot, pero no se borra — la puedes reactivar cuando quieras."
            example="Una sucursal cerrada temporalmente"
          />
        </span>
        <button type="button" onClick={() => saveField('active', !form.active)}>
          <span
            className="w-9 h-5 rounded-full flex items-center px-0.5 transition-colors"
            style={{ background: form.active ? 'var(--green-dark)' : 'var(--border)' }}
          >
            <span
              className="w-4 h-4 rounded-full bg-white transition-transform"
              style={{ transform: form.active ? 'translateX(16px)' : 'translateX(0)' }}
            />
          </span>
        </button>
      </div>

      {node.type === 'MENU' && (
        <div className="pt-3" style={{ borderTop: '1px solid var(--border)' }}>
          {showAddMenu ? (
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-ink">Elige el tipo de opción</p>
              <div className="grid grid-cols-2 gap-2">
                {ADDABLE_TYPES.map((t) => (
                  <button
                    key={t.type}
                    onClick={() => { onAddChild(t.type); setShowAddMenu(false); }}
                    className="btn-secondary text-xs justify-start"
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              <button onClick={() => setShowAddMenu(false)} className="btn-ghost text-xs w-full">Cancelar</button>
            </div>
          ) : (
            <button onClick={() => setShowAddMenu(true)} className="btn-primary w-full text-sm">
              <Plus className="w-4 h-4" />
              Agregar opción adentro
            </button>
          )}
        </div>
      )}

      <div className="pt-3" style={{ borderTop: '1px solid var(--border)' }}>
        {confirmingDelete ? (
          <div className="space-y-2">
            <p className="text-xs text-ink-muted">
              {descendantCount > 0 && `Esto también elimina ${descendantCount} opción${descendantCount === 1 ? '' : 'es'} adentro. `}
              ¿Eliminar &quot;{node.title}&quot;?
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmingDelete(false)} className="btn-ghost text-xs flex-1">Cancelar</button>
              <button onClick={onDelete} className="btn-primary text-xs flex-1" style={{ background: '#EF4444' }}>
                Eliminar
              </button>
            </div>
          </div>
        ) : (
          <button onClick={() => setConfirmingDelete(true)} className="btn-ghost text-xs text-red-500 w-full justify-start">
            <Trash2 className="w-3.5 h-3.5" />
            Eliminar opción
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Conexión con un sistema externo (nodo ORDER_LOOKUP) ──────────────────────

/**
 * El bot le pide un dato al cliente, se lo manda a la API que configure el admin y
 * arma la respuesta con una plantilla. El botón "Probar" corre la consulta de verdad
 * y muestra el JSON crudo: sin eso, escribir la plantilla sería adivinar los nombres
 * de los campos y probar cada cambio mandándose un WhatsApp.
 */
function LookupConfigSection({ node, onSave }: { node: MenuNode; onSave: (patch: SavePatch) => void }) {
  const initial = (node.config ?? {}) as LookupConfig;
  const [cfg, setCfg] = useState<LookupConfig>(initial);
  const [authHeader, setAuthHeader] = useState(initial.headers?.Authorization ?? '');
  const [testValue, setTestValue] = useState('');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<LookupTestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  useEffect(() => {
    const next = (node.config ?? {}) as LookupConfig;
    setCfg(next);
    setAuthHeader(next.headers?.Authorization ?? '');
    setResult(null);
    setTestError(null);
  }, [node.id]);

  function persist(patch: Partial<LookupConfig>) {
    const next = { ...cfg, ...patch };
    setCfg(next);
    onSave({ config: next });
  }

  function persistAuth(value: string) {
    const headers = { ...(cfg.headers ?? {}) };
    if (value.trim()) headers.Authorization = value.trim();
    else delete headers.Authorization;
    persist({ headers });
  }

  async function runTest() {
    setTesting(true);
    setResult(null);
    setTestError(null);
    try {
      setResult(await menuNodesApi.testLookup(node.id, testValue));
    } catch (err: any) {
      setTestError(err?.response?.data?.message || 'No se pudo probar la consulta');
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="space-y-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
      <p className="text-xs font-semibold text-ink flex items-center gap-1.5">
        <Plug className="w-3.5 h-3.5" />
        Conexión con tu sistema
      </p>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-ink flex items-center gap-1.5">
          <span>URL de consulta</span>
          <InfoTooltip
            text="El endpoint al que el bot le pregunta. Escribí la variable de consulta donde va el dato que mandó el cliente — el bot lo reemplaza antes de llamar."
            example="https://tusistema.com/api/pedidos/{{consulta}}"
          />
        </label>
        <input
          value={cfg.apiUrl ?? ''}
          onChange={(e) => setCfg((c) => ({ ...c, apiUrl: e.target.value }))}
          onBlur={(e) => persist({ apiUrl: e.target.value })}
          className="input w-full text-xs font-mono"
          placeholder="https://tusistema.com/api/pedidos/{{consulta}}"
        />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-ink">Método</label>
          <select
            value={cfg.method ?? 'GET'}
            onChange={(e) => persist({ method: e.target.value })}
            className="input w-full text-xs"
          >
            <option value="GET">GET</option>
            <option value="POST">POST</option>
          </select>
        </div>
        <div className="col-span-2 space-y-1.5">
          <label className="text-xs font-semibold text-ink flex items-center gap-1.5">
            <span>Autorización</span>
            <InfoTooltip
              text="Se manda como header Authorization. Dejalo vacío si tu API es abierta."
              example="Bearer mi-token-secreto"
            />
          </label>
          <input
            value={authHeader}
            onChange={(e) => setAuthHeader(e.target.value)}
            onBlur={(e) => persistAuth(e.target.value)}
            className="input w-full text-xs font-mono"
            placeholder="Bearer ..."
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-ink flex items-center gap-1.5">
          <span>Respuesta al cliente</span>
          <InfoTooltip
            text="El mensaje que arma el bot con los datos que devolvió tu sistema. Poné el nombre exacto del campo entre llaves dobles; para datos anidados, objeto.campo. Probá abajo para ver los nombres reales."
            example="Tu pedido {{numero}} está {{estado}}."
          />
        </label>
        <textarea
          value={cfg.responseTemplate ?? ''}
          onChange={(e) => setCfg((c) => ({ ...c, responseTemplate: e.target.value }))}
          onBlur={(e) => persist({ responseTemplate: e.target.value })}
          rows={3}
          className="input w-full text-xs"
          placeholder="Tu pedido {{numero}} está {{estado}}."
        />
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-semibold text-ink flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            <span>Si no se encuentra</span>
            <InfoTooltip
              text="Qué responde el bot cuando tu sistema no devuelve nada. El cliente puede reintentar; después de varios intentos el bot lo pasa a un agente."
              example="No encontré el pedido {{consulta}}."
            />
          </span>
          <span className="text-[10px] font-normal text-ink-subtle">Opcional</span>
        </label>
        <input
          value={cfg.notFoundText ?? ''}
          onChange={(e) => setCfg((c) => ({ ...c, notFoundText: e.target.value }))}
          onBlur={(e) => persist({ notFoundText: e.target.value })}
          className="input w-full text-xs"
          placeholder="No encontré el pedido {{consulta}}."
        />
      </div>

      {/* Probador — corre la consulta de verdad contra el sistema del cliente */}
      <div
        className="rounded-xl p-3 space-y-2"
        style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
      >
        <p className="text-[11px] font-semibold text-ink">Probar la consulta</p>
        <div className="flex items-center gap-2">
          <input
            value={testValue}
            onChange={(e) => setTestValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') runTest(); }}
            className="input flex-1 text-xs font-mono"
            placeholder="Un número de ejemplo"
          />
          <button
            onClick={runTest}
            disabled={testing || !cfg.apiUrl?.trim()}
            className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1.5"
          >
            {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            Probar
          </button>
        </div>

        {testError && (
          <p className="text-[11px] flex items-start gap-1.5" style={{ color: '#B91C1C' }}>
            <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
            {testError}
          </p>
        )}

        {result && (
          <div className="space-y-2">
            {result.error ? (
              <p className="text-[11px] flex items-start gap-1.5" style={{ color: '#B91C1C' }}>
                <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
                {result.error}
              </p>
            ) : result.notFound ? (
              <p className="text-[11px]" style={{ color: '#D97706' }}>
                Tu sistema no devolvió resultados. El bot respondería:{' '}
                <span className="text-ink">{result.notFoundText}</span>
              </p>
            ) : (
              <div>
                <p className="text-[11px] font-semibold flex items-center gap-1.5 mb-1" style={{ color: '#128C7E' }}>
                  <CheckCircle className="w-3 h-3" />
                  El bot respondería:
                </p>
                <p
                  className="text-xs text-ink whitespace-pre-wrap rounded-lg px-2.5 py-2"
                  style={{ background: '#DCF8C6' }}
                >
                  {result.rendered || '(la plantilla quedó vacía — revisá los nombres de los campos abajo)'}
                </p>
              </div>
            )}

            {result.raw != null && (
              <details>
                <summary className="text-[11px] text-ink-subtle cursor-pointer">
                  Ver lo que devolvió tu sistema {result.status ? `(HTTP ${result.status})` : ''}
                </summary>
                <pre
                  className="mt-1 text-[10px] rounded-lg p-2 overflow-x-auto"
                  style={{ background: '#0F1117', color: '#E5E7EB', maxHeight: 200 }}
                >
                  {JSON.stringify(result.raw, null, 2)}
                </pre>
              </details>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
