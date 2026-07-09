'use client';
import { useEffect, useState } from 'react';
import { usersApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { UserPlus, Loader2, X, KeyRound } from 'lucide-react';
import toast from 'react-hot-toast';

interface TeamUser { id: string; name: string; email: string; role: string; isActive: boolean; }

const ROLE_STYLES: Record<string, { label: string; bg: string; color: string }> = {
  ADMIN:      { label: 'Admin',      bg: '#F3E8FF', color: '#7E22CE' },
  SUPERVISOR: { label: 'Supervisor', bg: '#DBEAFE', color: '#1D4ED8' },
  AGENT:      { label: 'Agente',     bg: '#F3F4F6', color: '#374151' },
};

export default function TeamPage() {
  const [users,     setUsers]     = useState<TeamUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showForm,  setShowForm]  = useState(false);
  const [isSaving,  setIsSaving]  = useState(false);
  const { user: me } = useAuthStore();
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'AGENT' });
  const [pwEditId,  setPwEditId]  = useState<string | null>(null);
  const [pwValue,   setPwValue]   = useState('');
  const [pwSaving,  setPwSaving]  = useState(false);

  useEffect(() => {
    usersApi.list().then(setUsers).finally(() => setIsLoading(false));
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setIsSaving(true);
    try {
      const u = await usersApi.create(form);
      setUsers((prev) => [...prev, u]);
      setForm({ name: '', email: '', password: '', role: 'AGENT' });
      setShowForm(false);
      toast.success('Usuario creado');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Error al crear usuario');
    } finally {
      setIsSaving(false);
    }
  }

  const canManage = me?.role === 'ADMIN' || me?.role === 'SUPERVISOR';

  function startPasswordEdit(id: string) {
    setPwEditId(id);
    setPwValue('');
  }

  async function handleChangePassword(id: string) {
    if (pwValue.length < 6) {
      toast.error('La contrasena debe tener al menos 6 caracteres');
      return;
    }
    setPwSaving(true);
    try {
      await usersApi.update(id, { password: pwValue });
      toast.success('Contrasena actualizada');
      setPwEditId(null);
      setPwValue('');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Error al actualizar la contrasena');
    } finally {
      setPwSaving(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto py-10 px-6 animate-fade-in">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-xl font-bold text-ink mb-1" style={{ letterSpacing: '-0.02em' }}>Equipo</h1>
          <p className="text-sm text-ink-muted">Gestiona los agentes de tu espacio de trabajo</p>
        </div>
        {canManage && (
          <button onClick={() => setShowForm(!showForm)} className="btn-primary">
            {showForm ? <X className="w-4 h-4" /> : <UserPlus className="w-4 h-4" />}
            {showForm ? 'Cancelar' : 'Agregar'}
          </button>
        )}
      </div>

      {showForm && (
        <form onSubmit={handleCreate} className="card p-5 mb-5 animate-fade-in">
          <p className="text-sm font-semibold text-ink mb-4">Nuevo usuario</p>
          <div className="space-y-3">
            <input
              required placeholder="Nombre completo" value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} className="input"
            />
            <div className="grid grid-cols-2 gap-3">
              <input
                required type="email" placeholder="Email" value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className="input"
              />
              <input
                required type="password" placeholder="Contrasena" minLength={6} value={form.password}
                onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} className="input"
              />
            </div>
            <select value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} className="input">
              <option value="AGENT">Agente</option>
              <option value="SUPERVISOR">Supervisor</option>
              {me?.role === 'ADMIN' && <option value="ADMIN">Admin</option>}
            </select>
          </div>
          <div className="flex gap-2 mt-4">
            <button type="button" onClick={() => setShowForm(false)} className="btn-secondary flex-1">Cancelar</button>
            <button type="submit" disabled={isSaving} className="btn-primary flex-1">
              {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Crear usuario
            </button>
          </div>
        </form>
      )}

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-5 h-5 rounded-full border-2 border-green-500 border-t-transparent animate-spin" />
          </div>
        ) : users.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-ink-subtle text-sm">Sin usuarios todavia</div>
        ) : (
          <div className="divide-y divide-border">
            {users.map((u, i) => {
              const rs = ROLE_STYLES[u.role] ?? ROLE_STYLES.AGENT;
              return (
                <div key={u.id} className="animate-fade-in" style={{ animationDelay: `${i * 40}ms` }}>
                  <div className="flex items-center gap-3.5 px-5 py-3.5">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center text-sm font-semibold shrink-0" style={{ background: '#E8FBF0', color: '#128C7E' }}>
                      {u.name[0]?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-ink truncate">{u.name}</p>
                        {u.id === me?.id && <span className="text-[10px] text-ink-subtle">(tu)</span>}
                        {!u.isActive && <span className="text-[10px] text-red-400 font-medium">Inactivo</span>}
                      </div>
                      <p className="text-xs text-ink-subtle truncate">{u.email}</p>
                    </div>
                    <span className="text-[11px] font-semibold rounded-full px-2.5 py-1 shrink-0" style={{ background: rs.bg, color: rs.color }}>
                      {rs.label}
                    </span>
                    {canManage && (
                      <button
                        onClick={() => (pwEditId === u.id ? setPwEditId(null) : startPasswordEdit(u.id))}
                        title="Cambiar contrasena"
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-subtle hover:text-ink hover:bg-black/5 shrink-0"
                      >
                        <KeyRound className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                  {pwEditId === u.id && (
                    <div className="px-5 pb-3.5 flex gap-2 animate-fade-in">
                      <input
                        autoFocus
                        type="password"
                        placeholder="Nueva contrasena (min. 6 caracteres)"
                        minLength={6}
                        value={pwValue}
                        onChange={(e) => setPwValue(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleChangePassword(u.id)}
                        className="input flex-1"
                      />
                      <button
                        onClick={() => handleChangePassword(u.id)}
                        disabled={pwSaving}
                        className="btn-primary"
                      >
                        {pwSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        Guardar
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
