'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/store/auth.store';
import { Loader2, MessageSquare, Check } from 'lucide-react';
import { BRAND } from '@/lib/brand';

const CHECKLIST = [
  'Asigna conversaciones a tu equipo',
  'Sugerencias con IA en tiempo real',
  'Multi-tenant seguro, por empresa',
];

export default function LoginPage() {
  const router = useRouter();
  const { login, isLoading, hydrate, token } = useAuthStore();
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');

  useEffect(() => { hydrate(); }, [hydrate]);
  useEffect(() => { if (token) router.replace('/inbox'); }, [token, router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await login(email, password);
      router.replace('/inbox');
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Credenciales incorrectas';
      toast.error(Array.isArray(msg) ? msg.join(', ') : msg);
    }
  }

  return (
    <div className="min-h-screen flex bg-white">
      {/* Panel izquierdo — editorial, claro */}
      <div className="hidden lg:flex flex-col justify-center w-[58%] px-24 py-16">
        <div className="flex items-center gap-2 mb-5">
          <span className="w-1.5 h-1.5 rounded-sm shrink-0" style={{ background: '#25D366' }} />
          <span className="text-xs font-bold uppercase tracking-[0.14em]" style={{ color: '#15803d' }}>
            {BRAND.name}
          </span>
        </div>

        <h1 className="text-[58px] font-bold leading-[1.05] tracking-tight text-ink mb-5 max-w-[620px]">
          Atiende a tus clientes{' '}
          <span className="relative whitespace-nowrap">
            <span className="absolute inset-x-0 bottom-1.5 h-3.5 -z-10" style={{ background: '#dcfced' }} />
            donde ya están.
          </span>
        </h1>

        <p className="text-[17px] leading-relaxed text-ink-muted mb-10 max-w-[460px]">
          {BRAND.tagline} — multiagente, respuestas con IA y datos aislados por empresa.
        </p>

        <div className="flex flex-col gap-4 mb-14">
          {CHECKLIST.map((item) => (
            <div key={item} className="flex items-center gap-3">
              <span
                className="w-5 h-5 rounded-full flex items-center justify-center shrink-0"
                style={{ background: '#25D366' }}
              >
                <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />
              </span>
              <span className="text-[15px] font-medium text-ink">{item}</span>
            </div>
          ))}
        </div>

        <p className="text-xs text-ink-subtle">
          <strong className="text-ink-muted font-semibold">Plataforma segura.</strong>{' '}
          Los datos de cada empresa están completamente aislados.
        </p>
      </div>

      {/* Panel derecho — form */}
      <div className="flex-1 flex items-center justify-center p-8" style={{ background: '#f0fdf6' }}>
        <div className="flex flex-col items-start gap-3.5 w-full max-w-[380px]">
          <div
            className="w-full bg-white rounded"
            style={{ border: '1px solid var(--border)', borderTop: '4px solid #25D366' }}
          >
            <div className="p-9">
              {/* Logo mobile + dentro de la tarjeta (única marca visible en pantallas chicas) */}
              <div className="flex items-center gap-2.5 mb-7">
                <div className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0" style={{ background: '#1A1D23' }}>
                  <MessageSquare className="w-3.5 h-3.5 text-white" />
                </div>
                <span className="text-sm font-bold text-ink tracking-tight">{BRAND.name}</span>
              </div>

              <h2 className="text-xl font-bold text-ink mb-1 tracking-tight">Bienvenido de vuelta</h2>
              <p className="text-[13px] text-ink-muted mb-6">Inicia sesión en tu cuenta de equipo</p>

              <form onSubmit={handleSubmit} className="flex flex-col gap-3.5">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider">
                    Correo electrónico
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="agente@empresa.com"
                    className="input"
                    style={{ borderRadius: 4 }}
                  />
                </div>

                <div className="flex flex-col gap-1.5">
                  <label className="text-[11px] font-semibold text-ink-muted uppercase tracking-wider">
                    Contraseña
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    placeholder="••••••••"
                    className="input"
                    style={{ borderRadius: 4 }}
                  />
                </div>

                <button
                  type="submit"
                  disabled={isLoading}
                  className="mt-1.5 w-full flex items-center justify-center gap-2 py-3 text-sm font-semibold text-white transition-opacity disabled:opacity-60"
                  style={{ background: '#1A1D23', borderRadius: 4 }}
                >
                  {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                  {isLoading ? 'Iniciando sesión...' : 'Iniciar sesión'}
                </button>
              </form>
            </div>
          </div>

          {/* Vista previa de chat — acento discreto, nunca compite con el form */}
          <div
            className="w-[200px] ml-2 bg-white rounded-md p-3 opacity-90"
            style={{ border: '1px solid var(--border)', boxShadow: '0 2px 8px -2px rgb(0 0 0 / 0.06)' }}
          >
            <div className="flex mb-2">
              <span className="max-w-[84%] px-2.5 py-1.5 rounded-[10px] rounded-bl-sm text-[11px] leading-snug bg-surface-muted text-ink animate-show-bubble-1">
                ¿A qué hora abren mañana?
              </span>
            </div>
            <div className="flex mb-2">
              <span className="inline-flex items-center gap-1 px-2.5 py-2 rounded-[10px] rounded-bl-sm bg-surface-muted animate-show-typing">
                <span className="w-1 h-1 rounded-full bg-ink-subtle animate-pulse-dot" />
                <span className="w-1 h-1 rounded-full bg-ink-subtle animate-pulse-dot" style={{ animationDelay: '0.15s' }} />
                <span className="w-1 h-1 rounded-full bg-ink-subtle animate-pulse-dot" style={{ animationDelay: '0.3s' }} />
              </span>
            </div>
            <div className="flex justify-end">
              <span
                className="max-w-[84%] px-2.5 py-1.5 rounded-[10px] rounded-br-sm text-[11px] leading-snug animate-show-bubble-2"
                style={{ background: '#dcfced', color: '#15803d' }}
              >
                Lunes a sábado, 9 a 18h 👋
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
