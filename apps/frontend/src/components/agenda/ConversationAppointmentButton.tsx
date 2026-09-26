'use client';
import { useState } from 'react';
import { CalendarPlus, Loader2 } from 'lucide-react';
import { useAgendaSettings } from '@/hooks/useAgendaSettings';
import CreateAppointmentModal from './CreateAppointmentModal';
import { useClinics } from './useClinics';

type Patient = { id: string; name: string | null; phone: string | null };

/**
 * "Crear cita" desde la conversacion, con el paciente ya cargado: es la forma de que
 * cada cita tenga el WhatsApp del paciente, que era lo que faltaba en el calendario
 * compartido. La clinica propuesta es la linea por la que escribio.
 */
export default function ConversationAppointmentButton({ patient, channelAccountId }: { patient: Patient; channelAccountId?: string | null }) {
  const settings = useAgendaSettings();
  const [open, setOpen] = useState(false);

  // Sin agenda, o un contacto sin WhatsApp (Instagram, Messenger): no hay a quien avisarle.
  if (!settings?.enabled || !patient.phone) return null;

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-ghost w-8 h-8 p-0" title="Crear cita">
        <CalendarPlus className="w-3.5 h-3.5" />
      </button>
      {open && (
        <Modal
          patient={patient}
          channelAccountId={channelAccountId ?? undefined}
          timezone={settings.timezone}
          slotMinutes={settings.slotMinutes}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/** Aparte para pedir las clinicas recien al abrir, no en cada conversacion que se mira. */
function Modal({
  patient,
  channelAccountId,
  timezone,
  slotMinutes,
  onClose,
}: {
  patient: Patient;
  channelAccountId?: string;
  timezone: string;
  slotMinutes: number;
  onClose: () => void;
}) {
  const clinics = useClinics();
  if (!clinics) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20">
        <Loader2 className="w-5 h-5 animate-spin text-white" />
      </div>
    );
  }
  return (
    <CreateAppointmentModal
      clinics={clinics}
      timezone={timezone}
      slotMinutes={slotMinutes}
      initial={{ channelAccountId, patient }}
      onClose={onClose}
      onCreated={onClose}
    />
  );
}
