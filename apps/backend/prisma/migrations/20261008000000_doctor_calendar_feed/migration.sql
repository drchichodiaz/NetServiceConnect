-- Calendario del doctor por suscripcion (.ics): una clave secreta por doctor, que se
-- genera cuando la clinica le pide el enlace. Aditiva.
ALTER TABLE "Doctor" ADD COLUMN IF NOT EXISTS "calendarToken" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Doctor_calendarToken_key" ON "Doctor"("calendarToken");
