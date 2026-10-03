-- Plantilla con la que la clinica le manda al doctor el enlace de su calendario. Aditiva.
ALTER TABLE "AgendaSettings" ADD COLUMN IF NOT EXISTS "doctorCalendarTemplateId" TEXT;
