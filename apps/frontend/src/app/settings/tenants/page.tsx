'use client';
import { useEffect, useState } from 'react';
import { tenantsApi } from '@/lib/api';
import { Building2, Plus, Loader2, X, Copy, Check, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';

interface TenantRow {
  id: string;
  name: string;
  slug: string;
  plan: string;
  isActive: boolean;
  createdAt: string;
  _count: { users: number; conversations: number };
}

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

function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
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
  });

  function load() {
    setIsLoading(true);
    tenantsApi.list().then(setTenants).catch(() => toast.error('Error al cargar empresas')).finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, []);

  function handleNameChange(name: string) {
    setForm((f) => ({ ...f, name, slug: slugTouched ? f.slug : slugify(name) }));
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setIsSaving(true);
    try {
      const created = await tenantsApi.create(form);
      setResult({ tenant: created.tenant, admin: created.admin, password: form.adminPassword });
      setTenants((prev) => [created.tenant, ...prev]);
      setForm({ name: '', slug: '', adminName: '', adminEmail: '', adminPassword: generatePassword() });
      setSlugTouched(false);
      setShowForm(false);
      toast.success('Empresa creada');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Error al crear la empresa');
    } finally {
      setIsSaving(false);
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
                required placeholder="Contraseña temporal" minLength={6} value={form.adminPassword}
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
                  </div>
                  <p className="text-xs text-ink-subtle truncate font-mono">{t.slug}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-xs text-ink-muted">{t._count.users} usuarios</p>
                  <p className="text-[11px] text-ink-subtle">{t._count.conversations} conversaciones</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
