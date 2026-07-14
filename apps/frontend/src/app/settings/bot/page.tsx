'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { botConfigApi, branchesApi, BranchInput } from '@/lib/api';
import { Bot, Check, Loader2, Plus, Pencil, Trash2, X, MapPin, LayoutDashboard, ArrowRight } from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';

interface Branch extends BranchInput {
  id: string;
}

const EMPTY_BRANCH: BranchInput = { name: '', address: '', scheduleText: '', phone: '', mapsUrl: '', servicesText: '' };

export default function BotSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    horariosText: '',
    sucursalesText: '',
    serviciosText: '',
    orderStatusApiUrl: '',
  });

  // ── Sucursales ──
  const [branches, setBranches] = useState<Branch[]>([]);
  const [showBranchForm, setShowBranchForm] = useState(false);
  const [editBranchId, setEditBranchId] = useState<string | null>(null);
  const [branchForm, setBranchForm] = useState<BranchInput>(EMPTY_BRANCH);
  const [savingBranch, setSavingBranch] = useState(false);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    try {
      const [config, branchList] = await Promise.all([botConfigApi.get(), branchesApi.list()]);
      setForm({
        horariosText: config.horariosText ?? '',
        sucursalesText: config.sucursalesText ?? '',
        serviciosText: config.serviciosText ?? '',
        orderStatusApiUrl: config.orderStatusApiUrl ?? '',
      });
      setBranches(branchList);
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

  function openNewBranch() {
    setBranchForm(EMPTY_BRANCH);
    setEditBranchId(null);
    setShowBranchForm(true);
  }

  function openEditBranch(b: Branch) {
    setBranchForm({
      name: b.name, address: b.address, scheduleText: b.scheduleText ?? '',
      phone: b.phone ?? '', mapsUrl: b.mapsUrl ?? '', servicesText: b.servicesText ?? '',
    });
    setEditBranchId(b.id);
    setShowBranchForm(true);
  }

  function cancelBranchForm() {
    setShowBranchForm(false);
    setEditBranchId(null);
    setBranchForm(EMPTY_BRANCH);
  }

  async function handleSaveBranch(e: React.FormEvent) {
    e.preventDefault();
    if (!branchForm.name.trim() || !branchForm.address.trim()) {
      toast.error('Nombre y dirección son obligatorios');
      return;
    }
    setSavingBranch(true);
    try {
      if (editBranchId) {
        const updated = await branchesApi.update(editBranchId, branchForm);
        setBranches((prev) => prev.map((b) => (b.id === editBranchId ? updated : b)));
        toast.success('Sucursal actualizada');
      } else {
        const created = await branchesApi.create(branchForm);
        setBranches((prev) => [...prev, created]);
        toast.success('Sucursal creada');
      }
      cancelBranchForm();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Error al guardar la sucursal');
    } finally {
      setSavingBranch(false);
    }
  }

  async function handleToggleActive(b: Branch) {
    try {
      const updated = await branchesApi.update(b.id, { active: !b.active });
      setBranches((prev) => prev.map((x) => (x.id === b.id ? updated : x)));
    } catch {
      toast.error('Error al actualizar la sucursal');
    }
  }

  async function handleDeleteBranch(id: string) {
    if (!confirm('¿Eliminar esta sucursal?')) return;
    try {
      await branchesApi.remove(id);
      setBranches((prev) => prev.filter((b) => b.id !== id));
      toast.success('Sucursal eliminada');
    } catch {
      toast.error('Error al eliminar');
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
    <div className="max-w-2xl mx-auto py-10 px-6 animate-fade-in space-y-6">
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
          Contenido que responde el bot cuando un cliente escribe por primera vez, antes de derivar a un agente.
        </p>
      </div>

      {/* Métricas: viven en el Dashboard general, no acá */}
      <Link
        href="/dashboard"
        className="card p-4 flex items-center gap-3 hover:shadow-card-md transition-shadow group"
      >
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: '#E8FBF0' }}>
          <LayoutDashboard className="w-4 h-4" style={{ color: '#128C7E' }} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-ink">Ver métricas del bot</p>
          <p className="text-xs text-ink-muted">Conversaciones resueltas, derivadas y consultas de pedido — en el Dashboard general</p>
        </div>
        <ArrowRight className="w-4 h-4 text-ink-subtle shrink-0 group-hover:translate-x-0.5 transition-transform" />
      </Link>

      {/* Textos configurables */}
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
          <label className="text-xs font-semibold text-ink flex items-center justify-between">
            <span>Sucursales (texto de respaldo)</span>
            <span className="text-[10px] font-normal text-ink-subtle">Se usa solo si no cargás sucursales abajo</span>
          </label>
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

      {/* Sucursales administrables */}
      <div>
        <div className="flex items-start justify-between mb-3 gap-4">
          <div>
            <p className="text-sm font-semibold text-ink">Sucursales</p>
            <p className="text-xs text-ink-muted">
              Si cargás al menos una, el bot le pregunta al cliente cuál antes de responder, en vez de mandar el texto de respaldo.
            </p>
          </div>
          <button onClick={openNewBranch} className="btn-primary flex items-center gap-2 shrink-0 text-sm">
            <Plus className="w-4 h-4" />
            Nueva sucursal
          </button>
        </div>

        {showBranchForm && (
          <div className="card p-5 mb-4 animate-pop" style={{ border: '1px solid #BBF7D8' }}>
            <div className="flex items-center justify-between mb-4">
              <p className="font-semibold text-ink text-sm">{editBranchId ? 'Editar sucursal' : 'Nueva sucursal'}</p>
              <button onClick={cancelBranchForm} className="btn-ghost w-7 h-7 p-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <form onSubmit={handleSaveBranch} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-ink">Nombre *</label>
                  <input
                    value={branchForm.name}
                    onChange={(e) => setBranchForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Relojín Town Center"
                    className="input w-full text-sm"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-ink">Teléfono</label>
                  <input
                    value={branchForm.phone}
                    onChange={(e) => setBranchForm((f) => ({ ...f, phone: e.target.value }))}
                    placeholder="6000-0000"
                    className="input w-full text-sm"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-ink">Dirección *</label>
                <input
                  value={branchForm.address}
                  onChange={(e) => setBranchForm((f) => ({ ...f, address: e.target.value }))}
                  placeholder="Costa del Este, Town Center"
                  className="input w-full text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-ink">Horario</label>
                <input
                  value={branchForm.scheduleText}
                  onChange={(e) => setBranchForm((f) => ({ ...f, scheduleText: e.target.value }))}
                  placeholder="Lunes a sábado: 10:00 a.m. – 7:00 p.m."
                  className="input w-full text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-ink">Enlace de Google Maps</label>
                <input
                  value={branchForm.mapsUrl}
                  onChange={(e) => setBranchForm((f) => ({ ...f, mapsUrl: e.target.value }))}
                  placeholder="https://maps.google.com/..."
                  className="input w-full text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-ink">Servicios disponibles</label>
                <input
                  value={branchForm.servicesText}
                  onChange={(e) => setBranchForm((f) => ({ ...f, servicesText: e.target.value }))}
                  placeholder="Cambio de batería, recepción de reparaciones, ajuste de correas"
                  className="input w-full text-sm"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={cancelBranchForm} className="btn-ghost text-sm px-4">Cancelar</button>
                <button type="submit" disabled={savingBranch} className="btn-primary flex items-center gap-2 text-sm">
                  {savingBranch ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  {editBranchId ? 'Guardar cambios' : 'Crear sucursal'}
                </button>
              </div>
            </form>
          </div>
        )}

        {branches.length === 0 ? (
          <div className="card flex flex-col items-center justify-center py-10 text-center" style={{ border: '2px dashed var(--border)' }}>
            <MapPin className="w-6 h-6 text-ink-subtle mb-2" />
            <p className="text-xs text-ink-muted">Sin sucursales cargadas — se usa el texto de respaldo de arriba</p>
          </div>
        ) : (
          <div className="space-y-2">
            {branches.map((b) => (
              <div key={b.id} className="card p-4 flex items-start gap-3 group hover:shadow-card-md transition-shadow">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={clsx('text-sm font-semibold', b.active ? 'text-ink' : 'text-ink-subtle line-through')}>{b.name}</p>
                    {!b.active && (
                      <span className="text-[10px] font-semibold rounded-full px-2 py-0.5" style={{ background: 'var(--surface-muted)', color: 'var(--ink-subtle)' }}>
                        Inactiva
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-ink-muted mt-0.5">{b.address}</p>
                  {b.scheduleText && <p className="text-xs text-ink-subtle mt-0.5">{b.scheduleText}</p>}
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button onClick={() => handleToggleActive(b)} className="btn-ghost text-[11px] px-2 h-7">
                    {b.active ? 'Desactivar' : 'Activar'}
                  </button>
                  <button onClick={() => openEditBranch(b)} className="btn-ghost w-7 h-7 p-0" title="Editar">
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handleDeleteBranch(b.id)} className="btn-ghost w-7 h-7 p-0 hover:text-red-500" title="Eliminar">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
