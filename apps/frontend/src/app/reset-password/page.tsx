'use client';
import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { authApi } from '@/lib/api';
import { Loader2, ShieldCheck } from 'lucide-react';
import { BRAND } from '@/lib/brand';
import toast from 'react-hot-toast';
import { validarPassword, PASSWORD_HINT, PASSWORD_MIN_LENGTH } from '@/lib/password';

function ResetPasswordForm() {
  const router = useRouter();
  const token = useSearchParams().get('token') ?? '';

  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== repeat) {
      toast.error('Las dos contraseñas no coinciden');
      return;
    }
    const problema = validarPassword(password);
    if (problema) {
      toast.error(problema);
      return;
    }
    setSaving(true);
    try {
      await authApi.resetPassword(token, password);
      setDone(true);
      // Un respiro para que se lea el mensaje antes de mandarlo a entrar.
      setTimeout(() => router.push('/login'), 2500);
    } catch (err: any) {
      const msg = err?.response?.data?.message;
      toast.error(Array.isArray(msg) ? msg[0] : msg || 'No se pudo cambiar la contraseña');
    } finally {
      setSaving(false);
    }
  }

  if (!token) {
    return (
      <div className="card p-6 mt-6">
        <p className="text-sm font-semibold text-ink mb-2">Enlace incompleto</p>
        <p className="text-sm text-ink-muted leading-relaxed mb-5">
          Este enlace no trae el código de recuperación. Copialo completo desde el correo,
          o pedí uno nuevo.
        </p>
        <Link href="/forgot-password" className="btn-primary w-full justify-center text-sm">
          Pedir un enlace nuevo
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="card p-6 mt-6 animate-fade-in">
        <ShieldCheck className="w-8 h-8 text-ink-muted mb-3" />
        <p className="text-sm font-semibold text-ink mb-2">Listo</p>
        <p className="text-sm text-ink-muted leading-relaxed mb-5">
          Tu contraseña quedó cambiada. Te llevamos a entrar.
        </p>
        <Link href="/login" className="btn-primary w-full justify-center text-sm">
          Entrar ahora
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="card p-6 mt-6 space-y-4">
      <div>
        <p className="text-sm font-semibold text-ink mb-1">Elegí una contraseña nueva</p>
        <p className="text-sm text-ink-muted leading-relaxed">{PASSWORD_HINT}</p>
      </div>

      <input
        required autoFocus type="password" placeholder="Contraseña nueva"
        minLength={PASSWORD_MIN_LENGTH} autoComplete="new-password"
        value={password} onChange={(e) => setPassword(e.target.value)}
        className="input w-full"
      />
      <input
        required type="password" placeholder="Repetila"
        minLength={PASSWORD_MIN_LENGTH} autoComplete="new-password"
        value={repeat} onChange={(e) => setRepeat(e.target.value)}
        className="input w-full"
      />

      <button type="submit" disabled={saving} className="btn-primary w-full justify-center text-sm disabled:opacity-50">
        {saving && <Loader2 className="w-4 h-4 animate-spin" />}
        Cambiar contraseña
      </button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-surface-muted">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-bold text-ink mb-1" style={{ letterSpacing: '-0.02em' }}>
          {BRAND.name}
        </h1>
        {/* useSearchParams obliga a un limite de Suspense para poder prerenderizar. */}
        <Suspense fallback={<div className="card p-6 mt-6 text-sm text-ink-muted">Cargando…</div>}>
          <ResetPasswordForm />
        </Suspense>
      </div>
    </div>
  );
}
