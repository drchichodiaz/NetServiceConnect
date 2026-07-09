'use client';
import { useEffect, useState } from 'react';
import { systemConfigApi } from '@/lib/api';
import { Shield, Eye, EyeOff, Save, RefreshCw, CheckCircle, AlertCircle, Loader2, FolderCog } from 'lucide-react';
import toast from 'react-hot-toast';

interface Config {
  metaAppId: string;
  metaConfigId: string;
  hasMetaAppSecret: boolean;
  metaAppSecretPreview: string | null;
  metaVerifyToken: string;
  metaApiVersion: string;
  mediaStoragePath: string;
  mediaStoragePathDefault: string;
  source: 'db' | 'env';
}

export default function SystemConfigPage() {
  const [config,   setConfig]   = useState<Config | null>(null);
  const [loading,  setLoading]  = useState(true);
  const [saving,   setSaving]   = useState(false);

  const [appId,       setAppId]       = useState('');
  const [configId,    setConfigId]    = useState('');
  const [appSecret,   setAppSecret]   = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [apiVersion,  setApiVersion]  = useState('v19.0');
  const [showSecret,  setShowSecret]  = useState(false);
  const [mediaPath,   setMediaPath]   = useState('');

  async function load() {
    setLoading(true);
    try {
      const data = await systemConfigApi.get();
      setConfig(data);
      setAppId(data.metaAppId || '');
      setConfigId(data.metaConfigId || '');
      setVerifyToken(data.metaVerifyToken || '');
      setApiVersion(data.metaApiVersion || 'v19.0');
      setMediaPath(data.mediaStoragePath || '');
      setAppSecret('');
    } catch { toast.error('Error al cargar configuración'); }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      const payload: Record<string, string> = {};
      if (appId)       payload.metaAppId       = appId;
      if (configId)    payload.metaConfigId    = configId;
      if (appSecret)   payload.metaAppSecret   = appSecret;
      if (verifyToken) payload.metaVerifyToken = verifyToken;
      if (apiVersion)  payload.metaApiVersion  = apiVersion;
      // A diferencia de los campos de arriba, este SI se manda vacio a proposito:
      // vacio = volver a usar la ruta por defecto (ver placeholder abajo).
      payload.mediaStoragePath = mediaPath;

      await systemConfigApi.update(payload);
      toast.success('Configuración guardada');
      await load();
    } catch { toast.error('Error al guardar'); }
    finally { setSaving(false); }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-6 h-6 animate-spin text-ink-muted" />
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-8 px-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-ink" style={{ letterSpacing: '-0.02em' }}>
            Configuración del sistema
          </h1>
          <p className="text-sm text-ink-muted mt-0.5">Credenciales globales de la plataforma</p>
        </div>
        <button onClick={load} className="btn-ghost flex items-center gap-1.5 text-xs">
          <RefreshCw className="w-3.5 h-3.5" />
          Actualizar
        </button>
      </div>

      {/* Status card */}
      <div className="card p-4 mb-5 flex items-center gap-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
          style={{ background: config?.hasMetaAppSecret ? '#E8FBF0' : '#FFF7ED' }}>
          {config?.hasMetaAppSecret
            ? <CheckCircle className="w-5 h-5" style={{ color: '#25D366' }} />
            : <AlertCircle className="w-5 h-5" style={{ color: '#F59E0B' }} />}
        </div>
        <div className="flex-1">
          <p className="text-sm font-semibold text-ink">
            {config?.hasMetaAppSecret ? 'Credenciales Meta configuradas' : 'Credenciales Meta no configuradas'}
          </p>
          <p className="text-xs text-ink-muted">
            {config?.source === 'db'
              ? 'Cargando desde base de datos'
              : 'Usando variables de entorno (.env)'}
          </p>
        </div>
        {config?.hasMetaAppSecret && (
          <span className="font-mono text-xs px-2 py-1 rounded-lg"
            style={{ background: '#E8FBF0', color: '#128C7E' }}>
            {config.metaAppSecretPreview}
          </span>
        )}
      </div>

      {/* Form */}
      <form onSubmit={handleSave} className="card p-5 space-y-4">
        <div className="flex items-center gap-2 pb-2" style={{ borderBottom: '1px solid var(--border)' }}>
          <Shield className="w-4 h-4 text-ink-muted" />
          <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
            Credenciales Meta / WhatsApp
          </p>
        </div>

        {/* Meta App ID */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-ink">Meta App ID</label>
          <input
            type="text"
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
            placeholder={config?.metaAppId || 'Ej: 870754879435592'}
            className="input w-full text-sm font-mono"
          />
        </div>

        {/* Embedded Signup Config ID */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-ink">Embedded Signup Config ID</label>
          <input
            type="text"
            value={configId}
            onChange={(e) => setConfigId(e.target.value)}
            placeholder={config?.metaConfigId || 'Ej: 1344309674334074'}
            className="input w-full text-sm font-mono"
          />
          <p className="text-[11px] text-ink-subtle">
            Facebook Login for Business → Configuraciones → Identificador de configuración
          </p>
        </div>

        {/* Meta App Secret */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-ink">Meta App Secret</label>
          <div className="relative">
            <input
              type={showSecret ? 'text' : 'password'}
              value={appSecret}
              onChange={(e) => setAppSecret(e.target.value)}
              placeholder={config?.hasMetaAppSecret
                ? `Actual: ${config.metaAppSecretPreview} — dejar vacío para no cambiar`
                : 'Pegar el App Secret de Meta'}
              className="input w-full text-sm font-mono pr-10"
            />
            <button
              type="button"
              onClick={() => setShowSecret((v) => !v)}
              className="absolute right-2 top-1/2 -translate-y-1/2 btn-ghost w-7 h-7 p-0"
            >
              {showSecret ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
            </button>
          </div>
          <p className="text-[11px] text-ink-subtle">
            Se encuentra en Meta for Developers → Tu App → Configuración → Básica
          </p>
        </div>

        {/* Verify Token */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-ink">Webhook Verify Token</label>
          <input
            type="text"
            value={verifyToken}
            onChange={(e) => setVerifyToken(e.target.value)}
            placeholder={config?.metaVerifyToken || 'Token de verificación del webhook'}
            className="input w-full text-sm font-mono"
          />
          <p className="text-[11px] text-ink-subtle">
            Debe coincidir con el Verify Token configurado en Meta for Developers → Webhook
          </p>
        </div>

        {/* API Version */}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-ink">Versión de API</label>
          <select
            value={apiVersion}
            onChange={(e) => setApiVersion(e.target.value)}
            className="input w-full text-sm"
          >
            <option value="v21.0">v21.0</option>
            <option value="v20.0">v20.0</option>
            <option value="v19.0">v19.0</option>
            <option value="v18.0">v18.0</option>
          </select>
        </div>

        <div className="flex items-center gap-2 pb-2 pt-2" style={{ borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
          <FolderCog className="w-4 h-4 text-ink-muted" />
          <p className="text-xs font-semibold text-ink-muted uppercase tracking-wider">
            Almacenamiento de multimedia
          </p>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-ink">Ruta en disco del servidor</label>
          <input
            type="text"
            value={mediaPath}
            onChange={(e) => setMediaPath(e.target.value)}
            placeholder={config?.mediaStoragePathDefault || './media'}
            className="input w-full text-sm font-mono"
          />
          <p className="text-[11px] text-ink-subtle">
            Carpeta donde se guardan las fotos/audios/videos/documentos de WhatsApp (separados
            por sub-carpeta de empresa adentro). Dejar vacío usa la ruta por defecto de arriba.
            Si migrás a otro servidor, solo hay que poner acá la ruta nueva — no requiere
            reiniciar ni tocar variables de entorno.
          </p>
        </div>

        <button
          type="submit"
          disabled={saving}
          className="btn-primary w-full flex items-center justify-center gap-2"
        >
          {saving
            ? <><Loader2 className="w-4 h-4 animate-spin" />Guardando...</>
            : <><Save className="w-4 h-4" />Guardar configuración</>}
        </button>
      </form>

      <p className="text-[11px] text-ink-subtle text-center mt-4">
        Solo administradores pueden modificar esta configuración. Los cambios toman efecto inmediatamente sin reiniciar el servidor.
      </p>
    </div>
  );
}
