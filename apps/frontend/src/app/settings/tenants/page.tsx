'use client';
import { useEffect, useState } from 'react';
import { tenantsApi, partnersApi, type Partner } from '@/lib/api';
import ModalPortal from '@/components/ui/ModalPortal';
import { Building2, Plus, Loader2, X, Copy, Check, RefreshCw, Pencil, Handshake } from 'lucide-react';
import toast from 'react-hot-toast';
import { validarPassword, PASSWORD_MIN_LENGTH } from '@/lib/password';

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  plan: string;
  isActive: boolean;
  createdAt: string;
  partnerId?: string | null;
  soldAt?: string | null;
  partnerNote?: string | null;
  partner?: { id: string; name: string; isActive: boolean } | null;
  timezone?: string;
  agendaSettings?: { enabled: boolean } | null;
  _count: { users: number; conversations: number };
}

/**
 * Zonas que se ofrecen en el selector. Son las de los mercados donde se vende; la que
 * tenga la empresa se agrega aunque no este en la lista, para no pisarla sin querer.
 */
const TIMEZONES: { value: string; label: string }[] = [
  { value: 'America/Panama', label: 'Panamá (UTC−5)' },
  { value: 'America/Guatemala', label: 'Guatemala (UTC−6)' },
  { value: 'America/El_Salvador', label: 'El Salvador (UTC−6)' },
  { value: 'America/Tegucigalpa', label: 'Honduras (UTC−6)' },
  { value: 'America/Managua', label: 'Nicaragua (UTC−6)' },
  { value: 'America/Costa_Rica', label: 'Costa Rica (UTC−6)' },
  { value: 'America/Mexico_City', label: 'México, centro (UTC−6)' },
  { value: 'America/Bogota', label: 'Colombia (UTC−5)' },
  { value: 'America/Santo_Domingo', label: 'República Dominicana (UTC−4)' },
  { value: 'America/Argentina/Buenos_Aires', label: 'Argentina (UTC−3)' },
];

interface CreatedResult {
  tenant: TenantRow;
  admin: { name: string; email: string };
  password: string;
}

const ACCENTS: Record<string, string> = {
  a: 'áàäâ', e: 'éèëê', i: 'íìïî', o: 'óòöô', u: 'úùüû', n: 'ñ',
};

function stripAccents(value: string): string {
  let out = value;
  for (const [plain, accented] of Object.entries(ACCENTS)) {
    for (const ch of accented) out = out.split(ch).join(plain);
  }
  return out;
}

function slugify(value: string): string {
  return stripAccents(value.toLowerCase())
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Sin caracteres ambiguos (I/l/1, O/0): esta contrasena se dicta o se copia a mano.
const MAYUS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const MINUS = 'abcdefghijkmnpqrstuvwxyz';
const NUMS = '23456789';
const SIMBOLOS = '!@#$%';

function tomar(set: string, n: number): string[] {
  const bytes = new Uint32Array(n);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => set[b % set.length]);
}

