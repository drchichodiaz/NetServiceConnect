-- Citas escritas directo en Google Calendar: un calendario por doctor, compartido con
-- su Gmail. Aditiva.
ALTER TABLE "Doctor" ADD COLUMN IF NOT EXISTS "googleEmail" TEXT;
ALTER TABLE "Doctor" ADD COLUMN IF NOT EXISTS "googleCalendarId" TEXT;
ALTER TABLE "Doctor" ADD COLUMN IF NOT EXISTS "googleSharedEmail" TEXT;
ALTER TABLE "Doctor" ADD COLUMN IF NOT EXISTS "googleError" TEXT;

ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "googleCalendarId" TEXT;
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "googleSyncedAt" TIMESTAMP(3);
