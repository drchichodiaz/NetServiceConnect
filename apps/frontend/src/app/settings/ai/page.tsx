'use client';
import { useEffect, useState } from 'react';
import { settingsApi, aiCreditsApi, type MyAiCredits } from '@/lib/api';
import {
  Sparkles, Eye, EyeOff, Check, Loader2,
  AlertCircle, CheckCircle, ChevronDown, Trash2, Coins,
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import toast from 'react-hot-toast';
import clsx from 'clsx';

const MODELS = [
  { id: 'gpt-4o-mini', label: 'GPT-4o Mini', desc: 'Rápido y económico — recomendado' },
  { id: 'gpt-4o',      label: 'GPT-4o',      desc: 'Más inteligente, mayor costo' },
  { id: 'gpt-4-turbo', label: 'GPT-4 Turbo', desc: 'Alta capacidad, contexto largo' },
];

export default function AiSettingsPage() {
  const [loading,     setLoading]     = useState(true);
  const [saving,      setSaving]      = useState(false);
  const [hasKey,      setHasKey]      = useState(false);
  const [keySource,   setKeySource]   = useState<'db' | 'env' | null>(null);
  const [keyPreview,  setKeyPreview]  = useState<string | null>(null);
  const [model,       setModel]       = useState('gpt-4o-mini');
  const [modelOpen,   setModelOpen]   = useState(false);

  // Form state
  const [apiKey,      setApiKey]      = useState('');
  const [showKey,     setShowKey]     = useState(false);
  // Saldo de creditos. Solo existe si la empresa esta en modo plataforma; si trae su
  // propia clave, este bloque no aparece y la pantalla es la de siempre.
  const [credits,     setCredits]     = useState<MyAiCredits | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const data = await settingsApi.get();
      setHasKey(data.hasOpenaiKey);
      setKeySource(data.keySource);
      setKeyPreview(data.openaiKeyPreview);
      setModel(data.openaiModel);

      const mine = await aiCreditsApi.me().catch(() => null);
      setCredits(mine && mine.billingMode === 'PLATFORM' ? mine : null);
    } catch {
      toast.error('Error al cargar configuración');
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!apiKey.trim()) {
      toast.error('Ingresa una clave de API');
      return;
    }
    if (!apiKey.startsWith('sk-')) {
      toast.error('La clave debe comenzar con sk-');
      return;
    }
    setSaving(true);
    try {
      await settingsApi.update({ openaiApiKey: apiKey.trim(), openaiModel: model });
      setApiKey('');
      toast.success('Configuración guardada');
      await load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Error al guardar');
    } finally {
      setSaving(false);
    }
  }

  async function handleUpdateModel(newModel: string) {
    setModel(newModel);
    setModelOpen(false);
    try {
      await settingsApi.update({ openaiModel: newModel });
      toast.success('Modelo actualizado');
    } catch {
      toast.error('Error al actualizar el modelo');
    }
  }

  async function handleRemoveKey() {
    if (!confirm('¿Eliminar la clave de OpenAI? La sugerencia con IA dejará de funcionar.')) return;
    try {
      await settingsApi.update({ openaiApiKey: '' });
      setApiKey('');
      toast.success('Clave eliminada');
      await load();
    } catch {
      toast.error('Error al eliminar la clave');
    }
  }

  const selectedModel = MODELS.find((m) => m.id === model) ?? MODELS[0];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 rounded-full border-2 border-purple-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto py-10 px-6 animate-fade-in">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-1">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: '#F3E8FF' }}
          >
            <Sparkles className="w-4 h-4" style={{ color: '#9333EA' }} />
          </div>
          <h1 className="text-xl font-bold text-ink" style={{ letterSpacing: '-0.02em' }}>
            Configuración de IA
          </h1>
        </div>
        <p className="text-sm text-ink-muted mt-1">
          Conecta tu cuenta de OpenAI para usar sugerencias de respuesta con IA en el inbox.
        </p>
      </div>

      {credits && <CreditsCard credits={credits} />}

      {!credits && (
      <>
      {/* Status card */}
      <div
        className="card p-4 flex items-center gap-3 mb-6"
        style={{ border: `1px solid ${hasKey ? '#E9D5FF' : 'var(--border)'}` }}
      >
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: hasKey ? '#F3E8FF' : 'var(--surface-muted)' }}
        >
          {hasKey
            ? <CheckCircle className="w-5 h-5" style={{ color: '#9333EA' }} />
            : <AlertCircle className="w-5 h-5 text-ink-muted" />}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-ink">
            {hasKey ? 'Clave de API configurada' : 'Sin clave de API'}
          </p>
          <p className="text-xs text-ink-muted truncate">
            {hasKey ? keyPreview : 'Agrega tu clave de OpenAI para activar la IA'}
          </p>
        </div>
        {hasKey && (
          <button
            onClick={handleRemoveKey}
            className="btn-ghost w-8 h-8 p-0 shrink-0 hover:text-red-500"
            title="Eliminar clave"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* API Key form */}
      <div className="card p-5 mb-4">
        <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-4">
          {hasKey ? 'Reemplazar clave de API' : 'Agregar clave de API'}
        </p>

        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-ink flex items-center justify-between">
              <span>Clave de OpenAI <span className="text-red-400">*</span></span>
              <a
                href="https://platform.openai.com/api-keys"
                target="_blank"
                rel="noopener noreferrer"
                className="text-purple-500 hover:text-purple-600 font-normal normal-case"
              >
                Obtener clave →
              </a>
            </label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-proj-..."
                className="input w-full pr-10 font-mono text-sm"
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-subtle hover:text-ink transition-colors"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-[11px] text-ink-subtle">
              La clave se guarda cifrada y nunca se expone completa en la interfaz.
            </p>
          </div>

          <button
            type="submit"
            disabled={saving || !apiKey.trim()}
            className="w-full flex items-center justify-center gap-2 font-semibold py-2.5 px-4 rounded-xl
                       transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm text-white"
            style={{ background: saving || !apiKey.trim() ? '#C084FC' : '#9333EA' }}
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {hasKey ? 'Reemplazar clave' : 'Guardar clave'}
          </button>
        </form>
      </div>

      {/* Model selector */}
      <div className="card p-5">
        <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-4">
          Modelo de IA
        </p>

        <div className="relative">
          <button
            onClick={() => setModelOpen(!modelOpen)}
            className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl border
                       border-border bg-surface-muted hover:bg-white transition-all text-left"
          >
            <div>
              <p className="text-sm font-semibold text-ink">{selectedModel.label}</p>
              <p className="text-xs text-ink-muted">{selectedModel.desc}</p>
            </div>
            <ChevronDown
              className={clsx('w-4 h-4 text-ink-muted transition-transform', modelOpen && 'rotate-180')}
            />
          </button>

          {modelOpen && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setModelOpen(false)} />
              <div
                className="absolute left-0 right-0 top-full mt-1 bg-white rounded-xl shadow-float z-20
                           overflow-hidden animate-pop"
                style={{ border: '1px solid var(--border)' }}
              >
                {MODELS.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => handleUpdateModel(m.id)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-surface-muted
                               transition-colors text-left"
                  >
                    <div>
                      <p className="text-sm font-medium text-ink">{m.label}</p>
                      <p className="text-xs text-ink-muted">{m.desc}</p>
                    </div>
                    {model === m.id && (
                      <Check className="w-4 h-4 shrink-0" style={{ color: '#9333EA' }} />
                    )}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>

        <p className="text-[11px] text-ink-subtle mt-3">
          GPT-4o Mini es suficiente para sugerencias de soporte. Usa GPT-4o si necesitas respuestas más elaboradas.
        </p>
      </div>
      </>
      )}
    </div>
  );
}

