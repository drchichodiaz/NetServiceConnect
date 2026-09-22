-- Envio masivo de plantillas (campañas) + marca de baja en el contacto.
--
-- El progreso de una campaña vive en CampaignRecipient, una fila por destinatario, no
-- en contadores: asi un reinicio del contenedor a mitad de un envio no pierde nada (al
-- volver sigue por los PENDING) y el unique (campaignId, contactId) impide que alguien
-- reciba dos veces.
--
-- Todo idempotente (IF NOT EXISTS / EXCEPTION duplicate_object) por el drift historico
-- de produccion, igual que el resto de las migraciones de este proyecto.
--
-- A proposito NO se incluyen dos cambios que `migrate diff` propuso y que son drift
-- previo, ajeno a esto: el DROP DEFAULT de "ContactIdentity"."updatedAt" y el rename
-- del constraint WhatsAppAccount_tenantId_fkey. Tocarlos aca mezclaria un arreglo no
-- pedido con esta funcionalidad, y en produccion pueden estar ya de otra forma.

-- ── Enums ────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'RUNNING', 'PAUSED', 'DONE', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "CampaignRecipientStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Baja de envios masivos ───────────────────────────────────────────────────
-- Fecha y no booleano: permite decir desde cuando. No impide responderle a quien
-- escribe, solo corta los envios proactivos.
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "optedOutAt" TIMESTAMP(3);
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "optedOutReason" TEXT;

-- ── Campaña ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Campaign" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "templateId" TEXT NOT NULL,
    "channelAccountId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "ratePerMinute" INTEGER NOT NULL DEFAULT 20,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "pausedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "CampaignRecipient" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "status" "CampaignRecipientStatus" NOT NULL DEFAULT 'PENDING',
    "variables" JSONB,
    "recipientPhone" TEXT NOT NULL,
    "messageId" TEXT,
    "conversationId" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "sentAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),

    CONSTRAINT "CampaignRecipient_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "Campaign_tenantId_status_idx" ON "Campaign"("tenantId", "status");
CREATE INDEX IF NOT EXISTS "CampaignRecipient_campaignId_status_idx" ON "CampaignRecipient"("campaignId", "status");
-- Lo que hace la campaña idempotente.
CREATE UNIQUE INDEX IF NOT EXISTS "CampaignRecipient_campaignId_contactId_key" ON "CampaignRecipient"("campaignId", "contactId");

-- ── Claves foraneas ──────────────────────────────────────────────────────────
DO $$ BEGIN
  ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_templateId_fkey"
    FOREIGN KEY ("templateId") REFERENCES "MessageTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_channelAccountId_fkey"
    FOREIGN KEY ("channelAccountId") REFERENCES "ChannelAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_createdById_fkey"
    FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_contactId_fkey"
    FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Por si la tabla ya existia de una corrida anterior de esta misma migracion.
ALTER TABLE "CampaignRecipient" ADD COLUMN IF NOT EXISTS "claimedAt" TIMESTAMP(3);
