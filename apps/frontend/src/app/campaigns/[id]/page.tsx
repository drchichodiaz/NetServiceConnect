'use client';
import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { campaignsApi } from '@/lib/api';
import type { Campaign } from '@/lib/api';
import { ArrowLeft, Play, Pause, XCircle, Loader2, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { STATUS_STYLES } from '../status';

export default function CampaignDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [failures, setFailures] = useState<{ recipientPhone: string; status: string; error?: string }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    campaignsApi
      .get(id)
      .then(setCampaign)
      .catch(() => toast.error('No se pudo cargar la campaña'))
      .finally(() => setIsLoading(false));
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    campaignsApi.failures(id).then(setFailures).catch(() => setFailures([]));
  }, [id, campaign?.sentCount, campaign?.status]);

  // El progreso lo mueve el worker del backend, así que hay que ir a buscarlo.
  useEffect(() => {
    if (campaign?.status !== 'RUNNING') return;
    const timer = setInterval(load, 4000);
    return () => clearInterval(timer);
  }, [campaign?.status, load]);

  async function act(action: 'start' | 'pause' | 'cancel') {
    if (action === 'cancel' && !confirm('Cancelar la campaña. Lo que ya se envió no se puede deshacer, y los pendientes no se van a enviar nunca. ¿Seguro?')) return;
    setBusy(true);
    try {
      await campaignsApi[action](id);
      load();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo completar la acción');
    } finally {
      setBusy(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-5 h-5 rounded-full border-2 border-green-500 border-t-transparent animate-spin" />
      </div>
    );
  }
  if (!campaign) return <div className="p-10 text-sm text-ink-muted">Campaña no encontrada</div>;

  const ss = STATUS_STYLES[campaign.status];
  const counts = campaign.counts ?? {};
  const pending = (counts.PENDING ?? 0) + (counts.SENDING ?? 0);
  const done = campaign.totalCount - pending;
  const pct = campaign.totalCount > 0 ? Math.round((done / campaign.totalCount) * 100) : 0;

  return (
    <div className="max-w-3xl mx-auto py-10 px-6 animate-fade-in">
      <Link href="/campaigns" className="inline-flex items-center gap-1.5 text-xs text-ink-muted hover:text-ink mb-4">
        <ArrowLeft className="w-3.5 h-3.5" /> Campañas
      </Link>

      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl font-bold text-ink" style={{ letterSpacing: '-0.02em' }}>{campaign.name}</h1>
            <span className="text-[11px] font-semibold rounded-full px-2.5 py-1" style={{ background: ss.bg, color: ss.color }}>
              {ss.label}
            </span>
          </div>
          <p className="text-sm text-ink-muted">
            Plantilla <strong>{campaign.template?.name}</strong> · desde{' '}
            {campaign.channelAccount?.label?.trim() || campaign.channelAccount?.phoneNumber}
            {campaign.createdBy?.name && <> · creada por {campaign.createdBy.name}</>}
          </p>
        </div>

        <div className="flex gap-2 shrink-0">
          {(campaign.status === 'DRAFT' || campaign.status === 'PAUSED') && (
            <button onClick={() => act('start')} disabled={busy} className="btn-primary">
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {campaign.status === 'DRAFT' ? 'Enviar' : 'Reanudar'}
            </button>
          )}
          {campaign.status === 'RUNNING' && (
            <button onClick={() => act('pause')} disabled={busy} className="btn-secondary">
              <Pause className="w-4 h-4" /> Pausar
            </button>
          )}
          {(campaign.status === 'DRAFT' || campaign.status === 'PAUSED' || campaign.status === 'RUNNING') && (
            <button onClick={() => act('cancel')} disabled={busy} className="btn-secondary">
              <XCircle className="w-4 h-4" /> Cancelar
            </button>
          )}
        </div>
      </div>

      {campaign.pausedReason && (
        <div className="card p-3.5 mb-5 flex items-start gap-2.5" style={{ borderColor: '#FDBA74' }}>
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: '#C2650A' }} />
          <div>
            <p className="text-sm font-medium text-ink">La campaña se frenó sola</p>
            <p className="text-xs text-ink-muted">{campaign.pausedReason}</p>
          </div>
        </div>
      )}

      <div className="card p-5 mb-5">
        <div className="flex items-baseline justify-between mb-2">
          <p className="text-sm font-semibold text-ink">Progreso</p>
          <p className="text-xs text-ink-muted">{done} de {campaign.totalCount}</p>
        </div>
        <div className="h-2 rounded-full overflow-hidden mb-4" style={{ background: 'var(--surface-muted)' }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: '#25D366' }} />
        </div>

        <div className="grid grid-cols-4 gap-3 text-center">
          <Stat label="Enviados"  value={counts.SENT ?? 0}    color="#128C7E" />
          <Stat label="Pendientes" value={pending}            color="#6B7280" />
          <Stat label="Salteados" value={counts.SKIPPED ?? 0} color="#C2650A" />
          <Stat label="Fallidos"  value={counts.FAILED ?? 0}  color="#B91C1C" />
        </div>

        {campaign.status === 'RUNNING' && (
          <p className="text-[11px] text-ink-subtle mt-3 text-center">
            Enviando a {campaign.ratePerMinute} por minuto. Podés cerrar esta pantalla: sigue solo.
          </p>
        )}
      </div>

      {failures.length > 0 && (
        <div className="card overflow-hidden">
          <div className="px-5 py-3" style={{ borderBottom: '1px solid var(--border)' }}>
            <p className="text-sm font-semibold text-ink">A quiénes no se les envió</p>
            <p className="text-xs text-ink-subtle">Salteados y fallidos, con el motivo</p>
          </div>
          <div className="divide-y divide-border max-h-80 overflow-y-auto">
            {failures.map((f, i) => (
              <div key={i} className="px-5 py-2.5 flex items-center gap-3">
                <span className="text-xs font-mono text-ink w-32 shrink-0">{f.recipientPhone}</span>
                <span className="text-xs text-ink-muted flex-1">{f.error || '—'}</span>
                <span className="text-[11px] text-ink-subtle shrink-0">
                  {f.status === 'SKIPPED' ? 'Salteado' : 'Falló'}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div>
      <p className="text-lg font-bold" style={{ color }}>{value}</p>
      <p className="text-[11px] text-ink-subtle">{label}</p>
    </div>
  );
}
