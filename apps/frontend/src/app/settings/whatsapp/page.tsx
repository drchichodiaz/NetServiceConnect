'use client';
import { useCallback, useEffect, useState } from 'react';
import { whatsappApi } from '@/lib/api';
import { WhatsAppAccount, accountLabel } from '@/types';
import EmbeddedSignup from '@/components/whatsapp/EmbeddedSignup';
import {
  CheckCircle, Copy, Eye, EyeOff, Wifi, WifiOff, Plus, Star,
  KeyRound, Loader2, AlertCircle, Zap, Pencil, RefreshCw, Phone, X, Check,
} from 'lucide-react';
import toast from 'react-hot-toast';
import clsx from 'clsx';

type ConnectTab = 'embedded' | 'token';

export default function WhatsAppSettingsPage() {
  const [accounts,    setAccounts]    = useState<WhatsAppAccount[]>([]);
  const [isLoading,   setIsLoading]   = useState(true);
  const [tab,         setTab]         = useState<ConnectTab>('embedded');
  const [showConnect, setShowConnect] = useState(false);
  const [isSyncing,   setIsSyncing]   = useState(false);

  const load = useCallback(async () => {
    try {
      setAccounts(await whatsappApi.listAccounts());
    } catch {
      setAccounts([]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const connected = accounts.filter((a) => a.isActive);
  const hasAny    = accounts.length > 0;

  function handleConnected() {
    setShowConnect(false);
    load();
    toast.success('Línea conectada');
  }

  // Trae el resto de los números del WABA ya conectado — es lo que evita repetir el
  // Embedded Signup una vez por sucursal cuando la empresa tiene 10 o 15 líneas.
  async function handleSync() {
    setIsSyncing(true);
    try {
      const res = await whatsappApi.syncAccounts();
      await load();
      if (res.imported > 0) {
        toast.success(`${res.imported} línea(s) nueva(s) importada(s) desde Meta`);
      } else if (res.ok) {
        toast('No hay números nuevos para importar');
      }
      if (res.failedWabas.length > 0) {
        toast.error(`No se pudieron leer los números de ${res.failedWabas.length} cuenta(s) de Meta`);
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Error al sincronizar');
    } finally {
      setIsSyncing(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 rounded-full border-2 border-green-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-10 px-6 animate-fade-in">
      <div className="mb-8">
        <h1 className="text-xl font-bold text-ink mb-1" style={{ letterSpacing: '-0.02em' }}>
          Líneas de WhatsApp
        </h1>
        <p className="text-sm text-ink-muted">
          Cada línea es un número de WhatsApp Business. Podés conectar una por sucursal:
          las conversaciones quedan separadas por línea y cada respuesta sale por el número
          al que escribió el cliente.
        </p>
      </div>

      {hasAny && (
        <div className="space-y-4 mb-8">
          {/* Resumen + acciones */}
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
              {connected.length} {connected.length === 1 ? 'línea activa' : 'líneas activas'}
              {accounts.length > connected.length && (
                <span className="text-ink-subtle normal-case font-medium">
                  {' '}· {accounts.length - connected.length} desconectada(s)
                </span>
              )}
            </p>
            <div className="flex items-center gap-2">
              <button
                onClick={handleSync}
                disabled={isSyncing}
                className="btn-ghost flex items-center gap-1.5 text-xs px-2.5 py-1.5"
                title="Importar el resto de los números de tu cuenta de Meta"
              >
                <RefreshCw className={clsx('w-3.5 h-3.5', isSyncing && 'animate-spin')} />
                Sincronizar con Meta
              </button>
              <button
                onClick={() => setShowConnect(!showConnect)}
                className="btn-ghost flex items-center gap-1.5 text-xs px-2.5 py-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                Conectar línea
              </button>
            </div>
          </div>

          {accounts.map((account) => (
            <AccountCard key={account.id} account={account} onChanged={setAccounts} />
          ))}
        </div>
      )}

      {(showConnect || !hasAny) && (
        <div className="space-y-4">
          {hasAny && (
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
                Conectar una línea nueva
              </p>
              <button onClick={() => setShowConnect(false)} className="btn-ghost w-7 h-7 p-0">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

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

          {tab === 'embedded' && <EmbeddedSignup onConnected={handleConnected} />}
          {tab === 'token'    && <DirectTokenForm onConnected={handleConnected} />}

          {hasAny && (
            <p className="text-[11px] text-ink-subtle">
              Si tus números ya están en la misma cuenta de WhatsApp Business, usá
              <strong className="text-ink-muted"> Sincronizar con Meta</strong> en vez de repetir
              este proceso por cada uno.
            </p>
          )}
        </div>
      )}

      <WebhookUrlCard />
    </div>
  );
}

// ─── Tarjeta de una línea ─────────────────────────────────────────────────────

function AccountCard({
  account, onChanged,
}: { account: WhatsAppAccount; onChanged: (accounts: WhatsAppAccount[]) => void }) {
  const [editing,    setEditing]    = useState(false);
  const [draft,      setDraft]      = useState(account.label ?? '');
  const [saving,     setSaving]     = useState(false);
  const [expanded,   setExpanded]   = useState(false);
  const [showPin,    setShowPin]    = useState(false);
  const [pin,        setPin]        = useState('');
  const [registering, setRegistering] = useState(false);
  const [checking,   setChecking]   = useState(false);

  const isConnected = account.signupStatus === 'CONNECTED' && account.isActive;
  // Meta dice CONNECTED solo cuando el número está registrado en la Cloud API y puede
  // enviar. Guardar la línea no alcanza — de ahí que este chip sea distinto del de arriba.
  const isRegistered = account.platformStatus === 'CONNECTED';

  async function checkStatus() {
    setChecking(true);
    try {
      onChanged(await whatsappApi.checkAccount(account.id));
      toast.success('Estado actualizado desde Meta');
    } catch {
      toast.error('No se pudo consultar el estado en Meta');
    } finally {
      setChecking(false);
    }
  }

  async function submitPin() {
    if (pin.length !== 6) {
      toast.error('El PIN es de 6 dígitos');
      return;
    }
    setRegistering(true);
    try {
      const res = await whatsappApi.registerAccount(account.id, pin);
      onChanged(await whatsappApi.listAccounts());
      setShowPin(false);
      setPin('');
      toast.success(res?.alreadyRegistered ? 'El número ya estaba registrado' : 'Número registrado en la Cloud API');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Error al registrar el número');
    } finally {
      setRegistering(false);
    }
  }

  async function saveLabel() {
    setSaving(true);
    try {
      await whatsappApi.updateAccount(account.id, { label: draft.trim() });
      onChanged(await whatsappApi.listAccounts());
      setEditing(false);
      toast.success('Nombre actualizado');
    } catch {
      toast.error('Error al guardar el nombre');
    } finally {
      setSaving(false);
    }
  }

  async function makeDefault() {
    try {
      onChanged(await whatsappApi.setDefaultAccount(account.id));
      toast.success('Línea predeterminada actualizada');
    } catch {
      toast.error('Error al cambiar la línea predeterminada');
    }
  }

  async function disconnect() {
    const ok = confirm(
      `Desconectar "${accountLabel(account)}" deja de recibir mensajes en ese número. El historial se conserva. ¿Continuar?`,
    );
    if (!ok) return;
    try {
      onChanged(await whatsappApi.disconnectAccount(account.id));
      toast.success('Línea desconectada');
    } catch {
      toast.error('Error al desconectar');
    }
  }

  return (
    <div className="card overflow-hidden" style={isConnected ? { border: '1px solid #BBF7D8' } : undefined}>
      <div className="p-4 flex items-start gap-3">
        <div
          className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: isConnected ? '#E8FBF0' : 'var(--surface-muted)' }}
        >
          {isConnected
            ? <Wifi className="w-4 h-4" style={{ color: '#25D366' }} />
            : <WifiOff className="w-4 h-4 text-ink-subtle" />}
        </div>

        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="flex items-center gap-1.5">
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter')  saveLabel();
                  if (e.key === 'Escape') { setDraft(account.label ?? ''); setEditing(false); }
                }}
                placeholder="Ej: Sucursal Palermo"
                maxLength={60}
                className="input flex-1 text-sm py-1"
              />
              <button onClick={saveLabel} disabled={saving} className="btn-ghost w-7 h-7 p-0">
                {saving
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Check className="w-3.5 h-3.5" style={{ color: '#25D366' }} />}
              </button>
              <button
                onClick={() => { setDraft(account.label ?? ''); setEditing(false); }}
                className="btn-ghost w-7 h-7 p-0"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <p className="font-semibold text-ink text-sm">{accountLabel(account)}</p>
              <button
                onClick={() => setEditing(true)}
                className="text-ink-subtle hover:text-ink transition-colors"
                title="Renombrar la línea"
              >
                <Pencil className="w-3 h-3" />
              </button>
              {account.isDefault && (
                <span
                  className="flex items-center gap-1 text-[10px] font-semibold rounded-full px-2 py-0.5"
                  style={{ background: '#EEF2FF', color: '#4F46E5' }}
                  title="Se usa para dar de alta plantillas y para conversaciones salientes sin línea elegida"
                >
                  <Star className="w-2.5 h-2.5" />
                  Predeterminada
                </span>
              )}
              {!isConnected && (
                <span
                  className="text-[10px] font-semibold rounded-full px-2 py-0.5"
                  style={{ background: '#F3F4F6', color: '#6B7280' }}
                >
                  Desconectada
                </span>
              )}
              {isConnected && <RegistrationChip account={account} />}
            </div>
          )}

          <p className="text-xs text-ink-muted mt-0.5 flex items-center gap-1.5">
            <Phone className="w-3 h-3 opacity-60" />
            {account.phoneNumber || 'Número no disponible'}
            {account.displayName && <span className="text-ink-subtle">· {account.displayName}</span>}
          </p>

          <div className="flex items-center gap-3 mt-2">
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-[11px] text-ink-subtle hover:text-ink transition-colors"
            >
              {expanded ? 'Ocultar detalles' : 'Ver detalles'}
            </button>
            {isConnected && (
              <button
                onClick={checkStatus}
                disabled={checking}
                className="text-[11px] text-ink-subtle hover:text-ink transition-colors"
              >
                {checking ? 'Verificando...' : 'Verificar estado'}
              </button>
            )}
            {isConnected && !isRegistered && (
              <button
                onClick={() => setShowPin(!showPin)}
                className="text-[11px] font-semibold transition-colors"
                style={{ color: '#D97706' }}
              >
                Registrar en la Cloud API
              </button>
            )}
            {isConnected && !account.isDefault && (
              <button onClick={makeDefault} className="text-[11px] text-ink-subtle hover:text-ink transition-colors">
                Marcar como predeterminada
              </button>
            )}
            {account.isActive && (
              <button onClick={disconnect} className="text-[11px] text-red-500 hover:text-red-600 transition-colors">
                Desconectar
              </button>
            )}
          </div>
        </div>
      </div>

      {showPin && (
        <div className="px-4 pb-4 pt-1" style={{ borderTop: '1px solid var(--border)' }}>
          <div
            className="rounded-xl p-3.5 mt-3"
            style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}
          >
            <p className="text-xs font-semibold text-ink mb-1">Registrar el número en la Cloud API</p>
            <p className="text-[11px] text-ink-muted mb-3">
              Es el paso que habilita a la línea a enviar mensajes. Poné el PIN de 6 dígitos de la
              verificación en dos pasos del número. Si nunca le configuraste uno, el que escribas
              acá queda como su PIN.
            </p>
            <div className="flex items-center gap-2">
              <input
                autoFocus
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                onKeyDown={(e) => { if (e.key === 'Enter') submitPin(); }}
                placeholder="000000"
                inputMode="numeric"
                className="input font-mono text-sm w-32 tracking-widest text-center"
              />
              <button
                onClick={submitPin}
                disabled={registering || pin.length !== 6}
                className="btn-primary flex items-center gap-1.5 text-xs px-3 py-1.5"
              >
                {registering ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
                Registrar
              </button>
              <button
                onClick={() => { setShowPin(false); setPin(''); }}
                className="btn-ghost text-xs px-2.5 py-1.5"
              >
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {expanded && (
        <div className="divide-y divide-border" style={{ borderTop: '1px solid var(--border)' }}>
          <AccountRow label="Número de teléfono"   value={account.phoneNumber} />
          <AccountRow label="Nombre"               value={account.displayName} />
          <AccountRow label="Empresa"              value={account.businessName} />
          <AccountRow label="Phone Number ID"      value={account.phoneNumberId} mono />
          <AccountRow label="WABA ID"              value={account.wabaId} mono />
          <AccountRow label="Estado en Meta"       value={account.platformStatus ?? 'Sin verificar'} />
          <AccountRow label="Webhook Verify Token" value={account.webhookVerifyToken} mono secret />
        </div>
      )}
    </div>
  );
}

// ─── Chip de estado de registro en la Cloud API ───────────────────────────────
// Meta es la autoridad: CONNECTED significa que el número puede enviar. Sin verificar
// no se afirma nada — no queremos mostrar "no registrada" para un número que se
// registró a mano en el panel de Meta.

function RegistrationChip({ account }: { account: WhatsAppAccount }) {
  const status = account.platformStatus;

  const style = !status
    ? { bg: '#F3F4F6', color: '#6B7280', text: 'Sin verificar', title: 'Todavía no consultamos su estado en Meta. Usá "Verificar estado".' }
    : status === 'CONNECTED'
      ? { bg: '#E8FBF0', color: '#128C7E', text: 'Registrada', title: 'Registrada en la Cloud API: puede enviar y recibir.' }
      : { bg: '#FFFBEB', color: '#D97706', text: `Meta: ${status}`, title: `Meta reporta el número como ${status}. Mientras no diga CONNECTED, la línea no puede enviar.` };

  return (
    <span
      className="text-[10px] font-semibold rounded-full px-2 py-0.5"
      style={{ background: style.bg, color: style.color }}
      title={style.title}
    >
      {style.text}
    </span>
  );
}

// ─── URL del webhook (una sola para todas las líneas) ─────────────────────────

function WebhookUrlCard() {
  function webhookUrl() {
    return `${window.location.protocol}//${window.location.hostname.replace(':3000', '')}:3001/api/whatsapp/webhook`;
  }

  return (
    <div className="card p-5 mt-8">
      <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider mb-2">
        URL del Webhook (configurar en Meta)
      </p>
      <p className="text-[11px] text-ink-subtle mb-2.5">
        Es la misma para todas las líneas — Meta indica en cada mensaje por qué número entró.
      </p>
      <div
        className="flex items-center gap-2 rounded-lg px-3 py-2.5 font-mono text-xs text-ink-muted"
        style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}
      >
        <span className="flex-1 truncate">
          {typeof window !== 'undefined' ? webhookUrl() : 'https://tudominio.com/api/whatsapp/webhook'}
        </span>
        <button
          onClick={() => { navigator.clipboard.writeText(webhookUrl()); toast.success('URL copiada'); }}
          className="shrink-0 text-ink-subtle hover:text-ink transition-colors"
        >
          <Copy className="w-3.5 h-3.5" />
        </button>
      </div>
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
        active ? 'bg-white text-ink shadow-sm' : 'text-ink-muted hover:text-ink',
      )}
    >
      {children}
    </button>
  );
}

// ─── Direct Token Form ────────────────────────────────────────────────────────

function DirectTokenForm({ onConnected }: { onConnected: () => void }) {
  const [accessToken,   setAccessToken]   = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId,        setWabaId]        = useState('');
  const [loading,       setLoading]       = useState(false);
  const [errorMsg,      setErrorMsg]      = useState('');
  // La linea queda guardada aunque el registro en la Cloud API pida PIN: en vez de
  // dejarla muda sin avisar, se pide el PIN acá mismo.
  const [pendingId,     setPendingId]     = useState<string | null>(null);
  const [pin,           setPin]           = useState('');
  const [savingPin,     setSavingPin]     = useState(false);

  async function submitPin() {
    if (!pendingId || pin.length !== 6) {
      toast.error('El PIN es de 6 dígitos');
      return;
    }
    setSavingPin(true);
    try {
      await whatsappApi.registerAccount(pendingId, pin);
      toast.success('Número registrado en la Cloud API');
      onConnected();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Error al registrar el número');
    } finally {
      setSavingPin(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!accessToken.trim() || !phoneNumberId.trim()) {
      toast.error('El token y el Phone Number ID son obligatorios');
      return;
    }

    setLoading(true);
    setErrorMsg('');
    try {
      const res = await whatsappApi.connectDirect({
        accessToken: accessToken.trim(),
        phoneNumberId: phoneNumberId.trim(),
        wabaId: wabaId.trim() || undefined,
      });
      setAccessToken('');
      setPhoneNumberId('');
      setWabaId('');

      // La línea ya quedó guardada; solo falta el registro en la Cloud API.
      if (res.needsPin) {
        setPendingId(res.accountId);
        return;
      }
      if (res.registerError) {
        toast.error(`Línea guardada, pero el registro en la Cloud API falló: ${res.registerError}`);
      }
      onConnected();
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || 'Error al conectar';
      setErrorMsg(Array.isArray(msg) ? msg.join(', ') : msg);
    } finally {
      setLoading(false);
    }
  }

  if (pendingId) {
    return (
      <div className="card p-6">
        <div className="flex items-start gap-3 mb-4">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: '#FFFBEB', border: '1px solid #FDE68A' }}
          >
            <KeyRound className="w-5 h-5" style={{ color: '#D97706' }} />
          </div>
          <div>
            <p className="font-semibold text-ink text-sm">Falta registrar el número</p>
            <p className="text-xs text-ink-muted mt-0.5">
              La línea ya quedó guardada, pero todavía no puede enviar mensajes. Poné el PIN de
              6 dígitos de la verificación en dos pasos del número para terminar de registrarla
              en la Cloud API.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
            onKeyDown={(e) => { if (e.key === 'Enter') submitPin(); }}
            placeholder="000000"
            inputMode="numeric"
            className="input font-mono text-sm w-32 tracking-widest text-center"
          />
          <button
            onClick={submitPin}
            disabled={savingPin || pin.length !== 6}
            className="btn-primary flex items-center gap-1.5 text-xs px-3 py-1.5"
          >
            {savingPin ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <KeyRound className="w-3.5 h-3.5" />}
            Registrar
          </button>
          <button onClick={onConnected} className="btn-ghost text-xs px-2.5 py-1.5">
            Después
          </button>
        </div>
        <p className="text-[11px] text-ink-subtle mt-3">
          Si elegís hacerlo después, la línea queda en la lista marcada como pendiente y podés
          registrarla desde ahí.
        </p>
      </div>
    );
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
              Conectar línea
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
