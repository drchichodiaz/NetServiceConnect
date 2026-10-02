-- El paciente cambia o cancela su cita solo, desde el boton "Reprogramar" del
-- recordatorio. Apagado por defecto: lo prende cada empresa. Aditiva.
ALTER TABLE "AgendaSettings" ADD COLUMN IF NOT EXISTS "patientCanReschedule" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AgendaSettings" ADD COLUMN IF NOT EXISTS "patientCanCancel" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AgendaSettings" ADD COLUMN IF NOT EXISTS "selfServiceCutoffHours" INTEGER NOT NULL DEFAULT 24;

ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "patientRescheduledAt" TIMESTAMP(3);
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "cancelledByPatient" BOOLEAN NOT NULL DEFAULT false;
