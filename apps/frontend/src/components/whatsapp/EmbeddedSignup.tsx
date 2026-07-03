'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { whatsappApi } from '@/lib/api';
import { WhatsAppAccount } from '@/types';
import { MessageSquare, Loader2, AlertCircle, ArrowRight, KeyRound } from 'lucide-react';
import toast from 'react-hot-toast';

declare global {
  interface Window {
    FB: any;
    fbAsyncInit: () => void;
  }
}

interface Props {
  onConnected: (account: WhatsAppAccount) => void;
}

type Step = 'idle' | 'waiting_fb' | 'saving' | 'needs_pin' | 'error';

// session info capturado del postMessage de Meta (sessionInfoVersion 3)
interface SessionInfo {
  wabaId?: string;
  phoneNumberId?: string;
}

export default function EmbeddedSignup({ onConnected }: Props) {
  const [step, setStep] = useState<Step>('idle');
  const [errorMsg, setErrorMsg] = useState('');
  const [fbLoaded, setFbLoaded] = useState(false);
  const [pin, setPin] = useState('');
  const [isSavingPin, setIsSavingPin] = useState(false);

  const META_APP_ID   = process.env.NEXT_PUBLIC_META_APP_ID || '';
  // Configuration ID del Embedded Signup (distinto del App ID).
  // Si no lo tienes aún, usa el App ID como fallback (funciona en apps recientes).
  const META_CONFIG_ID = process.env.NEXT_PUBLIC_META_CONFIG_ID || META_APP_ID;

  // Ref para guardar session info que llega del postMessage mientras FB.login está abierto
  const sessionInfoRef = useRef<SessionInfo>({});

  // ─── Cargar Facebook SDK ─────────────────────────────────────────────────

  useEffect(() => {
    if (window.FB) {
      setFbLoaded(true);
      return;
    }

    window.fbAsyncInit = () => {
      window.FB.init({
        appId: META_APP_ID,
        cookie: true,
        xfbml: true,
        version: 'v19.0',
      });
      setFbLoaded(true);
    };

    if (!document.getElementById('facebook-sdk')) {
      const script = document.createElement('script');
      script.id = 'facebook-sdk';
      script.src = 'https://connect.facebook.net/es_LA/sdk.js';
      script.async = true;
      script.defer = true;
      document.body.appendChild(script);
    }
  }, [META_APP_ID]);

  // ─── Capturar session info del postMessage de Meta ───────────────────────
  // Meta envía wabaId y phoneNumberId en un mensaje desde el popup antes de cerrarlo.
  // Lo guardamos en un ref para usarlo justo después del FB.login callback.

  const handleMessage = useCallback((event: MessageEvent) => {
    if (!event.origin.includes('facebook.com')) return;

    try {
      const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;

      if (data?.type === 'WA_EMBEDDED_SIGNUP') {
        if (data.event === 'FINISH') {
          const { phone_number_id, waba_id } = data.data ?? {};
          if (waba_id) sessionInfoRef.current.wabaId = waba_id;
          if (phone_number_id) sessionInfoRef.current.phoneNumberId = phone_number_id;
        } else if (data.event === 'CANCEL') {
          setStep('idle');
          toast('Proceso cancelado', { icon: '⚠️' });
        } else if (data.event === 'ERROR') {
          setStep('error');
          setErrorMsg(data.data?.error_message || 'Error en el proceso de Meta');
        }
      }
    } catch {
      // Mensaje no JSON — ignorar
    }
  }, []);

  useEffect(() => {
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [handleMessage]);

  // ─── Lanzar Embedded Signup ───────────────────────────────────────────────

  function launchEmbeddedSignup() {
    if (!fbLoaded || !window.FB) {
      toast.error('El SDK de Facebook aún no está listo. Espera un momento.');
      return;
    }

    // Limpiar session info anterior
    sessionInfoRef.current = {};
    setStep('waiting_fb');

    window.FB.login(
      (response: any) => {
        if (!response.authResponse) {
          setStep('idle');
          toast('Inicio de sesión cancelado', { icon: '⚠️' });
          return;
        }

        // El code viene en authResponse cuando response_type: 'code'
        const code = response.authResponse.code;
        if (!code) {
          setStep('error');
          setErrorMsg('No se recibió el código de autorización de Facebook');
          return;
        }

        processSignup(code);
      },
      {
        config_id: META_CONFIG_ID,
        response_type: 'code',
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: '',
          sessionInfoVersion: '3',
        },
      },
    );
  }

  async function processSignup(code: string) {
    setStep('saving');

    // Pequeña espera para asegurar que el postMessage llegó antes que el callback
    await new Promise((r) => setTimeout(r, 500));

    const { wabaId, phoneNumberId } = sessionInfoRef.current;

    try {
      const result = await whatsappApi.embeddedSignup({ code, wabaId, phoneNumberId });

      if (result.needsPin) {
        setStep('needs_pin');
        toast('Tu número requiere un PIN de verificación de dos pasos', { icon: '🔐' });
        return;
      }

      setStep('idle');
      onConnected(result as WhatsAppAccount);
    } catch (err: any) {
      setStep('error');
      const msg = err?.response?.data?.message || err?.message || 'Error al conectar con Meta';
      setErrorMsg(Array.isArray(msg) ? msg.join(', ') : msg);
    }
  }

  async function handlePinSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (pin.length !== 6) {
      toast.error('El PIN debe tener 6 dígitos');
      return;
    }

    setIsSavingPin(true);
    try {
      await whatsappApi.registerPhoneWithPin(pin);
      toast.success('Número registrado correctamente');
      setStep('idle');
      // Recargar la cuenta desde el servidor
      const account = await import('@/lib/api').then((m) => m.whatsappApi.getAccount());
      onConnected(account as WhatsAppAccount);
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

      {/* Pasos */}
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

      {/* Estados de carga */}
      {(step === 'waiting_fb' || step === 'saving') && (
        <div className="flex items-center justify-center gap-3 py-8 text-gray-500">
          <Loader2 className="w-5 h-5 animate-spin text-green-500" />
          <span className="text-sm">
            {step === 'waiting_fb'
              ? 'Esperando autorización en Facebook...'
              : 'Guardando configuración de WhatsApp...'}
          </span>
        </div>
      )}

      {/* Botón principal */}
      {(step === 'idle' || step === 'error') && (
        <button
          onClick={launchEmbeddedSignup}
          disabled={!fbLoaded}
          className="w-full flex items-center justify-center gap-3 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white font-semibold py-3 px-6 rounded-xl transition-colors"
        >
          {!fbLoaded ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Cargando SDK...
            </>
          ) : (
            <>
              <MessageSquare className="w-5 h-5" />
              {step === 'error' ? 'Reintentar conexión' : 'Conectar con WhatsApp Business'}
              <ArrowRight className="w-4 h-4" />
            </>
          )}
        </button>
      )}

      {!META_APP_ID && (
        <p className="text-xs text-red-500 text-center mt-3">
          ⚠️ Configura NEXT_PUBLIC_META_APP_ID en tu archivo .env.local
        </p>
      )}

      <p className="text-xs text-gray-400 text-center mt-4">
        Al conectar, autorizas a NetService Connect a enviar y recibir mensajes en nombre de tu cuenta de WhatsApp Business.
      </p>
    </div>
  );
}
