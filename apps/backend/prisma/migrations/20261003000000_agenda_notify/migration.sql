-- Avisos de la agenda por WhatsApp: cuando salio la confirmacion y por que fallo el
-- ultimo aviso. Aditiva: las citas que ya existen quedan con confirmationSentAt NULL,
-- pero el worker solo confirma citas creadas o movidas en las ultimas 2 horas, asi que
-- el deploy no dispara confirmaciones de citas viejas.
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "confirmationSentAt" TIMESTAMP(3);
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "notifyError" TEXT;
