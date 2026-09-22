'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { campaignsApi } from '@/lib/api';
import type { Campaign } from '@/lib/api';
import { Megaphone, Plus, ChevronRight, HelpCircle, ChevronDown } from 'lucide-react';
import toast from 'react-hot-toast';
import { NewCampaignWizard } from './components/NewCampaignWizard';
import { STATUS_STYLES } from './status';

export default function CampaignsPage() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showWizard, setShowWizard] = useState(false);
  // Arranca siempre plegada: abierta ocupaba la pantalla entera al entrar.
  const [showHelp, setShowHelp] = useState(false);

  function load() {
    campaignsApi
      .list()
      .then((list) => {
        setCampaigns(list);
      })
      .catch(() => toast.error('Error al cargar las campañas'))
      .finally(() => setIsLoading(false));
  }

  useEffect(() => { load(); }, []);

  // Mientras haya una enviando, se refresca sola: el progreso lo mueve el worker
  // del backend, no esta pantalla, así que sin esto habría que recargar a mano.
  useEffect(() => {
    if (!campaigns.some((c) => c.status === 'RUNNING')) return;
    const timer = setInterval(load, 5000);
    return () => clearInterval(timer);
  }, [campaigns]);

  return (
    <div className="max-w-3xl mx-auto py-10 px-6 animate-fade-in">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-xl font-bold text-ink mb-1" style={{ letterSpacing: '-0.02em' }}>Campañas</h1>
          <p className="text-sm text-ink-muted">Enviar una plantilla a muchos contactos desde un Excel</p>
        </div>
        <button onClick={() => setShowWizard(true)} className="btn-primary shrink-0">
          <Plus className="w-4 h-4" />
          Nueva campaña
        </button>
      </div>

      {/* Panel plegable de ayuda — mismo patron que "¿Que puede ver cada usuario?" en
          Equipo. Una campaña es cara y no se puede deshacer: conviene que quien la
          arma entienda de antemano que hace falta y que va a pasar. */}
      <div className="card mb-5 overflow-hidden">
        <button
          onClick={() => setShowHelp((v) => !v)}
          className="w-full flex items-center gap-2 px-5 py-3 text-left hover:bg-surface-hover transition-colors"
          aria-expanded={showHelp}
        >
          <HelpCircle className="w-4 h-4 text-ink-muted shrink-0" />
          <span className="text-sm font-medium text-ink flex-1">¿Cómo funciona una campaña?</span>
          <ChevronDown className={`w-4 h-4 text-ink-muted shrink-0 transition-transform ${showHelp ? 'rotate-180' : ''}`} />
        </button>

        {showHelp && (
          <div className="px-5 pb-5 pt-1 space-y-4 animate-fade-in border-t border-line">
            <p className="text-xs text-ink-muted leading-relaxed pt-3">
              Una campaña manda una <strong className="text-ink font-medium">plantilla aprobada por Meta</strong> a
              muchos contactos, de a poco. WhatsApp no deja escribirle a alguien con texto libre si no te
              escribió en las últimas 24 horas — por eso siempre es una plantilla.
            </p>

            <div className="space-y-2.5">
              <Step n="1" title="Necesitás una plantilla aprobada">
                Se crea en <strong className="text-ink font-medium">Configuración → Plantillas</strong> y la aprueba
                Meta (suele tardar de minutos a unas horas). Para promociones, la categoría es{' '}
                <strong className="text-ink font-medium">Marketing</strong>.
              </Step>
              <Step n="2" title="Elegís a quién">
                Podés usar los <strong className="text-ink font-medium">contactos que ya están en el sistema</strong>{' '}
                (todos, o filtrados por nombre, empresa o teléfono), o{' '}
                <strong className="text-ink font-medium">subir un Excel</strong>. El Excel sirve cuando cada
                persona necesita un dato distinto en el mensaje: una columna por variable.
              </Step>
              <Step n="3" title="Indicás con qué se llenan las variables">
                Si la plantilla dice <code>Hola {'{{1}}'}</code>, ahí elegís si ese hueco sale del nombre del
                contacto, de una columna del Excel, o es el mismo texto para todos.
              </Step>
              <Step n="4" title="Revisás y recién ahí arrancás">
                Antes de mandar nada te decimos cuántos van a recibirlo y cuántos están dados de baja.
                Crear la campaña <strong className="text-ink font-medium">no envía</strong>: se envía cuando
                apretás Enviar, y podés pausarla en cualquier momento.
              </Step>
            </div>

            <div className="rounded-lg px-3 py-2.5 space-y-2" style={{ background: 'var(--surface-muted)', border: '1px solid var(--border)' }}>
              <p className="text-[11px] text-ink-muted leading-relaxed">
                <strong className="text-ink font-medium">La baja es automática.</strong> Si alguien responde
                "BAJA" o "STOP", queda marcado y ninguna campaña vuelve a escribirle. Igual podés seguir
                respondiéndole si te escribe. Conviene aclararlo en el pie de la plantilla.
              </p>
              <p className="text-[11px] text-ink-muted leading-relaxed">
                <strong className="text-ink font-medium">Meta limita cuánta gente nueva podés contactar por día</strong>,
                y un número recién conectado arranca bajo. Si se llega al tope, la campaña se pausa sola y la
                reanudás después. Mandar rápido a gente que no lo pidió baja la calificación de tu número.
              </p>
              <p className="text-[11px] text-ink-muted leading-relaxed">
                <strong className="text-ink font-medium">Las conversaciones quedan sin asignar.</strong> Aparecen
                en la bandeja del equipo recién cuando la persona responde, así una campaña grande no le
                tapa el inbox a nadie.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <div className="w-5 h-5 rounded-full border-2 border-green-500 border-t-transparent animate-spin" />
          </div>
        ) : campaigns.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-40 gap-2 text-center px-6">
            <Megaphone className="w-6 h-6 text-ink-subtle" />
            <p className="text-sm text-ink-muted">Todavía no enviaste ninguna campaña</p>
            <p className="text-xs text-ink-subtle">
              Necesitás una plantilla aprobada por Meta. Los destinatarios pueden ser tus
              contactos del sistema o un Excel.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {campaigns.map((c, i) => {
              const ss = STATUS_STYLES[c.status];
              const done = c.sentCount + c.failedCount + c.skippedCount;
              const pct = c.totalCount > 0 ? Math.round((done / c.totalCount) * 100) : 0;
              return (
                <Link
                  key={c.id}
                  href={`/campaigns/${c.id}`}
                  className="flex items-center gap-3.5 px-5 py-3.5 hover:bg-black/[0.02] animate-fade-in"
                  style={{ animationDelay: `${i * 40}ms` }}
                >
                  <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: '#E8FBF0', color: '#128C7E' }}>
                    <Megaphone className="w-4 h-4" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium text-ink truncate">{c.name}</p>
                      <span className="text-[11px] font-semibold rounded-full px-2.5 py-1 shrink-0" style={{ background: ss.bg, color: ss.color }}>
                        {ss.label}
                      </span>
                    </div>
                    <p className="text-xs text-ink-subtle">
                      {c.template?.name} · {c.totalCount} destinatario{c.totalCount === 1 ? '' : 's'}
                      {c.sentCount > 0 && <> · {c.sentCount} enviado{c.sentCount === 1 ? '' : 's'}</>}
                    </p>
                    {(c.status === 'RUNNING' || c.status === 'PAUSED') && (
                      <div className="h-1 rounded-full mt-1.5 overflow-hidden" style={{ background: 'var(--surface-muted)' }}>
                        <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: '#25D366' }} />
                      </div>
                    )}
                  </div>
                  <ChevronRight className="w-4 h-4 text-ink-subtle shrink-0" />
                </Link>
              );
            })}
          </div>
        )}
      </div>

      {showWizard && (
        <NewCampaignWizard
          onClose={() => setShowWizard(false)}
          onCreated={(c) => {
            setShowWizard(false);
            setCampaigns((prev) => [c, ...prev]);
          }}
        />
      )}
    </div>
  );
}

function Step({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2.5">
      <span className="text-[11px] font-semibold text-ink bg-surface-hover rounded px-1.5 py-0.5 h-fit shrink-0">{n}</span>
      <p className="text-xs text-ink-muted leading-relaxed">
        <strong className="text-ink font-medium">{title}.</strong> {children}
      </p>
    </div>
  );
}
