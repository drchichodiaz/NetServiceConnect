'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { Phone, PhoneOff, Mic, MicOff, MessageSquare } from 'lucide-react';
import { useAuthStore } from '@/store/auth.store';
import { useInboxStore } from '@/store/inbox.store';
import { callsApi, whatsappApi } from '@/lib/api';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

/** Meta da entre 30 y 60 segundos para atender; pasado eso la llamada ya no existe. */
const RING_TIMEOUT_MS = 60_000;
/** Cuanto se espera a que el navegador junte sus candidatos ICE antes de responder. */
const ICE_GATHER_TIMEOUT_MS = 3_000;
const FINAL = ['COMPLETED', 'MISSED', 'REJECTED', 'FAILED'];

interface RingingCall {
  id: string;
  channelAccountId: string;
  lineName: string;
  conversationId: string;
  contactName: string;
  contactPhone: string | null;
  sdpOffer: string;
  createdAt: string;
}

interface ActiveCall {
  call: RingingCall;
  pc: RTCPeerConnection;
  mic: MediaStream;
  startedAt: number | null; // null mientras se conecta
}

/**
 * Llamadas de WhatsApp: el aviso de que suena y la barra de la llamada en curso.
 *
 * Vive en el layout raiz y no en el de la bandeja porque cada seccion del panel tiene
 * su propio layout: montado ahi, pasar de la bandeja a la agenda en medio de una
 * llamada la cortaba. Abre su propia conexion de eventos por el mismo motivo.
 *
 * Solo suena para las lineas que la persona puede ver (las mismas que le ofrece el
 * filtro de la bandeja). Atender arma la conexion WebRTC en este navegador y le manda
 * la respuesta SDP al backend, que se la pasa a Meta.
 */
