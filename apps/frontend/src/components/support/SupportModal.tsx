'use client';
import { useState } from 'react';
import { supportApi, getRecentErrors } from '@/lib/api';
import ModalPortal from '@/components/ui/ModalPortal';
import { useAuthStore } from '@/store/auth.store';
import { X, LifeBuoy, Loader2, CheckCircle2, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';

/**
 * Reportar un problema. Pide dos cosas y adjunta el resto solo.
 *
 * El formulario es corto a propósito: cuanto más pide, menos reportes llegan, y los
 * datos que de verdad hacen falta para diagnosticar (pantalla, navegador, versión, los
 * últimos errores de API) no los sabe la persona — los sabe el panel.
 */
export default function SupportModal({ onClose }: { onClose: () => void }) {
  const user = useAuthStore((s) => s.user);

  const [activity, setActivity] = useState('');
  const [problem, setProblem] = useState('');
  const [blocking, setBlocking] = useState(false);
  const [sending, setSending] = useState(false);
  const [showDetail, setShowDetail] = useState(false);
  const [sent, setSent] = useState<{ ticket: string; emailSent: boolean } | null>(null);

  const errors = getRecentErrors();
  const canSend = activity.trim().length >= 3 && problem.trim().length >= 3 && !sending;

  async function handleSend() {
    if (!canSend) return;
    setSending(true);
    try {
      setSent(await supportApi.send({ activity: activity.trim(), problem: problem.trim(), blocking }));
    } catch (err: any) {
      // El 429 es el límite de 5 por hora y merece decirse con todas las letras: si no,
      // parece que el reporte se perdió y la persona lo reintenta en bucle.
      toast.error(
        err?.response?.status === 429
          ? 'Ya mandaste varios reportes en la última hora. Escribinos directo si es urgente.'
          : err?.response?.data?.message || 'No se pudo enviar el reporte',
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <ModalPortal>
      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:p-6">
        <div className="card w-full max-w-lg p-6 my-4">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <span
                className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                style={{ background: '#EFF6FF', color: '#3B82F6' }}
              >
                <LifeBuoy className="w-4.5 h-4.5" />
              </span>
              <div>
                <h2 className="text-base font-bold text-ink" style={{ letterSpacing: '-0.02em' }}>
                  Reportar un problema
                </h2>
                <p className="text-xs text-ink-muted">Lo recibimos por correo y te respondemos ahí</p>
              </div>
            </div>
            <button onClick={onClose} className="w-8 h-8 rounded-lg flex items-center justify-center text-ink-subtle hover:bg-black/5">
              <X className="w-4 h-4" />
            </button>
          </div>

          {sent ? (
            <div className="py-4">
              <div className="flex items-center gap-2 mb-3">
                <CheckCircle2 className="w-5 h-5" style={{ color: '#25D366' }} />
                <p className="text-sm font-semibold text-ink">Reporte enviado</p>
              </div>
              <p className="text-sm text-ink-muted">
                Quedó registrado como <strong className="text-ink">{sent.ticket}</strong>. Si nos escribís
                por otro lado, mencionalo y sabemos de cuál hablás.
              </p>
              {/* Si el correo no salió el reporte igual está guardado, y decirlo evita
                  que la persona se quede esperando una respuesta que nadie vio. */}
              {!sent.emailSent && (
                <p className="text-xs mt-3 flex items-start gap-1.5" style={{ color: '#B45309' }}>
                  <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  El reporte quedó guardado, pero el aviso por correo no pudo salir de este servidor.
                  Si es urgente, contactanos por otra vía.
                </p>
              )}
              <button onClick={onClose} className="btn-primary w-full justify-center mt-5">Listo</button>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="text-[11px] text-ink-subtle block mb-1">¿Qué estabas haciendo?</label>
                <input
                  value={activity}
                  onChange={(e) => setActivity(e.target.value)}
                  placeholder="Ej: creando una campaña para los mayoristas"
                  className="input w-full"
                  autoFocus
                />
              </div>

              <div>
                <label className="text-[11px] text-ink-subtle block mb-1">¿Qué pasó?</label>
                <textarea
                  value={problem}
                  onChange={(e) => setProblem(e.target.value)}
                  placeholder="Contanos qué viste: un mensaje de error, una pantalla en blanco, algo que no responde…"
                  rows={4}
                  className="input w-full resize-y"
                />
              </div>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={blocking}
                  onChange={(e) => setBlocking(e.target.checked)}
                  className="w-3.5 h-3.5 accent-red-500"
                />
                <span className="text-xs text-ink">No puedo seguir trabajando</span>
              </label>

              {/* Qué se manda, a la vista pero plegado. */}
              <div className="rounded-lg" style={{ border: '1px solid var(--border)' }}>
                <button
                  type="button"
                  onClick={() => setShowDetail((v) => !v)}
                  className="w-full flex items-center gap-1.5 px-3 py-2 text-[11px] text-ink-muted hover:text-ink"
                >
                  {showDetail ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  Qué se envía junto con tu mensaje
                </button>
                {showDetail && (
                  <div className="px-3 pb-3 text-[11px] text-ink-muted space-y-1.5">
                    <p>
                      Tu nombre y correo ({user?.email}), tu empresa, la pantalla en la que estás, el
                      navegador y los últimos errores técnicos del panel.
                    </p>
                    <p className="font-medium text-ink">
                      No se envía el contenido de tus conversaciones ni los datos de tus contactos.
                    </p>
                    {errors.length > 0 && (
                      <div
                        className="mt-2 rounded p-2 font-mono text-[10px] leading-relaxed max-h-28 overflow-y-auto"
                        style={{ background: 'var(--surface-muted)' }}
                      >
                        {errors.map((e, i) => (
                          <div key={i} className="truncate">
                            {e.method} {e.url} → {e.status}
                            {e.message ? ` · ${e.message}` : ''}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex gap-2 pt-1">
                <button onClick={onClose} className="btn-secondary flex-1">Cancelar</button>
                <button onClick={handleSend} disabled={!canSend} className="btn-primary flex-1">
                  {sending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Enviar reporte
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </ModalPortal>
  );
}
