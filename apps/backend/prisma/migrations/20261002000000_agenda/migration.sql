-- Agenda de citas: doctores, turnos semanales, excepciones, citas y resumen diario.
--
-- Aditiva y sin backfill. Ninguna empresa tiene AgendaSettings, asi que nadie ve la
-- agenda hasta que se le active. Tenant.timezone arranca en Panama para todas las que
-- ya existian, que es donde estan.

-- La restriccion anti-choques de Appointment combina "=" sobre un texto con "&&" sobre
-- un rango en el mismo indice GiST; para el "=" hace falta btree_gist. Viene con
-- Postgres (contrib) y es "trusted" desde la version 13.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'DoctorExceptionKind') THEN
    CREATE TYPE "DoctorExceptionKind" AS ENUM ('ABSENT', 'WORKS_AT');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AppointmentStatus') THEN
    CREATE TYPE "AppointmentStatus" AS ENUM ('SCHEDULED', 'CONFIRMED', 'ARRIVED', 'DONE', 'NO_SHOW', 'CANCELLED');
  END IF;
END $$;

ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "timezone" TEXT NOT NULL DEFAULT 'America/Panama';

-- CreateTable
CREATE TABLE IF NOT EXISTS "AgendaSettings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "slotMinutes" INTEGER NOT NULL DEFAULT 45,
    "reminderHoursBefore" INTEGER NOT NULL DEFAULT 24,
    "doctorSummaryHour" INTEGER NOT NULL DEFAULT 7,
    "confirmationTemplateId" TEXT,
    "reminderTemplateId" TEXT,
    "doctorSummaryTemplateId" TEXT,
    "delayTemplateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgendaSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "Doctor" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Doctor_pkey" PRIMARY KEY ("id")
);

-- Los CHECK son la ultima red: el servicio ya valida, pero un turno de 13:00 a 8:00 o
-- un dia 7 romperia el calculo de disponibilidad en silencio.
CREATE TABLE IF NOT EXISTS "DoctorShift" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "channelAccountId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DoctorShift_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DoctorShift_weekday_check" CHECK ("weekday" BETWEEN 0 AND 6),
    CONSTRAINT "DoctorShift_minutes_check" CHECK ("startMinute" >= 0 AND "endMinute" <= 1440 AND "startMinute" < "endMinute")
);

CREATE TABLE IF NOT EXISTS "DoctorException" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "kind" "DoctorExceptionKind" NOT NULL,
    "startMinute" INTEGER,
    "endMinute" INTEGER,
    "channelAccountId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DoctorException_pkey" PRIMARY KEY ("id"),
    -- Horario: o los dos o ninguno (dia entero), y en orden.
    CONSTRAINT "DoctorException_minutes_check" CHECK (
      ("startMinute" IS NULL AND "endMinute" IS NULL)
      OR ("startMinute" >= 0 AND "endMinute" <= 1440 AND "startMinute" < "endMinute")
    ),
    -- "Ese dia va a otra clinica" necesita la clinica y el horario.
    CONSTRAINT "DoctorException_works_at_check" CHECK (
      "kind" <> 'WORKS_AT' OR ("channelAccountId" IS NOT NULL AND "startMinute" IS NOT NULL)
    )
);

CREATE TABLE IF NOT EXISTS "Appointment" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channelAccountId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "notes" TEXT,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "createdById" TEXT,
    "confirmationMessageId" TEXT,
    "reminderMessageId" TEXT,
    "reminderSentAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "rescheduleRequestedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Appointment_range_check" CHECK ("endsAt" > "startsAt")
);

