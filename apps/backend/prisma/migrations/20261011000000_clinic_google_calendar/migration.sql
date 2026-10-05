-- Calendario de Google por clinica (todas sus citas, compartido con la recepcion) y el
-- registro de cuando se le mando al doctor el enlace de su calendario. Aditiva.
ALTER TABLE "Doctor" ADD COLUMN IF NOT EXISTS "googleLinkSentAt" TIMESTAMP(3);
ALTER TABLE "Appointment" ADD COLUMN IF NOT EXISTS "googleClinicCalendarId" TEXT;

CREATE TABLE IF NOT EXISTS "ClinicGoogleCalendar" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channelAccountId" TEXT NOT NULL,
    "emails" TEXT[],
    "calendarId" TEXT,
    "sharedEmails" TEXT[],
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClinicGoogleCalendar_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ClinicGoogleCalendar_channelAccountId_key" ON "ClinicGoogleCalendar"("channelAccountId");
CREATE INDEX IF NOT EXISTS "ClinicGoogleCalendar_tenantId_idx" ON "ClinicGoogleCalendar"("tenantId");

DO $$ BEGIN
  ALTER TABLE "ClinicGoogleCalendar" ADD CONSTRAINT "ClinicGoogleCalendar_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ClinicGoogleCalendar" ADD CONSTRAINT "ClinicGoogleCalendar_channelAccountId_fkey" FOREIGN KEY ("channelAccountId") REFERENCES "ChannelAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
