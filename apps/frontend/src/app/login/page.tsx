'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/store/auth.store';
import { Loader2, MessageSquare, Users, Zap, ShieldCheck } from 'lucide-react';
import dynamic from 'next/dynamic';

// Carga dinámica para evitar SSR con framer-motion
const LoginAnimation = dynamic(
  () => import('@/components/login/LoginAnimation'),
  { ssr: false, loading: () => <div className="h-80" /> },
);

const features = [
  { icon: Users,       label: 'Multiagente',          desc: 'Asigna conversaciones a tu equipo' },
  { icon: Zap,         label: 'Respuestas con IA',     desc: 'Sugerencias inteligentes en tiempo real' },
  { icon: ShieldCheck, label: 'Multi-tenant seguro',   desc: 'Datos aislados por empresa' },
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
    <div className="min-h-screen flex">
      {/* Left panel — branding */}
      <div
        className="hidden lg:flex flex-col justify-between w-[480px] shrink-0 relative overflow-hidden p-12"
        style={{ background: 'var(--sidebar-bg)' }}
      >
        {/* Glow de fondo sutil */}
        <div
          className="absolute -top-40 -right-40 w-96 h-96 rounded-full opacity-[0.07] pointer-events-none"
          style={{ background: 'radial-gradient(circle, #25D366 0%, transparent 70%)' }}
        />

        {/* Logo — top */}
        <div className="relative z-10 flex items-center gap-3">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center"
            style={{ background: '#25D366' }}
          >
            <MessageSquare className="w-4 h-4 text-white" />
          </div>
          <span className="text-white font-semibold tracking-tight">NetService Connect</span>
        </div>

        {/* Animación orbital — centro */}
        <div className="relative z-10 w-full">
          <LoginAnimation />
        </div>

        {/* Headline + features — bottom */}
        <div className="relative z-10">
          <h2
            className="text-2xl font-bold text-white leading-snug mb-5"
            style={{ letterSpacing: '-0.02em' }}
          >
            Atiende a tus clientes
            <br />
            <span style={{ color: '#25D366' }}>donde ya están.</span>
          </h2>

          <div className="space-y-3">
            {features.map(({ icon: Icon, label, desc }) => (
              <div key={label} className="flex items-center gap-3">
                <div
                  className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: '#25D36612', border: '1px solid #25D36620' }}
                >
                  <Icon className="w-3.5 h-3.5" style={{ color: '#25D366' }} />
                </div>
                <div>
                  <span className="text-sm font-medium text-white">{label}</span>
                  <span className="text-xs ml-2" style={{ color: '#6B7280' }}>{desc}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center p-6 bg-surface-muted">
        <div className="w-full max-w-[380px] animate-fade-in">

          {/* Mobile logo */}
          <div className="flex items-center gap-3 mb-10 lg:hidden">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: '#25D366' }}>
              <MessageSquare className="w-4 h-4 text-white" />
            </div>
            <span className="font-semibold text-ink">NetService Connect</span>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-bold text-ink mb-1" style={{ letterSpacing: '-0.02em' }}>
              Bienvenido de vuelta
            </h2>
            <p className="text-sm text-ink-muted">Inicia sesión en tu cuenta de equipo</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wider mb-1.5">
                Correo electrónico
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                placeholder="agente@empresa.com"
                className="input"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-ink-muted uppercase tracking-wider mb-1.5">
                Contraseña
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                placeholder="••••••••"
                className="input"
              />
            </div>

            <div className="pt-1">
              <button
                type="submit"
                disabled={isLoading}
                className="btn-primary w-full py-3"
              >
                {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                {isLoading ? 'Iniciando sesión...' : 'Iniciar sesión'}
              </button>
            </div>
          </form>

          <p className="text-xs text-ink-subtle text-center mt-8">
            Plataforma segura. Los datos de cada empresa están completamente aislados.
          </p>
        </div>
      </div>
    </div>
  );
}
