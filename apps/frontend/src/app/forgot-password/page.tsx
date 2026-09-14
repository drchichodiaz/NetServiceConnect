'use client';
import { useState } from 'react';
import Link from 'next/link';
import { authApi } from '@/lib/api';
import { Loader2, ArrowLeft, MailCheck } from 'lucide-react';
import { BRAND } from '@/lib/brand';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    try {
      await authApi.forgotPassword(email);
    } catch {
      // Se muestra lo mismo pase lo que pase: si la pantalla distinguiera entre "te
      // mandamos el correo" y "esa dirección no existe", serviría para averiguar qué
      // cuentas hay en el sistema.
    } finally {
      setSending(false);
      setSent(true);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-6 bg-surface-muted">
      <div className="w-full max-w-sm">
        <h1 className="text-xl font-bold text-ink mb-1" style={{ letterSpacing: '-0.02em' }}>
          {BRAND.name}
        </h1>

        {sent ? (
          <div className="card p-6 mt-6 animate-fade-in">
            <MailCheck className="w-8 h-8 text-ink-muted mb-3" />
            <p className="text-sm font-semibold text-ink mb-2">Revisá tu correo</p>
            <p className="text-sm text-ink-muted leading-relaxed mb-4">
              Si <strong className="text-ink font-medium">{email}</strong> tiene una cuenta,
              le llegó un enlace para elegir una contraseña nueva. Vence en una hora y sirve
              una sola vez.
            </p>
            <p className="text-xs text-ink-subtle leading-relaxed mb-5">
              ¿No lo ves? Fijate en spam, o volvé a pedirlo dentro de unos minutos.
            </p>
            <Link href="/login" className="btn-secondary w-full justify-center text-sm">
              Volver a entrar
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="card p-6 mt-6 space-y-4">
            <div>
              <p className="text-sm font-semibold text-ink mb-1">¿Olvidaste tu contraseña?</p>
              <p className="text-sm text-ink-muted leading-relaxed">
                Escribí tu email y te mandamos un enlace para elegir una nueva.
              </p>
            </div>

            <input
              required autoFocus type="email" placeholder="tu@empresa.com"
              autoComplete="username"
              value={email} onChange={(e) => setEmail(e.target.value)}
              className="input w-full"
            />

            <button type="submit" disabled={sending} className="btn-primary w-full justify-center text-sm disabled:opacity-50">
              {sending && <Loader2 className="w-4 h-4 animate-spin" />}
              Enviar enlace
            </button>

            <Link href="/login" className="flex items-center justify-center gap-1.5 text-xs text-ink-muted hover:text-ink transition-colors">
              <ArrowLeft className="w-3.5 h-3.5" />
              Volver a entrar
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
