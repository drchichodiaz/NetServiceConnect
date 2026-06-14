'use client';
import { useEffect, useState } from 'react';
import { whatsappApi } from '@/lib/api';
import { WhatsAppAccount } from '@/types';
import EmbeddedSignup from '@/components/whatsapp/EmbeddedSignup';
import {
  CheckCircle, XCircle, Copy, Eye, EyeOff, Wifi, WifiOff,
  KeyRound, Loader2, AlertCircle, Zap,
} from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';

type ConnectTab = 'embedded' | 'token';

export default function WhatsAppSettingsPage() {
  const [account,   setAccount]   = useState<WhatsAppAccount | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [tab,       setTab]       = useState<ConnectTab>('embedded');

  useEffect(() => {
    whatsappApi.getAccount()
      .then(setAccount)
      .catch(() => setAccount(null))
      .finally(() => setIsLoading(false));
  }, []);

  async function handleDisconnect() {
    if (!confirm('Desconectar desactivará la recepción de mensajes. ¿Continuar?')) return;
    try {
      await whatsappApi.disconnect();
      setAccount(null);
      toast.success('Cuenta desconectada');
    } catch {
      toast.error('Error al desconectar');
    }
  }

  const isConnected = account?.signupStatus === 'CONNECTED' && account?.isActive;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 rounded-full border-2 border-green-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-xl mx-auto py-10 px-6 animate-fade-in">
      <div className="mb-8">
        <h1 className="text-xl font-bold text-ink mb-1" style={{ letterSpacing: '-0.02em' }}>
          Configuración de WhatsApp
        </h1>
        <p className="text-sm text-ink-muted">
          Conecta tu cuenta de WhatsApp Business para recibir y enviar mensajes.
        </p>
      </div>

      {isConnected && account ? (
        <div className="space-y-4">
          {/* Status card */}
          <div
            className="card p-5 flex items-start gap-4"
            style={{ border: '1px solid #BBF7D8' }}
          >
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: '#E8FBF0' }}
            >
              <Wifi className="w-5 h-5" style={{ color: '#25D366' }} />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-0.5">
                <p className="font-semibold text-ink text-sm">Conectado</p>
                <span
                  className="text-[10px] font-semibold rounded-full px-2 py-0.5"
                  style={{ background: '#E8FBF0', color: '#128C7E' }}
                >
                  Activo
                </span>
              </div>
              <p className="text-xs text-ink-muted">
                {account.displayName || account.businessName || 'WhatsApp Business'} &mdash; {account.phoneNumber}
              </p>
            </div>
          </div>

          {/* Details */}
          <div className="card overflow-hidden">
            <div className="px-5 py-3.5" style={{ borderBottom: '1px solid var(--border)' }}>
              <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider">Detalles de la cuenta</p>
            </div>
            <div className="divide-y divide-border">
              <AccountRow label="Número de teléfono"   value={account.phoneNumber} />
              <AccountRow label="Nombre"                value={account.displayName} />
              <AccountRow label="Empresa"               value={account.businessName} />
              <AccountRow label="WABA ID"               value={account.wabaId}    mono />
              <AccountRow label="Webhook Verify Token"  value={account.webhookVerifyToken} mono secret />
            </div>
          </div>

          {/* Webhook URL */}
          <div className="card p-5">
            <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">
              URL del Webhook (configurar en Meta)
            </p>
            <div
              className="flex items-center gap-2 rounded-lg px-3 py-2.5 font-mono text-xs text-ink-muted"
              style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
            >
              <span className="flex-1 truncate">
                {typeof window !== 'undefined'
                  ? `${window.location.protocol}//${window.location.hostname.replace(':3000', '')}:3001/api/whatsapp/webhook`
                  : 'https://tudominio.com/api/whatsapp/webhook'}
              </span>
              <button
                onClick={() => {
                  const url = `${window.location.protocol}//${window.location.hostname.replace(':3000', '')}:3001/api/whatsapp/webhook`;
                  navigator.clipboard.writeText(url);
                  toast.success('URL copiada');
                }}
                className="shrink-0 text-ink-subtle hover:text-ink transition-colors"
              >
                <Copy className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Disconnect */}
          <button
            onClick={handleDisconnect}
            className="flex items-center gap-2 text-sm text-red-500 hover:text-red-600 font-medium transition-colors"
          >
            <WifiOff className="w-4 h-4" />
            Desconectar cuenta
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Tab switcher */}
          <div
            className="flex rounded-xl p-1 gap-1"
            style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
          >
            <TabBtn active={tab === 'embedded'} onClick={() => setTab('embedded')}>
              <CheckCircle className="w-3.5 h-3.5" />
              Embedded Signup
            </TabBtn>
            <TabBtn active={tab === 'token'} onClick={() => setTab('token')}>
              <Zap className="w-3.5 h-3.5" />
              Token directo
            </TabBtn>
          </div>

          {tab === 'embedded' && (
            <EmbeddedSignup
              onConnected={(acc) => { setAccount(acc); toast.success('WhatsApp conectado'); }}
            />
          )}

          {tab === 'token' && (
            <DirectTokenForm
              onConnected={(acc) => { setAccount(acc); toast.success('WhatsApp conectado'); }}
            />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Tab button ───────────────────────────────────────────────────────────────

function TabBtn({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'flex-1 flex items-center justify-center gap-1.5 text-xs font-semibold py-2 px-3 rounded-lg transition-all',
        active
          ? 'bg-white text-ink shadow-sm'
          : 'text-ink-muted hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

// ─── Direct Token Form ────────────────────────────────────────────────────────

function DirectTokenForm({ onConnected }: { onConnected: (acc: WhatsAppAccount) => void }) {
  const [accessToken,   setAccessToken]   = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId,        setWabaId]        = useState('');
  const [loading,       setLoading]       = useState(false);
  const [errorMsg,      setErrorMsg]      = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken.trim() || !phoneNumberId.trim()) {
      toast.error('El token y el Phone Number ID son obligatorios');
      return;
    }

    setLoading(true);
    setErrorMsg('');
    try {
      await whatsappApi.connectDirect({
        accessToken: accessToken.trim(),
        phoneNumberId: phoneNumberId.trim(),
        wabaId: wabaId.trim() || undefined,
      });
      // Fetch del account completo para obtener signupStatus, isActive, etc.
      const account = await whatsappApi.getAccount();
      onConnected(account as WhatsAppAccount);
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Error al conectar';
      setErrorMsg(Array.isArray(msg) ? msg.join(', ') : msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card p-6">
      {/* Header */}
      <div className="flex items-start gap-3 mb-6">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
        >
          <KeyRound className="w-5 h-5 text-ink-muted" />
        </div>
        <div>
          <p className="font-semibold text-ink text-sm">Conectar con token de acceso</p>
          <p className="text-xs text-ink-muted mt-0.5">
            Usa un token temporal generado desde el Panel de Desarrolladores de Meta.
          </p>
        </div>
      </div>

      {/* Guide */}
      <div
        className="rounded-xl p-4 mb-5 text-xs text-ink-muted space-y-1"
        style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
      >
        <p className="font-semibold text-ink text-[11px] uppercase tracking-wider mb-2">Cómo obtener el token</p>
        <p>1. Abre <span className="font-mono text-ink">developers.facebook.com</span> → Tu App → WhatsApp → Configuración de la API</p>
        <p>2. En <strong>Paso 1: Pruébalo</strong>, copia el token temporal</p>
        <p>3. En <strong>Paso 2</strong>, copia el <strong>ID de número de teléfono</strong></p>
        <p>4. Opcionalmente copia el <strong>ID de cuenta de WhatsApp Business</strong></p>
      </div>

      {errorMsg && (
        <div className="flex items-start gap-3 rounded-xl p-4 mb-5 text-sm"
          style={{ background: '#FEF2F2', border: '1px solid #FECACA' }}>
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <p className="text-red-600">{errorMsg}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <FormField
          label="Token de acceso"
          required
          hint="El token temporal de ~24h de la sección Pruébalo"
        >
          <textarea
            value={accessToken}
            onChange={(e) => setAccessToken(e.target.value)}
            placeholder="EAAQph..."
            rows={3}
            className="input w-full font-mono text-xs resize-none"
            style={{ lineHeight: '1.6' }}
          />
        </FormField>

        <FormField label="Phone Number ID" required hint="Número de 15-16 dígitos de la sección Paso 2">
          <input
            type="text"
            value={phoneNumberId}
            onChange={(e) => setPhoneNumberId(e.target.value.replace(/\D/g, ''))}
            placeholder="1089996204193713"
            className="input w-full font-mono text-sm"
          />
        </FormField>

        <FormField label="WABA ID" hint="Opcional — el backend lo detecta automáticamente">
          <input
            type="text"
            value={wabaId}
            onChange={(e) => setWabaId(e.target.value.replace(/\D/g, ''))}
            placeholder="1679901876770651"
            className="input w-full font-mono text-sm"
          />
        </FormField>

        <button
          type="submit"
          disabled={loading || !accessToken.trim() || !phoneNumberId.trim()}
          className="btn-primary w-full flex items-center justify-center gap-2"
        >
          {loading ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Conectando...
            </>
          ) : (
            <>
              <Zap className="w-4 h-4" />
              Conectar cuenta
            </>
          )}
        </button>
      </form>
    </div>
  );
}

// ─── Form field wrapper ───────────────────────────────────────────────────────

function FormField({
  label, required, hint, children,
}: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-semibold text-ink flex items-center gap-1">
        {label}
        {required && <span className="text-red-400">*</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] text-ink-subtle">{hint}</p>}
    </div>
  );
}

// ─── Account detail row ───────────────────────────────────────────────────────

function AccountRow({
  label, value, mono, secret,
}: { label: string; value?: string | null; mono?: boolean; secret?: boolean }) {
  const [visible, setVisible] = useState(!secret);

  function copy() {
    if (value) { navigator.clipboard.writeText(value); toast.success('Copiado'); }
  }

  return (
    <div className="flex items-center justify-between gap-4 px-5 py-3">
      <span className="text-xs text-ink-muted w-40 shrink-0">{label}</span>
      <div className="flex items-center gap-2 flex-1 min-w-0">
        {value ? (
          <>
            <span className={clsx('text-sm text-ink truncate', mono && 'font-mono text-xs')}>
              {secret && !visible ? '••••••••••••••••' : value}
            </span>
            <div className="flex items-center gap-1 shrink-0">
              {secret && (
                <button onClick={() => setVisible(!visible)} className="text-ink-subtle hover:text-ink transition-colors">
                  {visible ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              )}
              <button onClick={copy} className="text-ink-subtle hover:text-ink transition-colors">
                <Copy className="w-3.5 h-3.5" />
              </button>
            </div>
          </>
        ) : (
          <span className="text-sm text-ink-subtle italic">No disponible</span>
        )}
      </div>
    </div>
  );
}
