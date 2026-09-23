'use client';
import { useEffect, useState } from 'react';
import {
  aiCreditsApi, type AiCreditTenantRow, type AiPlatformSettings,
  type AiCreditLot, type AiCreditEntry,
} from '@/lib/api';
import ModalPortal from '@/components/ui/ModalPortal';
import {
  Coins, Loader2, Plus, X, Check, Eye, EyeOff, ChevronDown, ChevronRight,
  Building2, AlertTriangle, PowerOff, Power,
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import toast from 'react-hot-toast';
import clsx from 'clsx';

/**
 * El panel de créditos de IA del super admin.
 *
 * Es la única pantalla donde se ve el costo real del proveedor y el margen: son números
 * de quien opera el servidor, no del cliente. La empresa ve su saldo en su propia
 * pantalla de IA, sin costos ni márgenes.
 */

const MODELS = [
  { id: 'gpt-4o-mini', label: 'Económico', desc: 'Acertó 22 de 24 en la prueba. 1 crédito por respuesta' },
  { id: 'gpt-4o', label: 'Avanzado', desc: 'Acertó 23 de 24. Unos 8 créditos por respuesta' },
];

const LOT_LABEL: Record<string, string> = {
  MONTHLY_ALLOCATION: 'Incluidos del plan',
  PURCHASE: 'Comprados',
  BONUS: 'Bonificados',
  ADJUSTMENT: 'Ajuste',
};

const ENTRY_LABEL: Record<string, string> = {
  MONTHLY_ALLOCATION: 'Asignación mensual',
  PURCHASE: 'Compra',
  BONUS: 'Bonificación',
  AI_USAGE: 'Consumo',
  EXPIRATION: 'Vencimiento',
  REFUND: 'Reintegro',
  ADJUSTMENT: 'Ajuste',
};

const usd = (n: number) => (n >= 1 ? `US$${n.toFixed(2)}` : `US$${n.toFixed(4)}`);

export default function AiCreditsPage() {
  const [loading, setLoading] = useState(true);
  const [settings, setSettings] = useState<AiPlatformSettings | null>(null);
  const [tenants, setTenants] = useState<AiCreditTenantRow[]>([]);
  const [period, setPeriod] = useState<'today' | 'week' | 'month'>('month');
  const [granting, setGranting] = useState<AiCreditTenantRow | null>(null);
  const [detail, setDetail] = useState<AiCreditTenantRow | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [s, o] = await Promise.all([aiCreditsApi.getSettings(), aiCreditsApi.overview(period)]);
      setSettings(s);
      setTenants(o.tenants);
    } catch {
      toast.error('Error al cargar los créditos');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [period]);

  async function toggleMode(row: AiCreditTenantRow) {
    const next = row.billingMode === 'PLATFORM' ? 'BYOK' : 'PLATFORM';
    try {
      await aiCreditsApi.updateTenant(row.tenantId, { billingMode: next });
      toast.success(next === 'PLATFORM' ? `${row.name} pasa a consumir créditos` : `${row.name} vuelve a su propia clave`);
      load();
    } catch {
      toast.error('No se pudo cambiar el modo de cobro');
    }
  }

  async function toggleEnabled(row: AiCreditTenantRow) {
    try {
      await aiCreditsApi.updateTenant(row.tenantId, { aiEnabled: !row.aiEnabled });
      toast.success(row.aiEnabled ? 'IA suspendida' : 'IA habilitada');
      load();
    } catch {
      toast.error('No se pudo cambiar el estado');
    }
  }

  const platform = tenants.filter((t) => t.billingMode === 'PLATFORM');
  const totalMargin = tenants.reduce((n, t) => n + t.marginUsd, 0);
  const totalCost = tenants.reduce((n, t) => n + t.costUsd, 0);

  return (
    <div className="max-w-4xl mx-auto py-10 px-6 animate-fade-in">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-xl font-bold text-ink mb-1" style={{ letterSpacing: '-0.02em' }}>Créditos de IA</h1>
          <p className="text-sm text-ink-muted">Quién consume IA, cuánto nos cuesta y cuánto saldo le queda</p>
        </div>
        <div className="flex rounded-lg overflow-hidden border border-border shrink-0">
          {(['today', 'week', 'month'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={clsx('px-3 py-1.5 text-xs font-medium',
                period === p ? 'bg-black/5 text-ink' : 'text-ink-muted hover:bg-black/[0.03]')}
            >
              {p === 'today' ? 'Hoy' : p === 'week' ? '7 días' : '30 días'}
            </button>
          ))}
        </div>
      </div>

      {/* Ayuda plegada: se abre solo si alguien la busca. */}
      <button
        onClick={() => setShowHelp((v) => !v)}
        className="w-full card px-5 py-3 mb-5 flex items-center gap-2 text-left hover:bg-black/[0.02]"
      >
        {showHelp ? <ChevronDown className="w-4 h-4 text-ink-subtle" /> : <ChevronRight className="w-4 h-4 text-ink-subtle" />}
        <span className="text-sm font-medium text-ink">¿Cómo funcionan los créditos de IA?</span>
      </button>
      {showHelp && (
        <div className="card p-5 mb-5 text-sm text-ink-muted space-y-2.5">
          <p>
            Una empresa en <strong>clave propia</strong> le paga directamente al proveedor: se mide
            lo que gasta, pero no se le cobra nada. Una empresa en <strong>créditos</strong> usa
            nuestra clave y cada respuesta le descuenta del saldo.
          </p>
          <p>
            Antes de cada llamada se reserva el costo máximo posible y, cuando el proveedor
            responde, se liquida lo que costó de verdad. <strong>Sin saldo no hay llamada</strong>:
            la conversación pasa a un agente y el cliente final nunca se entera de que hay créditos
            de por medio.
          </p>
          <p>
            Los créditos incluidos en un plan vencen al cerrar el período; los comprados no. Siempre
            se gasta primero lo que está por vencer.
          </p>
          <p className="text-xs text-ink-subtle">
            1 crédito = {settings ? usd(settings.creditUsdValue) : 'US$0,001'} de valor comercial.
            Acreditar créditos deja un movimiento en el libro mayor: nunca se toca un saldo a mano.
          </p>
        </div>
      )}

      {loading ? (
        <div className="card flex items-center justify-center h-32">
          <Loader2 className="w-5 h-5 animate-spin text-ink-muted" />
        </div>
      ) : (
        <>
          <PlatformCard settings={settings} onSaved={(s) => setSettings(s)} />

          <div className="card overflow-hidden mt-5">
            <div className="px-5 py-3.5 border-b border-border flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-ink">Empresas</p>
                <p className="text-xs text-ink-subtle">
                  {platform.length} con créditos · {tenants.length - platform.length} con clave propia
                </p>
              </div>
              {totalCost > 0 && (
                <div className="text-right">
                  <p className="text-xs text-ink-muted">Margen del período</p>
                  <p className="text-sm font-semibold text-ink">{usd(totalMargin)}</p>
                </div>
              )}
            </div>

            {tenants.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
                <Building2 className="w-7 h-7 text-ink-subtle mb-2" />
                <p className="text-sm font-medium text-ink mb-1">No hay empresas activas</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {tenants.map((t) => (
                  <div key={t.tenantId} className="px-5 py-3.5 flex items-center gap-3">
                    <button onClick={() => setDetail(t)} className="flex-1 min-w-0 text-left">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-ink truncate">{t.name}</p>
                        {t.billingMode === 'PLATFORM' && !t.aiEnabled && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ background: '#FEF2F2', color: '#DC2626' }}>
                            IA suspendida
                          </span>
                        )}
                        {t.billingMode === 'PLATFORM' && t.aiEnabled && t.spendable <= 0 && (
                          <span className="text-[10px] font-medium px-1.5 py-0.5 rounded" style={{ background: '#FFFBEB', color: '#D97706' }}>
                            Sin saldo
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-ink-subtle">
                        {t.calls > 0
                          ? `${t.calls} respuestas · ${t.creditsUsed} créditos · nos costó ${usd(t.costUsd)}`
                          : 'Sin consumo en el período'}
                      </p>
                    </button>

                    <button
                      onClick={() => toggleMode(t)}
                      className={clsx('text-[11px] font-medium px-2 py-1 rounded-md shrink-0',
                        t.billingMode === 'PLATFORM' ? 'text-ink' : 'text-ink-muted')}
                      style={t.billingMode === 'PLATFORM'
                        ? { background: '#EFF6FF', color: '#2563EB' }
                        : { background: 'var(--surface-muted)' }}
                      title="Cambiar quién paga la IA de esta empresa"
                    >
                      {t.billingMode === 'PLATFORM' ? 'Créditos' : 'Clave propia'}
                    </button>

                    {t.billingMode === 'PLATFORM' && (
                      <>
                        <div className="text-right shrink-0 w-24">
                          <p className="text-sm font-semibold text-ink">{t.balance.toLocaleString('es')}</p>
                          <p className="text-[11px] text-ink-subtle">
                            {t.reserved > 0 ? `${t.reserved} en uso` : 'créditos'}
                          </p>
                        </div>
                        <button
                          onClick={() => toggleEnabled(t)}
                          className="w-7 h-7 rounded-lg flex items-center justify-center text-ink-subtle hover:text-ink hover:bg-black/5 shrink-0"
                          title={t.aiEnabled ? 'Suspender la IA sin tocar el saldo' : 'Volver a habilitar la IA'}
                        >
                          {t.aiEnabled ? <PowerOff className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}
                        </button>
                        <button onClick={() => setGranting(t)} className="btn-secondary shrink-0 !px-2.5 !py-1.5" title="Acreditar créditos">
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          <p className="text-[11px] text-ink-subtle mt-4">
            Acreditá solo contra un pago confirmado. La carga queda registrada con tu usuario y la
            nota que escribas, y no se puede borrar: una corrección es otro movimiento.
          </p>
        </>
      )}

      {granting && (
        <GrantModal
          tenant={granting}
          creditUsdValue={settings?.creditUsdValue ?? 0.001}
          onClose={() => setGranting(null)}
          onDone={() => { setGranting(null); load(); }}
        />
      )}
      {detail && <DetailModal row={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}

/** Clave, modelo y los tres parámetros comerciales. */
function PlatformCard({ settings, onSaved }: { settings: AiPlatformSettings | null; onSaved: (s: AiPlatformSettings) => void }) {
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [model, setModel] = useState(settings?.platformModel ?? 'gpt-4o-mini');
  const [markup, setMarkup] = useState(String(settings?.markupFactor ?? 2));
  const [creditValue, setCreditValue] = useState(String(settings?.creditUsdValue ?? 0.001));
  const [minCredits, setMinCredits] = useState(String(settings?.minCreditsPerOp ?? 1));
  const [trial, setTrial] = useState(String(settings?.trialCredits ?? 0));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setModel(settings.platformModel);
    setMarkup(String(settings.markupFactor));
    setCreditValue(String(settings.creditUsdValue));
    setMinCredits(String(settings.minCreditsPerOp));
    setTrial(String(settings.trialCredits));
  }, [settings]);

  async function save() {
    setSaving(true);
    try {
      const saved = await aiCreditsApi.updateSettings({
        ...(key.trim() ? { platformApiKey: key.trim() } : {}),
        platformModel: model,
        markupFactor: Number(markup),
        creditUsdValue: Number(creditValue),
        minCreditsPerOp: Number(minCredits),
        trialCredits: Number(trial),
      });
      setKey('');
      onSaved(saved);
      toast.success('Configuración guardada');
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card p-5">
      <p className="text-sm font-semibold text-ink mb-1">Configuración de la plataforma</p>
      <p className="text-xs text-ink-subtle mb-4">
        Con esta clave se atiende a las empresas que consumen créditos. Las que usan su propia clave
        no la tocan.
      </p>

      <label className="block text-xs font-medium text-ink-muted mb-1.5">Clave de OpenAI de la plataforma</label>
      <div className="relative mb-4">
        <input
          type={showKey ? 'text' : 'password'}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder={settings?.hasPlatformKey ? settings.platformKeyPreview ?? 'Ya configurada' : 'sk-...'}
          className="input w-full pr-10"
        />
        <button
          type="button"
          onClick={() => setShowKey((v) => !v)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-subtle hover:text-ink"
        >
          {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>

      <label className="block text-xs font-medium text-ink-muted mb-1.5">Modelo</label>
      <div className="grid grid-cols-2 gap-2 mb-4">
        {MODELS.map((m) => (
          <button
            key={m.id}
            onClick={() => setModel(m.id)}
            className={clsx('text-left px-3 py-2.5 rounded-lg border',
              model === m.id ? 'border-transparent' : 'border-border hover:bg-black/[0.02]')}
            style={model === m.id ? { background: '#EFF6FF', borderColor: '#BFDBFE' } : undefined}
          >
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-medium text-ink">{m.label}</p>
              {model === m.id && <Check className="w-3.5 h-3.5" style={{ color: '#2563EB' }} />}
            </div>
            <p className="text-[11px] text-ink-subtle leading-snug mt-0.5">{m.desc}</p>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-ink-muted mb-1.5">Markup</label>
          <input value={markup} onChange={(e) => setMarkup(e.target.value)} className="input w-full" inputMode="decimal" />
          <p className="text-[10px] text-ink-subtle mt-1">Sobre el costo real</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-muted mb-1.5">Valor del crédito</label>
          <input value={creditValue} onChange={(e) => setCreditValue(e.target.value)} className="input w-full" inputMode="decimal" />
          <p className="text-[10px] text-ink-subtle mt-1">En dólares de venta</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-ink-muted mb-1.5">Mínimo por respuesta</label>
          <input value={minCredits} onChange={(e) => setMinCredits(e.target.value)} className="input w-full" inputMode="numeric" />
          <p className="text-[10px] text-ink-subtle mt-1">Nunca cobra cero</p>
        </div>
      </div>

      <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
        <label className="block text-xs font-medium text-ink-muted mb-1.5">
          Créditos de prueba para empresas nuevas
        </label>
        <input value={trial} onChange={(e) => setTrial(e.target.value)} className="input w-full" inputMode="numeric" />
        <p className="text-[11px] text-ink-subtle mt-1">
          Con cuántos créditos nace una empresa al darla de alta. En 0 no recibe ninguno y su
          asistente queda apagado hasta que le acredites el primer paquete.
        </p>
      </div>

      <div className="flex justify-end mt-4">
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Guardar
        </button>
      </div>
    </div>
  );
}

function GrantModal({ tenant, creditUsdValue, onClose, onDone }: {
  tenant: AiCreditTenantRow;
  creditUsdValue: number;
  onClose: () => void;
  onDone: () => void;
}) {
  const [credits, setCredits] = useState('5000');
  const [kind, setKind] = useState('PURCHASE');
  const [expiresAt, setExpiresAt] = useState('');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  const amount = Number(credits) || 0;

  async function submit() {
    if (amount < 1) { toast.error('Indicá cuántos créditos acreditar'); return; }
    setSaving(true);
    try {
      await aiCreditsApi.grant(tenant.tenantId, {
        credits: amount,
        kind,
        expiresAt: expiresAt || null,
        note: note.trim() || undefined,
      });
      toast.success(`${amount.toLocaleString('es')} créditos acreditados a ${tenant.name}`);
      onDone();
    } catch (e: any) {
      toast.error(e?.response?.data?.message || 'No se pudo acreditar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
        <div className="card w-full max-w-md p-5" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-sm font-semibold text-ink">Acreditar créditos</p>
              <p className="text-xs text-ink-subtle">{tenant.name} · saldo actual {tenant.balance.toLocaleString('es')}</p>
            </div>
            <button onClick={onClose} className="text-ink-subtle hover:text-ink"><X className="w-4 h-4" /></button>
          </div>

          <label className="block text-xs font-medium text-ink-muted mb-1.5">Créditos</label>
          <input value={credits} onChange={(e) => setCredits(e.target.value)} className="input w-full mb-1" inputMode="numeric" />
          <p className="text-[11px] text-ink-subtle mb-4">
            Equivalen a {(amount * creditUsdValue).toFixed(2)} dólares de valor comercial
          </p>

          <label className="block text-xs font-medium text-ink-muted mb-1.5">Tipo</label>
          <div className="grid grid-cols-2 gap-2 mb-4">
            {Object.entries(LOT_LABEL).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setKind(id)}
                className={clsx('px-3 py-2 rounded-lg border text-sm',
                  kind === id ? 'border-transparent text-ink' : 'border-border text-ink-muted hover:bg-black/[0.02]')}
                style={kind === id ? { background: '#EFF6FF', borderColor: '#BFDBFE' } : undefined}
              >
                {label}
              </button>
            ))}
          </div>

          <label className="block text-xs font-medium text-ink-muted mb-1.5">Vence el (opcional)</label>
          <input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} className="input w-full mb-1" />
          <p className="text-[11px] text-ink-subtle mb-4">
            Vacío = no vence. Lo incluido en un plan debería vencer al cerrar el período.
          </p>

          <label className="block text-xs font-medium text-ink-muted mb-1.5">Nota</label>
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Contra qué pago se acredita"
            className="input w-full mb-4"
          />

          <div className="flex items-start gap-2 p-2.5 rounded-lg mb-4" style={{ background: '#FFFBEB' }}>
            <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: '#D97706' }} />
            <p className="text-[11px]" style={{ color: '#92400E' }}>
              Acreditá solo con el pago confirmado. El movimiento queda a tu nombre y no se borra.
            </p>
          </div>

          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="btn-secondary">Cancelar</button>
            <button onClick={submit} disabled={saving} className="btn-primary">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Coins className="w-4 h-4" />}
              Acreditar
            </button>
          </div>
        </div>
      </div>
    </ModalPortal>
  );
}

function DetailModal({ row, onClose }: { row: AiCreditTenantRow; onClose: () => void }) {
  const [lots, setLots] = useState<AiCreditLot[]>([]);
  const [entries, setEntries] = useState<AiCreditEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    aiCreditsApi.tenantDetail(row.tenantId)
      .then((d) => { setLots(d.lots); setEntries(d.entries); })
      .catch(() => toast.error('Error al cargar el detalle'))
      .finally(() => setLoading(false));
  }, [row.tenantId]);

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
        <div className="card w-full max-w-lg max-h-[80vh] overflow-auto p-5" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-sm font-semibold text-ink">{row.name}</p>
              <p className="text-xs text-ink-subtle">
                {row.billingMode === 'PLATFORM'
                  ? `${row.balance.toLocaleString('es')} créditos · nos costó ${usd(row.costUsd)} en el período`
                  : 'Usa su propia clave: se mide, no se cobra'}
              </p>
            </div>
            <button onClick={onClose} className="text-ink-subtle hover:text-ink"><X className="w-4 h-4" /></button>
          </div>

          {loading ? (
            <div className="flex items-center justify-center h-24">
              <Loader2 className="w-5 h-5 animate-spin text-ink-muted" />
            </div>
          ) : (
            <>
              {lots.length > 0 && (
                <>
                  <p className="text-xs font-semibold text-ink-muted mb-2">Lotes con saldo</p>
                  <div className="space-y-1.5 mb-5">
                    {lots.map((l) => (
                      <div key={l.id} className="flex items-center justify-between px-3 py-2 rounded-lg" style={{ background: 'var(--surface-muted)' }}>
                        <div>
                          <p className="text-xs font-medium text-ink">{LOT_LABEL[l.kind] ?? l.kind}</p>
                          <p className="text-[11px] text-ink-subtle">
                            {l.expiresAt
                              ? `Vence el ${format(new Date(l.expiresAt), "d 'de' MMMM", { locale: es })}`
                              : 'No vence'}
                          </p>
                        </div>
                        <p className="text-xs text-ink">
                          {l.remaining.toLocaleString('es')} <span className="text-ink-subtle">de {l.credits.toLocaleString('es')}</span>
                        </p>
                      </div>
                    ))}
                  </div>
                </>
              )}

              <p className="text-xs font-semibold text-ink-muted mb-2">Últimos movimientos</p>
              {entries.length === 0 ? (
                <p className="text-xs text-ink-subtle">Todavía no hay movimientos.</p>
              ) : (
                <div className="divide-y divide-border">
                  {entries.map((e) => (
                    <div key={e.id} className="flex items-center justify-between py-2">
                      <div className="min-w-0">
                        <p className="text-xs text-ink">{ENTRY_LABEL[e.kind] ?? e.kind}</p>
                        <p className="text-[11px] text-ink-subtle truncate">
                          {format(new Date(e.createdAt), "d MMM HH:mm", { locale: es })}
                          {e.note ? ` · ${e.note}` : ''}
                        </p>
                      </div>
                      <div className="text-right shrink-0 pl-3">
                        <p className={clsx('text-xs font-medium', e.credits >= 0 ? 'text-ink' : 'text-ink-muted')}>
                          {e.credits >= 0 ? '+' : ''}{e.credits.toLocaleString('es')}
                        </p>
                        <p className="text-[11px] text-ink-subtle">queda {e.balanceAfter.toLocaleString('es')}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </ModalPortal>
  );
}