/**
 * El saldo de la empresa.
 *
 * No muestra costos del proveedor ni márgenes: eso es información de quien opera el
 * servicio. Acá solo se ve cuánto queda, cuánto se usó y cuándo vence.
 */
function CreditsCard({ credits }: { credits: MyAiCredits }) {
  const total = credits.balance + credits.creditsUsed;
  const low = credits.balance <= 0 || credits.usagePercent >= 90;
  const color = credits.balance <= 0 ? '#DC2626' : credits.usagePercent >= 90 ? '#D97706' : '#9333EA';

  return (
    <div className="card p-5 mb-6">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: '#F3E8FF' }}>
            <Coins className="w-4 h-4" style={{ color: '#9333EA' }} />
          </div>
          <div>
            <p className="text-sm font-semibold text-ink">Créditos de IA</p>
            <p className="text-xs text-ink-muted">
              {credits.enabled ? 'Tu plan incluye el uso de IA' : 'La IA está suspendida en tu cuenta'}
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-xl font-bold text-ink" style={{ letterSpacing: '-0.02em' }}>
            {credits.balance.toLocaleString('es')}
          </p>
          <p className="text-[11px] text-ink-subtle">disponibles</p>
        </div>
      </div>

      <div className="h-2 rounded-full overflow-hidden mb-2" style={{ background: 'var(--surface-muted)' }}>
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${Math.min(100, credits.usagePercent)}%`, background: color }}
        />
      </div>

      <div className="flex items-center justify-between text-[11px] text-ink-subtle mb-3">
        <span>
          {credits.creditsUsed.toLocaleString('es')} usados
          {total > 0 ? ` de ${total.toLocaleString('es')}` : ''} ({credits.usagePercent}%)
        </span>
        {credits.nextExpiration && (
          <span>
            Vencen el {format(new Date(credits.nextExpiration), "d 'de' MMMM", { locale: es })}
          </span>
        )}
      </div>

      {low && (
        <div
          className="flex items-start gap-2 p-2.5 rounded-lg mb-3"
          style={{ background: credits.balance <= 0 ? '#FEF2F2' : '#FFFBEB' }}
        >
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color }} />
          <p className="text-[11px]" style={{ color: credits.balance <= 0 ? '#991B1B' : '#92400E' }}>
            {credits.balance <= 0
              ? 'Se agotaron tus créditos. El bot deriva las consultas a un agente hasta que se recarguen. El resto del sistema sigue funcionando normalmente.'
              : 'Te queda poco saldo de IA. Cuando llegue a cero, las consultas pasan a un agente.'}
          </p>
        </div>
      )}

      {credits.entries.length > 0 && (
        <details className="group">
          <summary className="text-xs text-ink-muted cursor-pointer list-none flex items-center gap-1.5">
            <ChevronDown className="w-3.5 h-3.5 transition-transform group-open:rotate-0 -rotate-90" />
            Ver movimientos
          </summary>
          <div className="divide-y divide-border mt-2">
            {credits.entries.map((e) => (
              <div key={e.id} className="flex items-center justify-between py-1.5">
                <p className="text-[11px] text-ink-muted">
                  {format(new Date(e.createdAt), 'd MMM HH:mm', { locale: es })}
                  {e.note ? ` · ${e.note}` : ''}
                </p>
                <p className="text-[11px] text-ink">
                  {e.credits >= 0 ? '+' : ''}{e.credits.toLocaleString('es')}
                </p>
              </div>
            ))}
          </div>
        </details>
      )}

      <p className="text-[11px] text-ink-subtle mt-3">
        Cada respuesta de IA consume créditos según lo que necesite para responder. Para recargar,
        escribinos.
      </p>
    </div>
  );
}