export default function CallManager() {
  const token = useAuthStore((s) => s.token);
  const router = useRouter();
  const [ringing, setRinging] = useState<RingingCall[]>([]);
  const [active, setActive] = useState<ActiveCall | null>(null);
  const [muted, setMuted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const linesRef = useRef<Set<string> | null>(null);
  const activeRef = useRef<ActiveCall | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ringtone = useRingtone();
  const drag = useDraggable();

  activeRef.current = active;

  const cleanup = useCallback(() => {
    const current = activeRef.current;
    if (current) {
      current.pc.close();
      current.mic.getTracks().forEach((t) => t.stop());
    }
    if (audioRef.current) audioRef.current.srcObject = null;
    activeRef.current = null;
    setActive(null);
    setMuted(false);
  }, []);

  // Lineas que puede ver: se piden de nuevo al entrar con otro usuario.
  useEffect(() => {
    linesRef.current = null;
    if (!token) return;
    whatsappApi
      .listActiveAccounts()
      .then((lines) => { linesRef.current = new Set(lines.map((l) => l.id)); })
      .catch(() => { /* sin lista no se filtra: mejor que suene de mas a que no suene */ });
  }, [token]);

  useEffect(() => {
    if (!token) return;
    const es = new EventSource(`${API}/events?token=${token}`);
    es.onmessage = (event) => {
      let data: any;
      try { data = JSON.parse(event.data); } catch { return; }

      if (data.type === 'call_ringing') {
        const call = data.payload as RingingCall;
        if (linesRef.current && !linesRef.current.has(call.channelAccountId)) return;
        setRinging((list) => (list.some((c) => c.id === call.id) ? list : [...list, call]));
        notify(call);
      }

      if (data.type === 'call_updated') {
        const { id, status } = data.payload as { id: string; status: string };
        // Atendida por otra persona o cortada: deja de sonar aca.
        setRinging((list) => list.filter((c) => c.id !== id));
        if (activeRef.current?.call.id === id && FINAL.includes(status)) {
          cleanup();
          if (status === 'COMPLETED') toast('Llamada terminada');
          else if (status === 'FAILED') toast.error('La llamada se cortó');
        }
      }
    };
    return () => es.close();
  }, [token, cleanup]);

  // Al salir de la sesion se corta lo que hubiera.
  useEffect(() => {
    if (token) return;
    setRinging([]);
    if (activeRef.current) cleanup();
  }, [token, cleanup]);

  // Una llamada que Meta ya dio por perdida puede no avisar a tiempo: se descarta sola.
  useEffect(() => {
    if (ringing.length === 0) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setRinging((list) => list.filter((c) => now - new Date(c.createdAt).getTime() < RING_TIMEOUT_MS));
    }, 2_000);
    return () => clearInterval(timer);
  }, [ringing.length]);

  const shouldRing = ringing.length > 0 && !active;
  useEffect(() => {
    if (shouldRing) ringtone.start();
    else ringtone.stop();
  }, [shouldRing, ringtone]);

  useEffect(() => {
    if (!active?.startedAt) { setElapsed(0); return; }
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - active.startedAt!) / 1000)), 1_000);
    return () => clearInterval(timer);
  }, [active?.startedAt]);

  // Recargar o cerrar la pestaña corta el audio: se avisa antes.
  useEffect(() => {
    if (!active) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active]);

  const answer = async (call: RingingCall) => {
    if (activeRef.current) return;
    let mic: MediaStream;
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    } catch {
      // No se rechaza: otra persona todavia puede atender.
      toast.error('El navegador no dejó usar el micrófono. Permitilo en el candado de la barra de direcciones.');
      return;
    }

    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    const current: ActiveCall = { call, pc, mic, startedAt: null };
    activeRef.current = current;
    setActive(current);
    setRinging((list) => list.filter((c) => c.id !== call.id));

    mic.getTracks().forEach((t) => pc.addTrack(t, mic));
    pc.ontrack = (e) => {
      if (!audioRef.current) return;
      audioRef.current.srcObject = e.streams[0] ?? new MediaStream([e.track]);
      audioRef.current.play().catch(() => {});
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' && activeRef.current?.pc === pc) {
        toast.error('Se perdió el audio de la llamada');
        callsApi.hangup(call.id).catch(() => {});
        cleanup();
      }
    };

    try {
      await pc.setRemoteDescription({ type: 'offer', sdp: call.sdpOffer });
      await pc.setLocalDescription(await pc.createAnswer());
      await waitForIce(pc);
      await callsApi.accept(call.id, pc.localDescription!.sdp);
      const started = { ...current, startedAt: Date.now() };
      activeRef.current = started;
      setActive(started);
    } catch (err: any) {
      cleanup();
      toast.error(err?.response?.data?.message || 'No se pudo atender la llamada');
    }
  };

  const reject = (call: RingingCall) => {
    setRinging((list) => list.filter((c) => c.id !== call.id));
    callsApi.reject(call.id).catch(() => toast.error('No se pudo rechazar la llamada'));
  };

  const hangup = () => {
    const current = activeRef.current;
    if (!current) return;
    callsApi.hangup(current.call.id).catch(() => {});
    cleanup();
  };

  const toggleMute = () => {
    const current = activeRef.current;
    if (!current) return;
    const next = !muted;
    current.mic.getAudioTracks().forEach((t) => { t.enabled = !next; });
    setMuted(next);
  };

  const openChat = (conversationId: string) => {
    router.push('/inbox');
    useInboxStore.getState().selectConversation(conversationId);
  };

  const incoming = !active ? ringing[0] : undefined;

  return (
    <>
      <audio ref={audioRef} autoPlay className="hidden" />

      {incoming && (
        <div {...drag.props} className="fixed z-[60] w-80 rounded-2xl bg-sidebar text-white shadow-2xl p-4 cursor-grab active:cursor-grabbing select-none touch-none">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-green-500/20 flex items-center justify-center animate-pulse">
              <Phone size={18} className="text-green-400" />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wide text-white/50">Llamada de WhatsApp · {incoming.lineName}</p>
              <p className="font-semibold truncate">{incoming.contactName}</p>
              {incoming.contactPhone && incoming.contactName !== `+${incoming.contactPhone}` && (
                <p className="text-xs text-white/60">+{incoming.contactPhone}</p>
              )}
            </div>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => reject(incoming)}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-red-500 hover:bg-red-600 py-2 text-sm font-medium"
            >
              <PhoneOff size={15} /> Rechazar
            </button>
            <button
              onClick={() => answer(incoming)}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-green-500 hover:bg-green-600 py-2 text-sm font-medium"
            >
              <Phone size={15} /> Atender
            </button>
          </div>
          {ringing.length > 1 && (
            <p className="text-[11px] text-white/50 mt-2 text-center">
              {ringing.length - 1} llamada{ringing.length > 2 ? 's' : ''} más esperando
            </p>
          )}
        </div>
      )}

      {active && (
        <div {...drag.props} className="fixed z-[60] w-80 rounded-2xl bg-sidebar text-white shadow-2xl p-4 cursor-grab active:cursor-grabbing select-none touch-none">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wide text-white/50">
                {active.startedAt ? 'En llamada' : 'Conectando…'} · {active.call.lineName}
              </p>
              <p className="font-semibold truncate">{active.call.contactName}</p>
            </div>
            <span className="font-mono text-sm text-green-400">{active.startedAt ? formatElapsed(elapsed) : ''}</span>
          </div>
          <div className="flex gap-2 mt-4">
            <button
              onClick={toggleMute}
              title={muted ? 'Activar micrófono' : 'Silenciar micrófono'}
              className="flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 w-10 py-2"
            >
              {muted ? <MicOff size={15} className="text-red-400" /> : <Mic size={15} />}
            </button>
            <button
              onClick={() => openChat(active.call.conversationId)}
              title="Abrir la conversación"
              className="flex items-center justify-center rounded-xl bg-white/10 hover:bg-white/20 w-10 py-2"
            >
              <MessageSquare size={15} />
            </button>
            <button
              onClick={hangup}
              className="flex-1 flex items-center justify-center gap-1.5 rounded-xl bg-red-500 hover:bg-red-600 py-2 text-sm font-medium"
            >
              <PhoneOff size={15} /> Colgar
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Meta no acepta candidatos sueltos despues de la respuesta: el SDP tiene que ir con
 * todos adentro. Si alguno tarda (un STUN que no contesta) se manda lo que haya.
 */
function waitForIce(pc: RTCPeerConnection): Promise<void> {
  if (pc.iceGatheringState === 'complete') return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => { pc.removeEventListener('icegatheringstatechange', check); clearTimeout(timer); resolve(); };
    const check = () => { if (pc.iceGatheringState === 'complete') done(); };
    const timer = setTimeout(done, ICE_GATHER_TIMEOUT_MS);
    pc.addEventListener('icegatheringstatechange', check);
  });
}

