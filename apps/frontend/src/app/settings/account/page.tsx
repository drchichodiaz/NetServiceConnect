'use client';
import { useState } from 'react';
import { authApi } from '@/lib/api';
import { useAuthStore } from '@/store/auth.store';
import { Loader2, Check, KeyRound, UserCircle } from 'lucide-react';
import toast from 'react-hot-toast';

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Administrador',
  SUPERVISOR: 'Supervisor',
  AGENT: 'Agente',
};

export default function AccountPage() {
  const { user, setUser } = useAuthStore();

  const [name, setName] = useState(user?.name ?? '');
  const [savingName, setSavingName] = useState(false);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [repeat, setRepeat] = useState('');
  const [savingPw, setSavingPw] = useState(false);

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setSavingName(true);
    try {
      const updated = await authApi.updateProfile({ name });
      // El nombre se muestra en el sidebar desde el store, asi que hay que refrescarlo
      // ahi tambien o el cambio no se ve hasta el proximo login.
      if (user) setUser({ ...user, name: updated.name });
      toast.success('Perfil actualizado');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'No se pudo guardar');
    } finally {
      setSavingName(false);
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault();
    if (next !== repeat) {
      toast.error('La contraseña nueva y su repetición no coinciden');
      return;
    }
    setSavingPw(true);
    try {
      await authApi.changePassword({ currentPassword: current, newPassword: next });
      setCurrent(''); setNext(''); setRepeat('');
      toast.success('Contraseña actualizada');
    } catch (err: any) {
      const msg = err?.response?.data?.message;
      toast.error(Array.isArray(msg) ? msg[0] : msg || 'No se pudo cambiar la contraseña');
    } finally {
      setSavingPw(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto py-10 px-6 animate-fade-in space-y-5">
      <div>
        <h1 className="text-xl font-bold text-ink mb-1" style={{ letterSpacing: '-0.02em' }}>Mi cuenta</h1>
        <p className="text-sm text-ink-muted">Tus datos y tu acceso al sistema</p>
      </div>

      {/* ── Perfil ─────────────────────────────────────────────── */}
      <form onSubmit={handleSaveProfile} className="card p-5 space-y-4">
        <p className="text-sm font-semibold text-ink flex items-center gap-2">
          <UserCircle className="w-4 h-4 text-ink-muted" /> Perfil
        </p>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-ink-subtle">Nombre</label>
          <input
            required minLength={2} value={name}
            onChange={(e) => setName(e.target.value)}
            className="input w-full"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-ink-subtle">Email</label>
            <input value={user?.email ?? ''} disabled className="input w-full opacity-60 cursor-not-allowed" />
            <p className="text-[11px] text-ink-subtle">
              Es con lo que entrás. Para cambiarlo, pedíselo a un administrador.
            </p>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-ink-subtle">Rol</label>
            <input
              value={ROLE_LABELS[user?.role ?? ''] ?? user?.role ?? ''}
              disabled
              className="input w-full opacity-60 cursor-not-allowed"
            />
            <p className="text-[11px] text-ink-subtle">Lo define un administrador.</p>
          </div>
        </div>

        <button type="submit" disabled={savingName} className="btn-primary text-sm disabled:opacity-50">
          {savingName ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Guardar
        </button>
      </form>

      {/* ── Contraseña ─────────────────────────────────────────── */}
      <form onSubmit={handleChangePassword} className="card p-5 space-y-4">
        <p className="text-sm font-semibold text-ink flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-ink-muted" /> Cambiar contraseña
        </p>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-ink-subtle">Contraseña actual</label>
          <input
            required type="password" autoComplete="current-password"
            value={current} onChange={(e) => setCurrent(e.target.value)}
            className="input w-full"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-ink-subtle">Nueva</label>
            <input
              required type="password" minLength={6} autoComplete="new-password"
              value={next} onChange={(e) => setNext(e.target.value)}
              className="input w-full"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-ink-subtle">Repetir la nueva</label>
            <input
              required type="password" minLength={6} autoComplete="new-password"
              value={repeat} onChange={(e) => setRepeat(e.target.value)}
              className="input w-full"
            />
          </div>
        </div>

        <p className="text-[11px] text-ink-subtle">
          Mínimo 6 caracteres. Las sesiones que ya tengas abiertas en otros dispositivos
          siguen activas hasta que venzan.
        </p>

        <button type="submit" disabled={savingPw} className="btn-primary text-sm disabled:opacity-50">
          {savingPw ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
          Cambiar contraseña
        </button>
      </form>
    </div>
  );
}
