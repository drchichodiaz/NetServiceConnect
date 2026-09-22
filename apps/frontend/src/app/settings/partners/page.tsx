'use client';
import { useEffect, useState } from 'react';
import { partnersApi, type Partner } from '@/lib/api';
import ModalPortal from '@/components/ui/ModalPortal';
import {
  Handshake, Plus, X, Loader2, Pencil, Building2, Check,
  Mail, Phone, CreditCard, ChevronRight, Trash2, PowerOff,
} from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';
import toast from 'react-hot-toast';
import clsx from 'clsx';

/**
 * Los partners: quién vende el sistema y qué empresas trajo.
 *
 * No son tenants ni usuarios — son la fuerza de venta de quien opera esta instalación,
 * y por eso la pantalla es solo para el super admin, igual que Empresas. Acá no se
 * calcula ninguna comisión: el sistema registra quién trajo a quién y desde cuándo, y
 * la liquidación se hace afuera.
 */

const EMPTY = { name: '', email: '', phone: '', taxId: '', agreement: '', notes: '' };

export default function PartnersPage() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partner | 'new' | null>(null);
  const [detail, setDetail] = useState<string | null>(null);

  function load() {
    setLoading(true);
    partnersApi.list().then(setPartners)
      .catch(() => toast.error('Error al cargar los partners'))
      .finally(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="max-w-2xl mx-auto py-10 px-6 animate-fade-in">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-xl font-bold text-ink mb-1" style={{ letterSpacing: '-0.02em' }}>Partners</h1>
          <p className="text-sm text-ink-muted">Quién vende el sistema y qué empresas trajo</p>
        </div>
        <button onClick={() => setEditing('new')} className="btn-primary">
          <Plus className="w-4 h-4" />
          Nuevo partner
        </button>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-32">
            <Loader2 className="w-5 h-5 animate-spin text-ink-muted" />
          </div>
        ) : partners.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 px-6 text-center">
            <Handshake className="w-7 h-7 text-ink-subtle mb-2" />
            <p className="text-sm font-medium text-ink mb-1">Sin partners todavía</p>
            <p className="text-xs text-ink-muted">
              Cargá uno y vas a poder elegirlo al dar de alta una empresa.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {partners.map((p) => (
              <div key={p.id} className="flex items-center gap-3.5 px-5 py-3.5">
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                  style={p.isActive
                    ? { background: '#EFF6FF', color: '#3B82F6' }
                    : { background: 'var(--surface-muted)', color: '#9CA3AF' }}
                >
                  <Handshake className="w-4 h-4" />
                </div>

                <button onClick={() => setDetail(p.id)} className="flex-1 min-w-0 text-left">
                  <div className="flex items-center gap-2">
                    <p className={clsx('text-sm font-medium truncate', p.isActive ? 'text-ink' : 'text-ink-muted')}>
                      {p.name}
                    </p>
                    {!p.isActive && <span className="text-[10px] text-ink-subtle font-medium">Inactivo</span>}
                  </div>
                  <p className="text-xs text-ink-subtle truncate">
                    {p.email || p.phone || 'Sin datos de contacto'}
                  </p>
                </button>

                <div className="text-right shrink-0">
                  <p className="text-xs text-ink-muted">
                    {p.tenantCount ?? 0} {(p.tenantCount ?? 0) === 1 ? 'empresa' : 'empresas'}
                  </p>
                  {/* El número que sirve para liquidar: una empresa dada de baja sigue
                      siendo una venta, pero no debería seguir generando comisión. */}
                  <p className="text-[11px] text-ink-subtle">{p.activeTenantCount ?? 0} activas</p>
                </div>

                <button
                  onClick={() => setEditing(p)}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-ink-subtle hover:text-ink hover:bg-black/5 shrink-0"
                  title="Editar"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
                <ChevronRight className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-[11px] text-ink-subtle mt-4">
        El sistema registra la atribución, no calcula comisiones: no tiene los precios de cada plan.
        El acuerdo se guarda como texto para tenerlo a mano al liquidar.
      </p>

      {editing && (
        <PartnerForm
          partner={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}

      {detail && <PartnerDetail id={detail} onClose={() => setDetail(null)} onChanged={load} />}
    </div>
  );
}

// ─── Alta y edición ───────────────────────────────────────────────────────────

function PartnerForm({
  partner,
  onClose,
  onSaved,
}: {
  partner: Partner | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    name: partner?.name ?? '',
    email: partner?.email ?? '',
    phone: partner?.phone ?? '',
    taxId: partner?.taxId ?? '',
    agreement: partner?.agreement ?? '',
    notes: partner?.notes ?? '',
    ...(partner ? {} : EMPTY),
  });
  const [isActive, setIsActive] = useState(partner?.isActive ?? true);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (form.name.trim().length < 2) return;
    setSaving(true);
    try {
      if (partner) await partnersApi.update(partner.id, { ...form, isActive });
      else await partnersApi.create({ ...form, name: form.name.trim() });
      toast.success(partner ? 'Partner actualizado' : 'Partner creado');
      onSaved();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo guardar');
    } finally {
      setSaving(false);
    }
  }

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-6">
        <form onSubmit={handleSubmit} className="card w-full max-w-md p-6 my-4">
          <div className="flex items-start justify-between mb-4">
            <h2 className="text-base font-bold text-ink" style={{ letterSpacing: '-0.02em' }}>
              {partner ? 'Editar partner' : 'Nuevo partner'}
            </h2>
            <button type="button" onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-subtle hover:bg-black/5">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-3">
            <input
              required autoFocus placeholder="Nombre del partner" value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="input w-full"
            />
            <div className="grid sm:grid-cols-2 gap-3">
              <input
                type="email" placeholder="Correo (opcional)" value={form.email ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                className="input w-full"
              />
              <input
                placeholder="Teléfono (opcional)" value={form.phone ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                className="input w-full"
              />
            </div>
            <input
              placeholder="Cédula o RUC (opcional)" value={form.taxId ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, taxId: e.target.value }))}
              className="input w-full"
            />

            <div>
              <input
                placeholder="Acuerdo — ej: 20% los primeros 12 meses" value={form.agreement ?? ''}
                onChange={(e) => setForm((f) => ({ ...f, agreement: e.target.value }))}
                className="input w-full"
              />
              <p className="text-[11px] text-ink-subtle mt-1">
                Se guarda como texto para tenerlo a mano: el sistema no calcula ni liquida comisiones.
              </p>
            </div>

            <textarea
              placeholder="Notas internas (opcional)" value={form.notes ?? ''}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={2}
              className="input w-full resize-y"
            />

            {partner && (
              <label className="flex items-start gap-2 cursor-pointer pt-1">
                <input
                  type="checkbox"
                  checked={!isActive}
                  onChange={(e) => setIsActive(!e.target.checked)}
                  className="w-3.5 h-3.5 mt-0.5 accent-red-500"
                />
                <span className="text-xs text-ink">
                  Ya no vende
                  <span className="block text-[11px] text-ink-subtle">
                    No se puede elegir en ventas nuevas. Las empresas que ya trajo siguen siendo suyas.
                  </span>
                </span>
              </label>
            )}
          </div>

          <div className="flex gap-2 mt-5">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancelar</button>
            <button type="submit" disabled={saving || form.name.trim().length < 2} className="btn-primary flex-1">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Guardar
            </button>
          </div>
        </form>
      </div>
    </ModalPortal>
  );
}