CREATE TABLE IF NOT EXISTS "DoctorDailySummary" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "messageId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DoctorDailySummary_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AgendaSettings_tenantId_key" ON "AgendaSettings"("tenantId");
CREATE INDEX IF NOT EXISTS "Doctor_tenantId_idx" ON "Doctor"("tenantId");
CREATE UNIQUE INDEX IF NOT EXISTS "Doctor_tenantId_code_key" ON "Doctor"("tenantId", "code");
CREATE INDEX IF NOT EXISTS "DoctorShift_doctorId_weekday_idx" ON "DoctorShift"("doctorId", "weekday");
CREATE INDEX IF NOT EXISTS "DoctorShift_channelAccountId_weekday_idx" ON "DoctorShift"("channelAccountId", "weekday");
CREATE INDEX IF NOT EXISTS "DoctorException_doctorId_date_idx" ON "DoctorException"("doctorId", "date");
CREATE INDEX IF NOT EXISTS "DoctorException_tenantId_date_idx" ON "DoctorException"("tenantId", "date");
CREATE INDEX IF NOT EXISTS "Appointment_tenantId_channelAccountId_startsAt_idx" ON "Appointment"("tenantId", "channelAccountId", "startsAt");
CREATE INDEX IF NOT EXISTS "Appointment_doctorId_startsAt_idx" ON "Appointment"("doctorId", "startsAt");
CREATE INDEX IF NOT EXISTS "Appointment_contactId_idx" ON "Appointment"("contactId");
CREATE INDEX IF NOT EXISTS "Appointment_status_startsAt_idx" ON "Appointment"("status", "startsAt");
CREATE INDEX IF NOT EXISTS "Appointment_reminderMessageId_idx" ON "Appointment"("reminderMessageId");
CREATE UNIQUE INDEX IF NOT EXISTS "DoctorDailySummary_doctorId_date_key" ON "DoctorDailySummary"("doctorId", "date");

-- Ningun doctor con dos citas activas que se pisen. El rango es [inicio, fin): una
-- cita que termina a las 9:45 no choca con la que empieza a las 9:45. Las canceladas
-- no cuentan, para que su horario se pueda volver a dar.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Appointment_no_overlap') THEN
    ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_no_overlap"
      EXCLUDE USING gist ("doctorId" WITH =, tsrange("startsAt", "endsAt") WITH &&)
      WHERE ("status" <> 'CANCELLED');
  END IF;
END $$;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AgendaSettings_tenantId_fkey') THEN
    ALTER TABLE "AgendaSettings" ADD CONSTRAINT "AgendaSettings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Doctor_tenantId_fkey') THEN
    ALTER TABLE "Doctor" ADD CONSTRAINT "Doctor_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DoctorShift_tenantId_fkey') THEN
    ALTER TABLE "DoctorShift" ADD CONSTRAINT "DoctorShift_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DoctorShift_doctorId_fkey') THEN
    ALTER TABLE "DoctorShift" ADD CONSTRAINT "DoctorShift_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DoctorShift_channelAccountId_fkey') THEN
    ALTER TABLE "DoctorShift" ADD CONSTRAINT "DoctorShift_channelAccountId_fkey" FOREIGN KEY ("channelAccountId") REFERENCES "ChannelAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DoctorException_tenantId_fkey') THEN
    ALTER TABLE "DoctorException" ADD CONSTRAINT "DoctorException_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DoctorException_doctorId_fkey') THEN
    ALTER TABLE "DoctorException" ADD CONSTRAINT "DoctorException_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DoctorException_channelAccountId_fkey') THEN
    ALTER TABLE "DoctorException" ADD CONSTRAINT "DoctorException_channelAccountId_fkey" FOREIGN KEY ("channelAccountId") REFERENCES "ChannelAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  -- Restrict en linea, doctor y contacto: borrar cualquiera de los tres con citas tiene
  -- que fallar, no llevarse la agenda de una clinica por delante.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Appointment_tenantId_fkey') THEN
    ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Appointment_channelAccountId_fkey') THEN
    ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_channelAccountId_fkey" FOREIGN KEY ("channelAccountId") REFERENCES "ChannelAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Appointment_doctorId_fkey') THEN
    ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Appointment_contactId_fkey') THEN
    ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Appointment_createdById_fkey') THEN
    ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DoctorDailySummary_tenantId_fkey') THEN
    ALTER TABLE "DoctorDailySummary" ADD CONSTRAINT "DoctorDailySummary_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'DoctorDailySummary_doctorId_fkey') THEN
    ALTER TABLE "DoctorDailySummary" ADD CONSTRAINT "DoctorDailySummary_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
