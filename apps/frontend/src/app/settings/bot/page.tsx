'use client';
import { useEffect, useState } from 'react';
import { botConfigApi } from '@/lib/api';
import { Bot, Check, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

export default function BotSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    horariosText: '',
    sucursalesText: '',
    serviciosText: '',
    orderStatusApiUrl: '',
  });

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const data = await botConfigApi.get();
      setForm({
        horariosText: data.horariosText ?? '',
        sucursalesText: data.sucursalesText ?? '',
        serviciosText: data.serviciosText ?? '',
        orderStatusApiUrl: data.orderStatusApiUrl ?? '',
      });
    } catch {
      toast.error('Error al cargar la configuración del bot');
    } finally {
      setLoading(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await botConfigApi.update({
        horariosText: form.horariosText,
        sucursalesText: form.sucursalesText,
        serviciosText: form.serviciosText,
      });
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
    <div className="max-w-xl mx-auto py-10 px-6 animate-fade-in">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: '#E8FBF0' }}>
          <Bot className="w-4 h-4" style={{ color: '#128C7E' }} />
        </div>
        <h1 className="text-xl font-bold text-ink" style={{ letterSpacing: '-0.02em' }}>
          Menú de WhatsApp
        </h1>
      </div>
      <p className="text-sm text-ink-muted mt-1 mb-8">
        Contenido que responde el bot cuando un cliente escribe por primera vez, antes de derivar a un agente.
      </p>

      <form onSubmit={handleSave} className="card p-5 space-y-4">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-ink">Horarios</label>
          <textarea
            value={form.horariosText}
            onChange={(e) => setForm((f) => ({ ...f, horariosText: e.target.value }))}
            placeholder="Ej: Lunes a viernes de 9 a 18hs, sábados de 9 a 13hs."
            className="input w-full" rows={3}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-ink">Sucursales</label>
          <textarea
            value={form.sucursalesText}
            onChange={(e) => setForm((f) => ({ ...f, sucursalesText: e.target.value }))}
            placeholder="Ej: Av. Siempre Viva 742, Springfield."
            className="input w-full" rows={3}
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-ink">Servicios</label>
          <textarea
            value={form.serviciosText}
            onChange={(e) => setForm((f) => ({ ...f, serviciosText: e.target.value }))}
            placeholder="Ej: Reparaciones, instalaciones, mantenimiento."
            className="input w-full" rows={3}
          />
        </div>

        <div className="space-y-1.5 pt-2" style={{ borderTop: '1px solid var(--border)' }}>
          <label className="text-xs font-semibold text-ink-subtle flex items-center justify-between pt-3">
            <span>API de consulta de pedidos</span>
            <span className="text-[10px] font-normal uppercase tracking-wide rounded-full px-2 py-0.5" style={{ background: 'var(--surface-muted)' }}>
              Próximamente
            </span>
          </label>
          <input
            disabled
            value={form.orderStatusApiUrl}
            placeholder="Todavía no disponible — el bot deriva a un agente"
            className="input w-full opacity-60 cursor-not-allowed"
          />
          <p className="text-[11px] text-ink-subtle">
            Cuando un cliente pide consultar una orden, hoy el bot le pide el número y lo pasa directo a un agente.
          </p>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="w-full flex items-center justify-center gap-2 font-semibold py-2.5 px-4 rounded-xl
                     transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm text-white"
          style={{ background: saving ? '#6EE7B7' : '#128C7E' }}
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Guardar
        </button>
      </form>
    </div>
  );
}
