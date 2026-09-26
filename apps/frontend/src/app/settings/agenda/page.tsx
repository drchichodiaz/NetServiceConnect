'use client';
import { useState } from 'react';
import { ChevronDown, HelpCircle, Loader2 } from 'lucide-react';
import clsx from 'clsx';
import { useAgendaSettings } from '@/hooks/useAgendaSettings';
import { useClinics } from '@/components/agenda/useClinics';
import DoctorsTab from '@/components/agenda/DoctorsTab';
import ExceptionsTab from '@/components/agenda/ExceptionsTab';
import NoticesTab from '@/components/agenda/NoticesTab';

const TABS = [
  { id: 'doctors', label: 'Doctores' },
  { id: 'exceptions', label: 'Ausencias y cambios' },
  { id: 'notices', label: 'Avisos' },
] as const;

export default function AgendaSettingsPage() {
  const settings = useAgendaSettings();
  const clinics = useClinics();
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('doctors');
  // Plegada siempre al entrar: abierta ocupa la pantalla.
  const [help, setHelp] = useState(false);

  if (!settings || !clinics) {
    return <div className="flex justify-center py-24"><Loader2 className="w-5 h-5 animate-spin text-ink-subtle" /></div>;
  }
  if (!settings.enabled) {
    return <div className="max-w-2xl mx-auto py-16 px-6 text-sm text-ink-muted">La agenda no está activada para esta empresa.</div>;
  }

  return (
    <div className="max-w-3xl mx-auto py-10 px-6">
      <h1 className="text-xl font-bold text-ink mb-1" style={{ letterSpacing: '-0.02em' }}>Doctores y turnos</h1>
      <p className="text-sm text-ink-muted mb-4">Quién atiende en cada clínica y cuándo. Con esto la agenda asigna doctor a cada cita.</p>

      <div className="card mb-6">
        <button onClick={() => setHelp(!help)} className="w-full flex items-center justify-between p-4 text-sm font-medium text-ink">
          <span className="flex items-center gap-2"><HelpCircle className="w-4 h-4 text-ink-subtle" /> ¿Cómo funciona?</span>
          <ChevronDown className={clsx('w-4 h-4 text-ink-subtle transition-transform', help && 'rotate-180')} />
        </button>
        {help && (
          <div className="px-4 pb-4 text-xs text-ink-muted space-y-2">
            <p><b className="text-ink">Turnos:</b> lo que se repite cada semana. “Los lunes de 8:00 a 13:00 en Villa Clarita.” Un doctor de planta se carga una vez; uno que rota tiene un turno por clínica.</p>
            <p><b className="text-ink">Ausencias y cambios:</b> lo de un solo día. Una ausencia bloquea ese horario; “va a otra clínica” reemplaza su turno de ese día.</p>
            <p><b className="text-ink">Asignación:</b> al agendar, la recepción elige la hora y el sistema asigna al doctor libre con menos citas ese día. Un doctor nunca queda con dos citas a la vez, aunque sean de clínicas distintas.</p>
            <p>Los especialistas (cirugías, etc.) no se cargan acá: sus citas se siguen manejando como hasta ahora.</p>
          </div>
        )}
      </div>

      <div className="flex gap-1 border-b border-border mb-5">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={clsx(
              'px-4 py-2 text-sm -mb-px border-b-2 transition-colors',
              tab === t.id ? 'border-green-500 text-ink font-medium' : 'border-transparent text-ink-muted hover:text-ink',
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {clinics.length === 0 ? (
        <p className="text-sm text-ink-muted">No hay líneas de WhatsApp conectadas. Cada clínica es una línea: conecte al menos una.</p>
      ) : (
        <>
          {tab === 'doctors' && <DoctorsTab clinics={clinics} />}
          {tab === 'exceptions' && <ExceptionsTab clinics={clinics} timezone={settings.timezone} />}
          {tab === 'notices' && <NoticesTab settings={settings} />}
        </>
      )}
    </div>
  );
}
