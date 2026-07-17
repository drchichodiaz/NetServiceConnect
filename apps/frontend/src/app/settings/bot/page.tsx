'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { botConfigApi } from '@/lib/api';
import { Bot, Check, Loader2, LayoutDashboard, ArrowRight } from 'lucide-react';
import toast from 'react-hot-toast';
import MenuTreeEditor from './components/MenuTreeEditor';

export default function BotSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [orderStatusApiUrl, setOrderStatusApiUrl] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const config = await botConfigApi.get();
        setOrderStatusApiUrl(config.orderStatusApiUrl ?? '');
      } catch {
        toast.error('Error al cargar la configuración del bot');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  async function handleSaveConfig(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await botConfigApi.update({ orderStatusApiUrl });
      toast.success('Configuración guardada');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Error al guardar');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 rounded-full border-2 border-green-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto py-10 px-6 animate-fade-in space-y-6">
      <div>
        <div className="flex items-center gap-3 mb-1">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: '#E8FBF0' }}>
            <Bot className="w-4 h-4" style={{ color: '#128C7E' }} />
          </div>
          <h1 className="text-xl font-bold text-ink" style={{ letterSpacing: '-0.02em' }}>
            Menú de WhatsApp
          </h1>
        </div>
        <p className="text-sm text-ink-muted mt-1">
          Armá el menú que responde el bot cuando un cliente escribe por primera vez, antes de derivar a un agente.
        </p>
      </div>

      {/* Métricas: viven en el Dashboard general, no acá */}
      <Link href="/dashboard" className="card p-4 flex items-center gap-3 hover:shadow-card-md transition-shadow group">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: '#E8FBF0' }}>
          <LayoutDashboard className="w-4 h-4" style={{ color: '#128C7E' }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-ink">Ver métricas del bot</p>
          <p className="text-xs text-ink-muted">Conversaciones resueltas, derivadas y consultas de pedido — en el Dashboard general</p>
        </div>
        <ArrowRight className="w-4 h-4 text-ink-subtle shrink-0 group-hover:translate-x-0.5 transition-transform" />
      </Link>

      <MenuTreeEditor />

      <form onSubmit={handleSaveConfig} className="card p-5 space-y-3">
        <label className="text-xs font-semibold text-ink-subtle flex items-center justify-between">
          <span>API de consulta de pedidos</span>
          <span className="text-[10px] font-normal uppercase tracking-wide rounded-full px-2 py-0.5" style={{ background: 'var(--surface-muted)' }}>
            Próximamente
          </span>
        </label>
        <input
          disabled
          value={orderStatusApiUrl}
          placeholder="Todavía no disponible — el bot deriva a un agente"
          className="input w-full opacity-60 cursor-not-allowed"
        />
        <p className="text-[11px] text-ink-subtle">
          Cuando un cliente elige la opción de tipo &quot;Consultar pedido&quot;, hoy el bot le pide el número y lo pasa directo a un agente.
        </p>
        <button
          type="submit"
          disabled={saving}
          className="btn-primary text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Guardar
        </button>
      </form>
    </div>
  );
}
