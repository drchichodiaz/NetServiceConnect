'use client';
import { useEffect, useState, useCallback } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import {
  MessageSquare, Clock, Tag, Users, Bot,
  TrendingUp, TrendingDown, ChevronDown, RefreshCw,
} from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { statsApi, botStatsApi } from '@/lib/api';
import clsx from 'clsx';

type Period = 'today' | 'week' | 'month';

const PERIODS: { key: Period; label: string }[] = [
  { key: 'today', label: 'Hoy' },
  { key: 'week',  label: 'Esta semana' },
  { key: 'month', label: 'Este mes' },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function MetricCard({
  label, value, sub, trend, trendUp, icon: Icon, accentColor, loading,
}: {
  label: string; value: string; sub?: string;
  trend?: string; trendUp?: boolean;
  icon: React.ElementType; accentColor: string; loading?: boolean;
}) {
  return (
    <div className="card p-5 flex flex-col gap-3 animate-fade-in">
      <div className="flex items-start justify-between">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: accentColor + '15' }}
        >
          <Icon className="w-4 h-4" style={{ color: accentColor }} />
        </div>
        {trend && (
          <span
            className={clsx(
              'flex items-center gap-1 text-xs font-semibold rounded-full px-2 py-0.5',
              trendUp ? 'text-emerald-600 bg-emerald-50' : 'text-red-500 bg-red-50',
            )}
          >
            {trendUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {trend}
          </span>
        )}
      </div>
      <div>
        {loading ? (
          <div className="h-7 w-16 rounded-lg bg-surface-muted animate-pulse mb-1" />
        ) : (
          <p className="text-2xl font-bold text-ink" style={{ letterSpacing: '-0.03em' }}>{value}</p>
        )}
        <p className="text-xs text-ink-muted mt-0.5">{label}</p>
        {sub && <p className="text-xs text-ink-subtle mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white rounded-xl shadow-float px-3.5 py-3 text-xs" style={{ border: '1px solid var(--border)' }}>
      <p className="font-semibold text-ink mb-2">{label}</p>
      {payload.map((entry: any) => (
        <div key={entry.name} className="flex items-center gap-2 mb-1 last:mb-0">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: entry.color }} />
          <span className="text-ink-muted capitalize">{entry.name}:</span>
          <span className="font-semibold text-ink ml-auto pl-3">{entry.value}</span>
        </div>
      ))}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { user } = useAuthStore();
  const [period,     setPeriod]     = useState<Period>('week');
  const [periodOpen, setPeriodOpen] = useState(false);
  const [stats,      setStats]      = useState<any>(null);
  const [botStats,   setBotStats]   = useState<any>(null);
  const [loading,    setLoading]    = useState(true);

  const firstName = user?.name?.split(' ')[0] ?? 'Admin';

  const fetchStats = useCallback(async (p: Period) => {
    setLoading(true);
    try {
      const [data, botData] = await Promise.all([statsApi.get(p), botStatsApi.get(p)]);
      setStats(data);
      setBotStats(botData);
    } catch {
      // silencioso — mantiene datos anteriores
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchStats(period); }, [period, fetchStats]);

  const conv  = stats?.conversations ?? {};
  const chart = stats?.chart ?? [];
  const agents = stats?.agents ?? [];
  const tags  = stats?.tags ?? [];
  const maxTagCount = tags[0]?.count ?? 1;

  const periodLabel = PERIODS.find((p) => p.key === period)?.label ?? '';

  return (
    <div className="w-full min-h-full p-6 lg:p-8">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="animate-fade-in">
            <h1 className="text-2xl font-bold text-ink" style={{ letterSpacing: '-0.02em' }}>
              Bienvenido de vuelta, {firstName}
            </h1>
            <p className="text-sm text-ink-muted mt-0.5">
              Resumen de actividad del equipo
            </p>
          </div>

          <div className="flex items-center gap-2 animate-fade-in">
            {/* Refresh */}
            <button
              onClick={() => fetchStats(period)}
              disabled={loading}
              className="btn-ghost w-9 h-9 p-0"
              title="Actualizar"
            >
              <RefreshCw className={clsx('w-3.5 h-3.5', loading && 'animate-spin')} />
            </button>

            {/* Period selector */}
            <div className="relative">
              <button
                onClick={() => setPeriodOpen(!periodOpen)}
                className="flex items-center gap-2 text-sm font-medium text-ink bg-white border border-border
                           rounded-xl px-3.5 py-2.5 hover:bg-surface-muted transition-colors shadow-card"
              >
                {periodLabel}
                <ChevronDown className="w-4 h-4 text-ink-muted" />
              </button>

              {periodOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setPeriodOpen(false)} />
                  <div
                    className="absolute right-0 top-full mt-1 bg-white rounded-xl shadow-float z-20 overflow-hidden animate-pop"
                    style={{ border: '1px solid var(--border)', minWidth: '140px' }}
                  >
                    {PERIODS.map((p) => (
                      <button
                        key={p.key}
                        onClick={() => { setPeriod(p.key); setPeriodOpen(false); }}
                        className={clsx(
                          'w-full text-left px-4 py-2.5 text-sm transition-colors',
                          p.key === period
                            ? 'font-semibold text-green-600 bg-green-50'
                            : 'text-ink hover:bg-surface-muted',
                        )}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* ── Metric cards ─────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[
            {
              label: 'Conversaciones',
              value: String(conv.total ?? 0),
              sub:   `${conv.open ?? 0} abiertas · ${conv.pending ?? 0} pendientes`,
              icon:  MessageSquare,
              accentColor: '#25D366',
            },
            {
              label: 'Cerradas / Resueltas',
              value: String(conv.closed ?? 0),
              sub:   conv.total ? `${Math.round(((conv.closed ?? 0) / conv.total) * 100)}% tasa de resolución` : '—',
              icon:  Clock,
              accentColor: '#3B82F6',
            },
            {
              label: 'Etiquetas en uso',
              value: String(tags.length),
              sub:   tags[0] ? `Top: ${tags[0].name}` : 'Sin etiquetas',
              icon:  Tag,
              accentColor: '#8B5CF6',
            },
            {
              label: 'Agentes con actividad',
              value: String(agents.length),
              sub:   agents.length ? `${agents.reduce((s: number, a: any) => s + a.openChats, 0)} chats abiertos` : 'Sin actividad',
              icon:  Users,
              accentColor: '#F59E0B',
            },
          ].map((card, i) => (
            <div key={card.label} style={{ animationDelay: `${i * 60}ms` }}>
              <MetricCard {...card} loading={loading} />
            </div>
          ))}
        </div>

        {/* ── Bot de WhatsApp ──────────────────────────────────────────────── */}
        <div className="card p-5 animate-fade-in" style={{ animationDelay: '80ms' }}>
          <div className="flex items-center gap-2 mb-4">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: '#E8FBF0' }}>
              <Bot className="w-3.5 h-3.5" style={{ color: '#128C7E' }} />
            </div>
            <div>
              <h2 className="font-semibold text-ink text-sm">Bot de WhatsApp</h2>
              <p className="text-xs text-ink-muted">{periodLabel} · configurable en Settings → Menú de WhatsApp</p>
            </div>
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {loading ? (
              [1, 2, 3, 4].map((i) => <div key={i} className="h-14 rounded-lg bg-surface-muted animate-pulse" />)
            ) : (
              <>
                <div>
                  <p className="text-2xl font-bold text-ink" style={{ letterSpacing: '-0.03em' }}>{botStats?.started ?? 0}</p>
                  <p className="text-xs text-ink-muted mt-0.5">Conversaciones iniciadas</p>
                </div>
                <div>
                  <p className="text-2xl font-bold" style={{ letterSpacing: '-0.03em', color: '#128C7E' }}>{botStats?.resolutionRate ?? 0}%</p>
                  <p className="text-xs text-ink-muted mt-0.5">Resueltas sin agente</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-ink" style={{ letterSpacing: '-0.03em' }}>{botStats?.handedOff ?? 0}</p>
                  <p className="text-xs text-ink-muted mt-0.5">Derivadas a un agente</p>
                </div>
                <div>
                  <p className="text-2xl font-bold text-ink" style={{ letterSpacing: '-0.03em' }}>{botStats?.orderLookups ?? 0}</p>
                  <p className="text-xs text-ink-muted mt-0.5">Consultas de pedido</p>
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── Chart ────────────────────────────────────────────────────────── */}
        <div className="card p-5 animate-fade-in" style={{ animationDelay: '100ms' }}>
          <div className="flex items-center justify-between mb-5 flex-wrap gap-3">
            <div>
              <h2 className="font-semibold text-ink text-sm">Flujo de mensajes</h2>
              <p className="text-xs text-ink-muted mt-0.5">Entrantes vs salientes — últimos 7 días</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-[2px] rounded-full inline-block" style={{ background: '#25D366' }} />
                <span className="text-xs text-ink-muted">Entrantes</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-[2px] rounded-full inline-block" style={{ background: '#3B82F6' }} />
                <span className="text-xs text-ink-muted">Salientes</span>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="h-[220px] flex items-center justify-center">
              <div className="w-6 h-6 rounded-full border-2 border-green-500 border-t-transparent animate-spin" />
            </div>
          ) : (
            <div style={{ height: 220 }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chart} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="gradIn" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor="#25D366" stopOpacity={0.18} />
                      <stop offset="100%" stopColor="#25D366" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="gradOut" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"   stopColor="#3B82F6" stopOpacity={0.15} />
                      <stop offset="100%" stopColor="#3B82F6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#F0F1F5" vertical={false} />
                  <XAxis
                    dataKey="dia"
                    tick={{ fontSize: 11, fill: '#9CA3AF', fontFamily: 'var(--font-dm-sans)' }}
                    axisLine={false} tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11, fill: '#9CA3AF', fontFamily: 'var(--font-dm-sans)' }}
                    axisLine={false} tickLine={false} width={32}
                    allowDecimals={false}
                  />
                  <Tooltip content={<CustomTooltip />} cursor={{ stroke: '#E8EAED', strokeWidth: 1 }} />
                  <Area type="monotone" dataKey="entrantes" stroke="#25D366" strokeWidth={2}
                    fill="url(#gradIn)" dot={false} activeDot={{ r: 4, fill: '#25D366', strokeWidth: 0 }} />
                  <Area type="monotone" dataKey="salientes" stroke="#3B82F6" strokeWidth={2}
                    fill="url(#gradOut)" dot={false} activeDot={{ r: 4, fill: '#3B82F6', strokeWidth: 0 }} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* ── Bottom row ───────────────────────────────────────────────────── */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">

          {/* Agent table — 3/5 */}
          <div className="card overflow-hidden lg:col-span-3 animate-fade-in" style={{ animationDelay: '160ms' }}>
            <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
              <h2 className="font-semibold text-ink text-sm">Productividad de agentes</h2>
              <p className="text-xs text-ink-muted mt-0.5">{periodLabel}</p>
            </div>

            {loading ? (
              <div className="px-5 py-8 space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-10 rounded-lg bg-surface-muted animate-pulse" />
                ))}
              </div>
            ) : agents.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-ink-muted">
                Sin actividad de agentes en este período
              </div>
            ) : (
              <div className="divide-y divide-border">
                <div className="grid grid-cols-12 px-5 py-2.5">
                  <span className="col-span-5 text-[10px] font-semibold text-ink-subtle uppercase tracking-wider">Agente</span>
                  <span className="col-span-2 text-[10px] font-semibold text-ink-subtle uppercase tracking-wider text-center">Abiertos</span>
                  <span className="col-span-2 text-[10px] font-semibold text-ink-subtle uppercase tracking-wider text-center">Resueltos</span>
                  <span className="col-span-3 text-[10px] font-semibold text-ink-subtle uppercase tracking-wider text-center">Tasa</span>
                </div>

                {agents.map((agent: any, i: number) => (
                  <div
                    key={agent.id}
                    className="grid grid-cols-12 items-center px-5 py-3 hover:bg-surface-muted transition-colors animate-fade-in"
                    style={{ animationDelay: `${200 + i * 50}ms` }}
                  >
                    <div className="col-span-5 flex items-center gap-2.5 min-w-0">
                      <div
                        className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                        style={{ background: '#E8FBF0', color: '#128C7E' }}
                      >
                        {agent.name.slice(0, 2).toUpperCase()}
                      </div>
                      <span className="text-sm font-medium text-ink truncate">{agent.name}</span>
                    </div>

                    <div className="col-span-2 text-center">
                      <span className="text-sm font-semibold text-ink">{agent.openChats}</span>
                    </div>

                    <div className="col-span-2 text-center">
                      <span className="text-sm font-semibold text-ink">{agent.resolved}</span>
                    </div>

                    <div className="col-span-3 flex items-center gap-2 px-1">
                      <div className="flex-1 h-1.5 rounded-full bg-surface-subtle overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${agent.rate}%`,
                            background: agent.rate >= 80 ? '#25D366' : agent.rate >= 50 ? '#F59E0B' : '#EF4444',
                          }}
                        />
                      </div>
                      <span className="text-xs font-semibold text-ink-muted w-8 text-right shrink-0">
                        {agent.rate}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Top tags — 2/5 */}
          <div className="card overflow-hidden lg:col-span-2 animate-fade-in" style={{ animationDelay: '180ms' }}>
            <div className="px-5 py-4" style={{ borderBottom: '1px solid var(--border)' }}>
              <h2 className="font-semibold text-ink text-sm">Top etiquetas</h2>
              <p className="text-xs text-ink-muted mt-0.5">Por volumen de conversaciones</p>
            </div>

            {loading ? (
              <div className="px-5 py-4 space-y-4">
                {[1, 2, 3, 4].map((i) => (
                  <div key={i} className="space-y-1.5">
                    <div className="h-3 w-24 rounded bg-surface-muted animate-pulse" />
                    <div className="h-1.5 rounded-full bg-surface-muted animate-pulse" />
                  </div>
                ))}
              </div>
            ) : tags.length === 0 ? (
              <div className="px-5 py-10 text-center text-sm text-ink-muted">
                Sin etiquetas asignadas
              </div>
            ) : (
              <>
                <div className="px-5 py-4 space-y-4">
                  {tags.map((tag: any, i: number) => (
                    <div key={tag.id} className="animate-fade-in" style={{ animationDelay: `${220 + i * 50}ms` }}>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-medium text-ink truncate pr-2 flex items-center gap-1.5">
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: tag.color }} />
                          {tag.name}
                        </span>
                        <span className="text-xs font-semibold text-ink-muted shrink-0">{tag.count}</span>
                      </div>
                      <div className="h-1.5 rounded-full bg-surface-subtle overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-700"
                          style={{
                            width: `${Math.round((tag.count / maxTagCount) * 100)}%`,
                            background: tag.color,
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                <div
                  className="mx-5 mb-5 rounded-xl p-3.5 text-center"
                  style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
                >
                  <p className="text-xl font-bold text-ink" style={{ letterSpacing: '-0.03em' }}>
                    {tags.reduce((s: number, t: any) => s + t.count, 0)}
                  </p>
                  <p className="text-xs text-ink-muted mt-0.5">conversaciones etiquetadas</p>
                </div>
              </>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}
