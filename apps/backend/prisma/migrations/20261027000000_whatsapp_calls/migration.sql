-- Llamadas de WhatsApp (Calling API): registro de llamadas y el interruptor por linea.
--
-- Aditiva y sin backfill. Ninguna linea queda con llamadas activadas: se prenden una
-- por una desde el panel, que es lo que hace que a los clientes les aparezca el boton.

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CallStatus') THEN
    CREATE TYPE "CallStatus" AS ENUM ('RINGING', 'ANSWERED', 'COMPLETED', 'MISSED', 'REJECTED', 'FAILED');
  END IF;
END $$;

ALTER TABLE "ChannelAccount" ADD COLUMN IF NOT EXISTS "callingEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE IF NOT EXISTS "Call" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "channelAccountId" TEXT,
    "conversationId" TEXT,
    "externalId" TEXT NOT NULL,
    "status" "CallStatus" NOT NULL DEFAULT 'RINGING',
    "sdpOffer" TEXT,
    "answeredById" TEXT,
    "answeredAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "durationSec" INTEGER,
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Call_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Call_tenantId_externalId_key" ON "Call"("tenantId", "externalId");
CREATE INDEX IF NOT EXISTS "Call_tenantId_createdAt_idx" ON "Call"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "Call_conversationId_idx" ON "Call"("conversationId");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Call_tenantId_fkey') THEN
    ALTER TABLE "Call" ADD CONSTRAINT "Call_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Call_channelAccountId_fkey') THEN
    ALTER TABLE "Call" ADD CONSTRAINT "Call_channelAccountId_fkey" FOREIGN KEY ("channelAccountId") REFERENCES "ChannelAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Call_conversationId_fkey') THEN
    ALTER TABLE "Call" ADD CONSTRAINT "Call_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Call_answeredById_fkey') THEN
    ALTER TABLE "Call" ADD CONSTRAINT "Call_answeredById_fkey" FOREIGN KEY ("answeredById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