function notify(call: RingingCall) {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission !== 'granted' || document.visibilityState === 'visible') return;
  const n = new Notification(`📞 ${call.contactName}`, { body: `Llamada de WhatsApp · ${call.lineName}`, tag: `call-${call.id}` });
  n.onclick = () => window.focus();
}

function formatElapsed(sec: number) {
  const m = Math.floor(sec / 60);
  return `${m}:${String(sec % 60).padStart(2, '0')}`;
}

const POSITION_KEY = 'call-panel-position';
const EDGE = 20; // la esquina de siempre: bottom-5 right-5
const MARGIN = 8; // lo minimo que queda visible contra el borde de la ventana

/**
 * La ventanita de la llamada se puede arrastrar a cualquier lado: fija abajo a la
 * derecha tapaba lo que hubiera en esa esquina durante toda la llamada.
 *
 * La posicion se guarda como distancia al borde inferior derecho, asi al achicar la
 * ventana del navegador el panel acompaña a la esquina en vez de quedar afuera. Se
 * recuerda en este navegador para la proxima llamada. Arrastra desde cualquier parte
 * menos los botones, que tienen que seguir respondiendo al primer toque.
 */
function useDraggable() {
  const [pos, setPos] = useState<{ right: number; bottom: number }>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(POSITION_KEY) || 'null');
      if (typeof saved?.right === 'number' && typeof saved?.bottom === 'number') return saved;
    } catch { /* sin almacenamiento: la esquina de siempre */ }
    return { right: EDGE, bottom: EDGE };
  });
  const el = useRef<HTMLDivElement | null>(null);
  const start = useRef<{ x: number; y: number; right: number; bottom: number } | null>(null);

  const clamp = useCallback((p: { right: number; bottom: number }) => {
    const w = el.current?.offsetWidth ?? 320;
    const h = el.current?.offsetHeight ?? 140;
    return {
      right: Math.min(Math.max(p.right, MARGIN), Math.max(MARGIN, window.innerWidth - w - MARGIN)),
      bottom: Math.min(Math.max(p.bottom, MARGIN), Math.max(MARGIN, window.innerHeight - h - MARGIN)),
    };
  }, []);

  // Una posicion guardada en una pantalla mas grande puede caer fuera de esta.
  useEffect(() => {
    const fit = () => setPos((p) => clamp(p));
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [clamp]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    start.current = { x: e.clientX, y: e.clientY, ...pos };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const s = start.current;
    if (!s) return;
    setPos(clamp({ right: s.right - (e.clientX - s.x), bottom: s.bottom - (e.clientY - s.y) }));
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    start.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
    setPos((p) => {
      try { localStorage.setItem(POSITION_KEY, JSON.stringify(p)); } catch { /* no se recuerda, nada mas */ }
      return p;
    });
  };

  const ref = useCallback((node: HTMLDivElement | null) => {
    el.current = node;
    // Al aparecer se mide de verdad: el alto cambia entre "suena" y "en llamada".
    if (node) setPos((p) => clamp(p));
  }, [clamp]);

  return {
    props: {
      ref,
      style: { right: pos.right, bottom: pos.bottom },
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
  };
}

/**
 * Timbre sintetizado: dos tonos cortos cada dos segundos, sin archivo de audio. El
 * navegador solo deja sonar despues de que la persona interactuo con la pagina, cosa
 * que en el panel ya paso al iniciar sesion.
 */
function useRingtone() {
  const ref = useRef<{ ctx: AudioContext | null; timer: ReturnType<typeof setInterval> | null }>({ ctx: null, timer: null });

  const beep = useCallback(() => {
    const ctx = ref.current.ctx;
    if (!ctx) return;
    for (const offset of [0, 0.35]) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + offset + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + offset);
      osc.stop(ctx.currentTime + offset + 0.3);
    }
  }, []);

  const start = useCallback(() => {
    if (ref.current.timer) return;
    try {
      ref.current.ctx ??= new AudioContext();
      ref.current.ctx.resume().catch(() => {});
    } catch {
      return;
    }
    beep();
    ref.current.timer = setInterval(beep, 2_000);
  }, [beep]);

  const stop = useCallback(() => {
    if (ref.current.timer) clearInterval(ref.current.timer);
    ref.current.timer = null;
  }, []);

  useEffect(() => stop, [stop]);

  const api = useRef({ start, stop });
  return api.current;
}