// ─── Cartera del partner ──────────────────────────────────────────────────────

function PartnerDetail({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<(Partner & { tenants: any[] }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [removing, setRemoving] = useState(false);

  useEffect(() => {
    partnersApi.get(id).then(setData)
      .catch(() => toast.error('No se pudo cargar el partner'))
      .finally(() => setLoading(false));
  }, [id]);

  async function handleRemove() {
    if (!data) return;
    if (!confirm(`¿Borrar a ${data.name}? Esto no se puede deshacer.`)) return;
    setRemoving(true);
    try {
      await partnersApi.remove(data.id);
      toast.success('Partner borrado');
      onChanged();
      onClose();
    } catch (err: any) {
      // El backend frena el borrado de un partner con ventas y explica por qué.
      toast.error(err?.response?.data?.message || 'No se pudo borrar');
    } finally {
      setRemoving(false);
    }
  }

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-6">
        <div className="card w-full max-w-lg p-6 my-4">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-base font-bold text-ink" style={{ letterSpacing: '-0.02em' }}>
                {data?.name ?? 'Partner'}
              </h2>
              {data && (
                <p className="text-xs text-ink-muted">
                  {data.activeTenantCount} de {data.tenantCount} empresas siguen activas
                </p>
              )}
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-subtle hover:bg-black/5">
              <X className="w-4 h-4" />
            </button>
          </div>

          {loading || !data ? (
            <div className="flex items-center justify-center h-24">
              <Loader2 className="w-5 h-5 animate-spin text-ink-muted" />
            </div>
          ) : (
            <>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted mb-3">
                {data.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{data.email}</span>}
                {data.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{data.phone}</span>}
                {data.taxId && <span className="flex items-center gap-1"><CreditCard className="w-3 h-3" />{data.taxId}</span>}
                {!data.isActive && (
                  <span className="flex items-center gap-1 text-ink-subtle"><PowerOff className="w-3 h-3" />Ya no vende</span>
                )}
              </div>

              {data.agreement && (
                <div className="rounded-lg px-3 py-2 mb-4 text-xs text-ink" style={{ background: 'var(--surface-muted)' }}>
                  {data.agreement}
                </div>
              )}

              <p className="text-[10px] font-semibold text-ink-muted uppercase tracking-wider mb-2">
                Empresas que trajo
              </p>

              {data.tenants.length === 0 ? (
                <p className="text-xs text-ink-subtle py-4 text-center">Todavía no tiene ventas cargadas.</p>
              ) : (
                <div className="rounded-lg divide-y divide-border" style={{ border: '1px solid var(--border)' }}>
                  {data.tenants.map((t) => (
                    <div key={t.id} className="flex items-center gap-2.5 px-3 py-2.5">
                      <Building2 className="w-3.5 h-3.5 text-ink-subtle shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-ink truncate">{t.name}</p>
                        <p className="text-[11px] text-ink-subtle truncate">
                          {t.soldAt ? `Vendida el ${format(new Date(t.soldAt), 'd MMM yyyy', { locale: es })}` : 'Sin fecha de venta'}
                          {t.partnerNote ? ` · ${t.partnerNote}` : ''}
                        </p>
                      </div>
                      <span
                        className="text-[10px] font-medium rounded-full px-2 py-0.5 shrink-0"
                        style={t.isActive
                          ? { background: '#E8FBF0', color: '#128C7E' }
                          : { background: 'var(--surface-muted)', color: '#9CA3AF' }}
                      >
                        {t.isActive ? 'Activa' : 'Inactiva'}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex gap-2 mt-5">
                <button onClick={onClose} className="btn-secondary flex-1">
                  <Check className="w-3.5 h-3.5" />
                  Listo
                </button>
                {/* Solo tiene sentido con cartera vacía; con ventas el backend lo frena
                    y responde con el motivo. */}
                {data.tenantCount === 0 && (
                  <button onClick={handleRemove} disabled={removing} className="btn-secondary text-red-600">
                    {removing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                    Borrar
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </ModalPortal>
  );
}
