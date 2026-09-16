'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { whatsappApi, systemConfigApi } from '@/lib/api';
import { MessageSquare, Loader2, AlertCircle, ArrowRight, KeyRound } from 'lucide-react';
import toast from 'react-hot-toast';
import { BRAND } from '@/lib/brand';

interface Props {
  /** El tenant puede tener varias lineas — la pagina recarga la lista, no recibe una cuenta. */
  onConnected: () => void;
}

type Step = 'idle' | 'waiting_fb' | 'saving' | 'needs_pin' | 'error';

interface SessionInfo {
  wabaId?: string;
  phoneNumberId?: string;
}

declare global {
  interface Window {
    FB?: {
      init: (options: Record<string, unknown>) => void;
      login: (
        callback: (response: { authResponse?: { code?: string } | null }) => void,
        options: Record<string, unknown>,
      ) => void;
    };
    fbAsyncInit?: () => void;
  }
}

export default function EmbeddedSignup({ onConnected }: Props) {
  const [step, setStep]         = useState<Step>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [pin, setPin]           = useState('');
  const [isSavingPin, setIsSavingPin] = useState(false);
  const [metaAppId,    setMetaAppId]    = useState('');
  const [metaConfigId, setMetaConfigId] = useState('');
  const [metaApiVersion, setMetaApiVersion] = useState('v21.0');
  const [configLoaded, setConfigLoaded] = useState(false);
  const [sdkReady,     setSdkReady]     = useState(false);
  // Distingue "la plataforma no tiene App ID" de "no pude leer la config": antes las
  // dos terminaban en el mismo cartel, y el 403 del endpoint de superadmin se leia
  // como si faltara configurar algo que en realidad ya estaba puesto.
  const [configError, setConfigError] = useState(false);

  useEffect(() => {
    systemConfigApi.getMetaApp()
      .then((cfg) => {
        setMetaAppId(cfg.metaAppId || '');
        setMetaConfigId(cfg.metaConfigId || cfg.metaAppId || '');
        if (cfg.metaApiVersion) setMetaApiVersion(cfg.metaApiVersion);
      })
      .catch(() => setConfigError(true))
      .finally(() => setConfigLoaded(true));
  }, []);

  // ─── SDK de Facebook ──────────────────────────────────────────────────────
  // Embedded Signup solo funciona a traves del SDK: Meta entrega el codigo
  // canjeable por el callback de FB.login, y no por un redirect. Abrir a mano la
  // URL de onboarding deja el alta hecha del lado de Meta y sin terminar del
  // nuestro — la ventana queda abierta para siempre esperando entregarle el
  // codigo a un callback que no existe, y aca no llega ni una peticion.
  //
  // El appId lo pone la plataforma, asi que el script se carga recien cuando la
  // config llego, no al montar.
  useEffect(() => {
    if (!metaAppId) return;

    const init = () => {
      window.FB?.init({ appId: metaAppId, version: metaApiVersion, xfbml: false, cookie: false });
      setSdkReady(true);
    };

    // Otra pantalla pudo haberlo cargado ya: el script se inyecta una sola vez.
    if (window.FB) { init(); return; }

    window.fbAsyncInit = init;

    if (!document.getElementById('facebook-jssdk')) {
      const script = document.createElement('script');
      script.id          = 'facebook-jssdk';
      script.src         = 'https://connect.facebook.net/en_US/sdk.js';
      script.async       = true;
      script.defer       = true;
      script.crossOrigin = 'anonymous';
      document.body.appendChild(script);
    }
  }, [metaAppId, metaApiVersion]);

  const sessionInfoRef = useRef<SessionInfo>({});

  // ─── postMessage handler ─────────────────────────────────────────────────
  // Receives two kinds of messages:
  //  1. From facebook.com  → WA_EMBEDDED_SIGNUP (session info: waba_id, phone_number_id)
  //  2. From same origin   → WA_OAUTH_CODE (authorization code from our callback page)

  const handleMessage = useCallback((event: MessageEvent) => {
    // Session info from Meta popup
    if (event.origin.includes('facebook.com') || event.origin.includes('business.facebook.com')) {
      try {
        const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (data?.type === 'WA_EMBEDDED_SIGNUP') {
          if (data.event === 'FINISH') {
            const { phone_number_id, waba_id } = data.data ?? {};
            if (waba_id)          sessionInfoRef.current.wabaId         = waba_id;
            if (phone_number_id)  sessionInfoRef.current.phoneNumberId  = phone_number_id;
          } else if (data.event === 'CANCEL') {
            setStep('idle');
            toast('Proceso cancelado', { icon: '⚠️' });
          } else if (data.event === 'ERROR') {
            setStep('error');
            setErrorMsg(data.data?.error_message || 'Error en el proceso de Meta');
          }
        }
      } catch { /* non-JSON, ignore */ }
      return;
    }

    // OAuth code relayed from our /whatsapp/oauth/callback page. Con el SDK el codigo
    // llega por el callback de FB.login, pero se deja esta via porque el propio SDK cae
    // a un redirect cuando el navegador bloquea las ventanas emergentes.
    if (event.origin === window.location.origin && event.data?.type === 'WA_OAUTH_CODE') {
      const { code, error } = event.data;
      if (code) {
        processSignup(code);
      } else {
        setStep('idle');
        toast(error ? `Error: ${error}` : 'Proceso cancelado', { icon: '⚠️' });
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);

  // ─── Launch ───────────────────────────────────────────────────────────────

  function launchEmbeddedSignup() {
    if (!metaAppId || !metaConfigId) {
      toast.error('Configura el Meta App ID en Configuración del sistema');
      return;
    }
    if (!window.FB) {
      setStep('error');
      setErrorMsg('El SDK de Facebook no cargó. Recarga la página e intenta de nuevo.');
      return;
    }

    sessionInfoRef.current = {};
    setStep('waiting_fb');

    // Los IDs y el codigo son dos canales distintos y pueden llegar en cualquier orden,
    // o uno sin el otro: los IDs por postMessage desde facebook.com, el codigo por este
    // callback. Tratarlos como uno solo es el origen de casi todos los bugs de este
    // flujo, asi que el postMessage se sigue escuchando aparte (handleMessage) y aca
    // solo se lee lo que haya quedado en el ref.
    window.FB.login(
      (response) => {
        const code = response?.authResponse?.code;
        if (code) {
          // El codigo vive 30 segundos: se canjea de una, sin pasos intermedios.
          processSignup(code);
          return;
        }
        // Sin codigo: o lo cancelo, o cerro la ventana. Si igual llego el FINISH,
        // el numero quedo creado en Meta y solo falto autorizar — que es una
        // instruccion distinta a no haber llegado nunca hasta ahi.
        const { wabaId, phoneNumberId } = sessionInfoRef.current;
        setStep('error');
        setErrorMsg(
          wabaId || phoneNumberId
            ? 'Meta confirmó el número, pero faltó el último paso: autorizar el acceso. ' +
              'Vuelve a conectar, elige el mismo número y completa el proceso hasta el final.'
            : 'No se obtuvo la autorización de Meta. El proceso se canceló o se cerró ' +
              'la ventana antes de terminar.',
        );
      },
      {
        config_id:                      metaConfigId,
        response_type:                  'code',
        override_default_response_type: true,
        extras: {
          version:            'v4',
          sessionInfoVersion: '3',
          featureType:        'whatsapp_embedded_signup',
        },
      },
    );
  }

  // ─── Process OAuth code ───────────────────────────────────────────────────

  async function processSignup(code: string) {
    setStep('saving');

    // Brief wait so any FINISH postMessage arrives before we read sessionInfoRef
    await new Promise((r) => setTimeout(r, 400));

    const { wabaId, phoneNumberId } = sessionInfoRef.current;

    try {
      const result = await whatsappApi.embeddedSignup({ code, wabaId, phoneNumberId });

      if (result.needsPin) {
        setStep('needs_pin');
        toast('Tu número requiere un PIN de verificación de dos pasos', { icon: '🔐' });
        return;
      }

      setStep('idle');
      onConnected();
    } catch (err: any) {
      setStep('error');
      const msg = err?.response?.data?.message || err?.message || 'Error al conectar con Meta';
      setErrorMsg(Array.isArray(msg) ? msg.join(', ') : msg);
    }
  }

  // ─── PIN 2FA ──────────────────────────────────────────────────────────────

  async function handlePinSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pin.length !== 6) { toast.error('El PIN debe tener 6 dígitos'); return; }

    setIsSavingPin(true);
    try {
      await whatsappApi.registerPhoneWithPin(pin);
      toast.success('Número registrado correctamente');
      setStep('idle');
      onConnected();
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'PIN incorrecto');
    } finally {
      setIsSavingPin(false);
    }
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-6">
      <div className="text-center mb-8">
        <div className="w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <MessageSquare className="w-8 h-8 text-green-600" />
        </div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">Conectar WhatsApp Business</h2>
        <p className="text-gray-500 text-sm max-w-sm mx-auto">
          Conecta tu cuenta de WhatsApp Business en pocos pasos usando el asistente guiado de Meta.
        </p>
      </div>

      {/* Steps */}
      <div className="flex gap-4 mb-8">
        {[
          { n: 1, label: 'Conectar Facebook Business' },
          { n: 2, label: 'Seleccionar WABA y número' },
          { n: 3, label: 'Activación automática' },
        ].map(({ n, label }) => (
          <div key={n} className="flex-1 text-center">
            <div className="w-8 h-8 rounded-full bg-gray-100 text-gray-500 flex items-center justify-center text-sm font-semibold mx-auto mb-2">
              {n}
            </div>
            <p className="text-xs text-gray-500">{label}</p>
          </div>
        ))}
      </div>

      {/* Error */}
      {step === 'error' && (
        <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4 mb-5">
          <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-700">Error en la conexión</p>
            <p className="text-sm text-red-600 mt-0.5">{errorMsg}</p>
          </div>
        </div>
      )}

      {/* PIN 2FA */}
      {step === 'needs_pin' && (
        <div className="mb-5">
          <div className="flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4">
            <KeyRound className="w-5 h-5 text-blue-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-blue-700">PIN de verificación en dos pasos</p>
              <p className="text-sm text-blue-600 mt-0.5">
                Tu número de WhatsApp tiene la verificación en dos pasos activada. Ingresa el PIN de 6 dígitos para completar la activación.
              </p>
            </div>
          </div>
          <form onSubmit={handlePinSubmit} className="flex gap-2">
            <input
              type="text"
              maxLength={6}
              pattern="[0-9]{6}"
              placeholder="123456"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
              className="flex-1 px-4 py-2.5 border border-gray-300 rounded-xl text-center text-lg font-mono tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <button
              type="submit"
              disabled={pin.length !== 6 || isSavingPin}
              className="px-5 py-2.5 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white font-medium rounded-xl flex items-center gap-2"
            >
              {isSavingPin && <Loader2 className="w-4 h-4 animate-spin" />}
              Activar
            </button>
          </form>
        </div>
      )}

      {/* Loading */}
      {(step === 'waiting_fb' || step === 'saving') && (
        <div className="flex flex-col items-center justify-center gap-2 py-8 text-gray-500">
          <div className="flex items-center gap-3">
            <Loader2 className="w-5 h-5 animate-spin text-green-500" />
            <span className="text-sm">
              {step === 'waiting_fb'
                ? 'Esperando autorización en Meta...'
                : 'Guardando configuración de WhatsApp...'}
            </span>
          </div>
          {/* El aviso va antes del error y no despues: el momento de decirlo es mientras
              la ventana sigue abierta, que es cuando todavia se puede evitar. */}
          {step === 'waiting_fb' && (
            <p className="text-xs text-gray-400 text-center max-w-xs">
              No cierres la ventana de Meta aunque diga que el número ya se agregó:
              se cierra sola al terminar.
            </p>
          )}
        </div>
      )}

      {/* Main button */}
      {(step === 'idle' || step === 'error') && (
        <button
          onClick={launchEmbeddedSignup}
          disabled={!configLoaded || !metaAppId || !sdkReady}
          className="w-full flex items-center justify-center gap-3 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white font-semibold py-3 px-6 rounded-xl transition-colors"
        >
          {/* El boton espera al SDK: sin el, FB.login no existe y el alta no puede
              siquiera empezar. */}
          {!configLoaded || (!!metaAppId && !sdkReady)
            ? <><Loader2 className="w-4 h-4 animate-spin" />Cargando...</>
            : <><MessageSquare className="w-5 h-5" />{step === 'error' ? 'Reintentar conexión' : 'Conectar con WhatsApp Business'}<ArrowRight className="w-4 h-4" /></>
          }
        </button>
      )}

      {configLoaded && configError && (
        <p className="text-xs text-red-500 text-center mt-3">
          ⚠️ No se pudo leer la configuración de la plataforma. Reintentá en unos segundos
          o avisale al administrador.
        </p>
      )}

      {configLoaded && !configError && !metaAppId && (
        <p className="text-xs text-red-500 text-center mt-3">
          ⚠️ La plataforma todavía no tiene configurado el Meta App ID, así que este método
          no está disponible. Pedíselo al administrador de {BRAND.name}, o conectá el número
          con la pestaña <strong>Token directo</strong>.
        </p>
      )}

      <p className="text-xs text-gray-400 text-center mt-4">
        Al conectar, autorizas a {BRAND.name} a enviar y recibir mensajes en nombre de tu cuenta de WhatsApp Business.
      </p>
    </div>
  );
}