function generatePassword(): string {
  // Una de cada clase asegurada, y el resto libre. Cuando eran 12 caracteres tomados al
  // azar del alfabeto entero, casi 1 de cada 5 salia sin ningun numero — inofensivo
  // antes, pero la regla de contrasenas pide letras Y numeros y las habria rechazado.
  const chars = [
    ...tomar(MAYUS, 1),
    ...tomar(MINUS, 1),
    ...tomar(NUMS, 1),
    ...tomar(MAYUS + MINUS + NUMS + SIMBOLOS, 9),
  ];

  // Fisher-Yates, para que las tres aseguradas no queden siempre en las mismas posiciones.
  const idx = new Uint32Array(chars.length);
  crypto.getRandomValues(idx);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = idx[i] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export default function TenantsPage() {
  const [tenants,   setTenants]   = useState<TenantRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm,  setShowForm]  = useState(false);
  const [isSaving,  setIsSaving]  = useState(false);
  const [slugTouched, setSlugTouched] = useState(false);
  const [copied, setCopied] = useState(false);
  const [result, setResult] = useState<CreatedResult | null>(null);

  const [form, setForm] = useState({
    name: '', slug: '', adminName: '', adminEmail: '', adminPassword: generatePassword(),
    partnerId: '', partnerNote: '',
  });

  // Quién vendió cada cuenta. Solo se ofrecen los que siguen vendiendo: una venta nueva
  // atribuida a un partner dado de baja es un error de carga, y el backend la rechaza.
  const [partners, setPartners] = useState<Partner[]>([]);
  const [editing, setEditing] = useState<TenantRow | null>(null);

  function load() {
    setIsLoading(true);
    tenantsApi.list().then(setTenants).catch(() => toast.error('Error al cargar empresas')).finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, []);

  useEffect(() => {
    partnersApi.list().then(setPartners).catch(() => setPartners([]));
  }, []);

  function handleNameChange(name: string) {
    setForm((f) => ({ ...f, name, slug: slugTouched ? f.slug : slugify(name) }));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const problema = validarPassword(form.adminPassword, [form.adminName, form.adminEmail]);
    if (problema) {
      toast.error(problema);
      return;
    }
    setIsSaving(true);

    // El try cubre SOLO la llamada. Cuando abarcaba tambien lo de abajo, un error al
    // refrescar la pantalla se anunciaba como "error al crear la empresa" aunque la
    // empresa ya estuviera creada — y eso invita a reintentar, que la duplicaria o
    // chocaria contra el slug.
    let created: Awaited<ReturnType<typeof tenantsApi.create>>;
    try {
      created = await tenantsApi.create(form);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Error al crear la empresa');
      setIsSaving(false);
      return;
    }

    toast.success('Empresa creada');
    setIsSaving(false);

    // A partir de acá la empresa ya existe: si algo falla es un problema de pantalla, y
    // se resuelve recargando la lista, no volviendo a crearla.
    try {
      setResult({ tenant: created.tenant, admin: created.admin, password: form.adminPassword });
      setTenants((prev) => [created.tenant, ...prev]);
      setForm({
        name: '', slug: '', adminName: '', adminEmail: '', adminPassword: generatePassword(),
        partnerId: '', partnerNote: '',
      });
      setSlugTouched(false);
      setShowForm(false);
    } catch {
      toast('La empresa se creó. Recargá la lista para verla.', { icon: 'ℹ️' });
      load();
    }
  }

  function copyCredentials() {
    if (!result) return;
    const loginUrl = `${window.location.origin}/login`;
    const text = `URL: ${loginUrl}\nEmail: ${result.admin.email}\nContraseña temporal: ${result.password}`;
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="max-w-2xl mx-auto py-10 px-6 animate-fade-in">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-xl font-bold text-ink mb-1" style={{ letterSpacing: '-0.02em' }}>Empresas</h1>
          <p className="text-sm text-ink-muted">Alta de empresas clientes en la plataforma</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="btn-primary">
          {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showForm ? 'Cancelar' : 'Nueva empresa'}
        </button>
      </div>

      {/* Resultado de la ultima empresa creada — credenciales para pasarle al cliente */}
      {result && (
        <div className="card p-5 mb-5 animate-fade-in" style={{ background: '#E8FBF0', border: '1px solid #C8F0D8' }}>
          <p className="text-sm font-semibold text-ink mb-3">
            &quot;{result.tenant.name}&quot; creada — pasale estos datos al administrador
          </p>
          <div className="space-y-1 font-mono text-xs bg-white rounded-lg p-3 border border-border">
            <p>URL: {typeof window !== 'undefined' ? window.location.origin : ''}/login</p>
            <p>Email: {result.admin.email}</p>
            <p>Contraseña temporal: {result.password}</p>
          </div>
          <div className="flex gap-2 mt-3">
            <button onClick={copyCredentials} className="btn-secondary flex-1">
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copiado' : 'Copiar credenciales'}
            </button>
            <button onClick={() => setResult(null)} className="btn-secondary">Listo</button>
          </div>
        </div>
      )}

      {showForm && (
        <form onSubmit={handleCreate} className="card p-5 mb-5 animate-fade-in">
          <p className="text-sm font-semibold text-ink mb-4">Datos de la empresa</p>
          <div className="space-y-3">
            <input
              required placeholder="Nombre de la empresa" value={form.name}
              onChange={(e) => handleNameChange(e.target.value)} className="input"
            />
            <input
              required placeholder="Identificador (slug)" value={form.slug}
              onChange={(e) => { setSlugTouched(true); setForm((f) => ({ ...f, slug: slugify(e.target.value) })); }}
              className="input font-mono text-sm"
            />

            {/* Quién vendió. El flujo real: el partner cierra la venta, nos avisa, y el
                alta la hacemos nosotros anotando quién la trajo. */}
            {partners.length > 0 && (
              <>
                <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider pt-2">Venta</p>
                <select
                  value={form.partnerId}
                  onChange={(e) => setForm((f) => ({ ...f, partnerId: e.target.value }))}
                  className="input w-full"
                >
                  <option value="">Venta directa (sin partner)</option>
                  {partners.filter((p) => p.isActive).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
                {form.partnerId && (
                  <input
                    placeholder="Acuerdo de esta venta, si difiere del general (opcional)"
                    value={form.partnerNote}
                    onChange={(e) => setForm((f) => ({ ...f, partnerNote: e.target.value }))}
                    className="input w-full"
                  />
                )}
              </>
            )}

            <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider pt-2">Administrador inicial</p>
            <input
              required placeholder="Nombre completo" value={form.adminName}
              onChange={(e) => setForm((f) => ({ ...f, adminName: e.target.value }))} className="input"
            />
            <input
              required type="email" placeholder="Email" value={form.adminEmail}
              onChange={(e) => setForm((f) => ({ ...f, adminEmail: e.target.value }))} className="input"
            />
            <div className="flex gap-2">
              <input
                required placeholder="Contraseña temporal" minLength={PASSWORD_MIN_LENGTH} value={form.adminPassword}
                onChange={(e) => setForm((f) => ({ ...f, adminPassword: e.target.value }))} className="input flex-1 font-mono"
              />
              <button
                type="button"
                onClick={() => setForm((f) => ({ ...f, adminPassword: generatePassword() }))}
                title="Generar otra"
                className="btn-secondary w-10 shrink-0"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary flex-1">Cancelar</button>
            <button type="submit" disabled={isSaving} className="btn-primary flex-1">
              {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Crear empresa
            </button>
          </div>
        </form>
      )}

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-5 h-5 rounded-full border-2 border-green-500 border-t-transparent animate-spin" />
          </div>
        ) : tenants.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-ink-subtle text-sm">Sin empresas todavía</div>
        ) : (
          <div className="divide-y divide-border">
            {tenants.map((t, i) => (
              <div key={t.id} className="flex items-center gap-3.5 px-5 py-3.5 animate-fade-in" style={{ animationDelay: `${i * 40}ms` }}>
                <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: '#E8FBF0', color: '#128C7E' }}>
                  <Building2 className="w-4 h-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-ink truncate">{t.name}</p>
                    {!t.isActive && <span className="text-[10px] text-red-400 font-medium">Inactiva</span>}
                    {t.agendaSettings?.enabled && <span className="text-[10px] text-ink-subtle font-medium">· Agenda</span>}
                  </div>
                  <p className="text-xs text-ink-subtle truncate font-mono">{t.slug}</p>
                  {t.partner && (
                    <p className="text-[11px] text-ink-muted truncate flex items-center gap-1 mt-0.5">
                      <Handshake className="w-2.5 h-2.5 shrink-0" />
                      {t.partner.name}
                    </p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-ink-muted">{t._count.users} usuarios</p>
                  <p className="text-[11px] text-ink-subtle">{t._count.conversations} conversaciones</p>
                </div>
                <button
                  onClick={() => setEditing(t)}
                  className="w-7 h-7 rounded-lg flex items-center justify-center text-ink-subtle hover:text-ink hover:bg-black/5 shrink-0"
                  title="Editar empresa"
                >
                  <Pencil className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {editing && (
        <EditTenantModal
          tenant={editing}
          partners={partners}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

// ─── Edición de una empresa ───────────────────────────────────────────────────

/**
 * Hasta ahora una empresa creada no se podía tocar desde el panel: el endpoint existía
 * pero nadie lo llamaba, y `isActive` no se podía cambiar ni por API. Eso dejaba borrar
 * como única salida para un cliente que deja de pagar — y borrar se lleva puestas sus
 * conversaciones, contactos, plantillas y campañas, para siempre.
 */
function EditTenantModal({
  tenant,
  partners,
  onClose,
  onSaved,
}: {
  tenant: TenantRow;
  partners: Partner[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(tenant.name);
  const [plan, setPlan] = useState(tenant.plan ?? '');
  const [isActive, setIsActive] = useState(tenant.isActive);
  const [partnerId, setPartnerId] = useState(tenant.partnerId ?? '');
  const [partnerNote, setPartnerNote] = useState(tenant.partnerNote ?? '');
  const [timezone, setTimezone] = useState(tenant.timezone ?? 'America/Panama');
  const [agendaEnabled, setAgendaEnabled] = useState(!!tenant.agendaSettings?.enabled);
  const [saving, setSaving] = useState(false);
  const timezones = TIMEZONES.some((z) => z.value === timezone)
    ? TIMEZONES
    : [{ value: timezone, label: timezone }, ...TIMEZONES];

  // Al corregir una atribución vieja puede hacer falta un partner que ya no vende, así
  // que acá sí se listan los inactivos — a diferencia del alta, donde no se ofrecen.
  const options = partners.filter((p) => p.isActive || p.id === tenant.partnerId);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await tenantsApi.update(tenant.id, { name, plan, isActive, partnerId, partnerNote, timezone, agendaEnabled });
      toast.success('Empresa actualizada');
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
            <div>
              <h2 className="text-base font-bold text-ink" style={{ letterSpacing: '-0.02em' }}>Editar empresa</h2>
              <p className="text-xs text-ink-subtle font-mono">{tenant.slug}</p>
            </div>
            <button type="button" onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-subtle hover:bg-black/5">
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-3">
            <div>
              <label className="text-[11px] text-ink-subtle block mb-1">Nombre</label>
              <input required value={name} onChange={(e) => setName(e.target.value)} className="input w-full" />
            </div>

            <div>
              <label className="text-[11px] text-ink-subtle block mb-1">Plan</label>
              <input value={plan} onChange={(e) => setPlan(e.target.value)} placeholder="starter" className="input w-full" />
            </div>

            <div>
              <label className="text-[11px] text-ink-subtle block mb-1">Vendida por</label>
              <select value={partnerId} onChange={(e) => setPartnerId(e.target.value)} className="input w-full">
                <option value="">Venta directa (sin partner)</option>
                {options.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.isActive ? '' : ' (ya no vende)'}
                  </option>
                ))}
              </select>
            </div>

            {partnerId && (
              <div>
                <label className="text-[11px] text-ink-subtle block mb-1">Acuerdo de esta venta</label>
                <input
                  value={partnerNote}
                  onChange={(e) => setPartnerNote(e.target.value)}
                  placeholder="Solo si difiere del acuerdo general del partner"
                  className="input w-full"
                />
              </div>
            )}

            <div>
              <label className="text-[11px] text-ink-subtle block mb-1">Zona horaria</label>
              <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className="input w-full">
                {timezones.map((z) => (
                  <option key={z.value} value={z.value}>{z.label}</option>
                ))}
              </select>
              <p className="text-[11px] text-ink-subtle mt-1">Es la hora de reloj de la agenda: turnos, citas y avisos.</p>
            </div>

            {/* La agenda se vende aparte: la prende el operador, no la empresa. */}
            <label className="flex items-start gap-2 cursor-pointer rounded-lg p-3" style={{ background: 'var(--surface-muted)' }}>
              <input
                type="checkbox"
                checked={agendaEnabled}
                onChange={(e) => setAgendaEnabled(e.target.checked)}
                className="w-3.5 h-3.5 mt-0.5"
              />
              <span className="text-xs text-ink">
                Agenda de citas
                <span className="block text-[11px] text-ink-subtle">
                  Agrega la agenda por clínica y la configuración de doctores y turnos. Apagarla no borra nada:
                  doctores y citas vuelven al prenderla.
                </span>
              </span>
            </label>

            {/* El interruptor de corte. Es la alternativa a borrar, que es irreversible. */}
            <label
              className="flex items-start gap-2 cursor-pointer rounded-lg p-3"
              style={{ background: isActive ? 'var(--surface-muted)' : '#FEF2F2' }}
            >
              <input
                type="checkbox"
                checked={!isActive}
                onChange={(e) => setIsActive(!e.target.checked)}
                className="w-3.5 h-3.5 mt-0.5 accent-red-500"
              />
              <span className="text-xs text-ink">
                Desactivar esta empresa
                <span className="block text-[11px] text-ink-subtle">
                  Nadie de la empresa va a poder entrar, con un aviso al intentarlo. No se borra nada:
                  conversaciones, contactos y plantillas quedan intactos y vuelven al reactivarla.
                </span>
              </span>
            </label>
          </div>

          <div className="flex gap-2 mt-5">
            <button type="button" onClick={onClose} className="btn-secondary flex-1">Cancelar</button>
            <button type="submit" disabled={saving || !name.trim()} className="btn-primary flex-1">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Guardar
            </button>
          </div>
        </form>
      </div>
    </ModalPortal>
  );
}
