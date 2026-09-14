-- Fase 1 del multicanal (Instagram + Facebook): la identidad del contacto deja de ser
-- su telefono. No toca ninguna API de Meta y no cambia nada visible: al terminar,
-- WhatsApp funciona igual, con los mismos contactos y conversaciones.
--
-- Idempotente (IF NOT EXISTS / DO $$) igual que las migraciones anteriores, para poder
-- correrla sobre bases que en algun momento pasaron por `prisma db push`.

-- ─── Canal ───────────────────────────────────────────────────────────────────
DO $$ BEGIN
    CREATE TYPE "Channel" AS ENUM ('WHATSAPP', 'MESSENGER', 'INSTAGRAM');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- ─── WhatsAppAccount -> ChannelAccount ───────────────────────────────────────
-- El rename es instantaneo y transaccional: no reescribe filas.
DO $$ BEGIN
    ALTER TABLE "WhatsAppAccount" RENAME TO "ChannelAccount";
EXCEPTION
    WHEN undefined_table THEN NULL;  -- ya renombrada
END $$;

ALTER TABLE "ChannelAccount" ADD COLUMN IF NOT EXISTS "channel" "Channel" NOT NULL DEFAULT 'WHATSAPP';
ALTER TABLE "ChannelAccount" ADD COLUMN IF NOT EXISTS "pageId" TEXT;
ALTER TABLE "ChannelAccount" ADD COLUMN IF NOT EXISTS "igAccountId" TEXT;

-- wabaId y phoneNumberId eran obligatorios porque solo existia WhatsApp. Una pagina de
-- Facebook no tiene ninguno de los dos.
ALTER TABLE "ChannelAccount" ALTER COLUMN "wabaId" DROP NOT NULL;
ALTER TABLE "ChannelAccount" ALTER COLUMN "phoneNumberId" DROP NOT NULL;

-- Los indices heredan el nombre viejo tras el rename de la tabla; se renombran para que
-- coincidan con lo que espera Prisma y no los recree al lado.
ALTER INDEX IF EXISTS "WhatsAppAccount_tenantId_phoneNumberId_key" RENAME TO "ChannelAccount_tenantId_phoneNumberId_key";
ALTER INDEX IF EXISTS "WhatsAppAccount_tenantId_idx"               RENAME TO "ChannelAccount_tenantId_idx";
ALTER INDEX IF EXISTS "WhatsAppAccount_phoneNumberId_idx"          RENAME TO "ChannelAccount_phoneNumberId_idx";
ALTER INDEX IF EXISTS "WhatsAppAccount_pkey"                       RENAME TO "ChannelAccount_pkey";

CREATE UNIQUE INDEX IF NOT EXISTS "ChannelAccount_tenantId_pageId_key" ON "ChannelAccount"("tenantId", "pageId");
CREATE INDEX IF NOT EXISTS "ChannelAccount_pageId_idx"      ON "ChannelAccount"("pageId");
CREATE INDEX IF NOT EXISTS "ChannelAccount_igAccountId_idx" ON "ChannelAccount"("igAccountId");

-- ─── Conversation.whatsappAccountId -> channelAccountId ──────────────────────
DO $$ BEGIN
    ALTER TABLE "Conversation" RENAME COLUMN "whatsappAccountId" TO "channelAccountId";
EXCEPTION
    WHEN undefined_column THEN NULL;  -- ya renombrada
END $$;

-- RENAME CONSTRAINT no acepta IF EXISTS, asi que en una segunda corrida reventaria.
DO $$ BEGIN
    ALTER TABLE "Conversation" RENAME CONSTRAINT "Conversation_whatsappAccountId_fkey" TO "Conversation_channelAccountId_fkey";
EXCEPTION
    WHEN undefined_object THEN NULL;  -- ya renombrado
END $$;

ALTER INDEX IF EXISTS "Conversation_tenantId_whatsappAccountId_idx" RENAME TO "Conversation_tenantId_channelAccountId_idx";

-- ─── Contact.phone deja de ser obligatorio ───────────────────────────────────
-- El unique (tenantId, phone) se queda: en Postgres varios NULL no colisionan, asi que
-- sigue impidiendo dos contactos de WhatsApp con el mismo numero mientras deja convivir
-- a los de Instagram y Messenger, que no tienen telefono.
ALTER TABLE "Contact" ALTER COLUMN "phone" DROP NOT NULL;

-- ─── ContactIdentity ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ContactIdentity" (
    "id"         TEXT NOT NULL,
    "tenantId"   TEXT NOT NULL,
    "contactId"  TEXT NOT NULL,
    "channel"    "Channel" NOT NULL,
    "externalId" TEXT NOT NULL,
    "handle"     TEXT,
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactIdentity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ContactIdentity_tenantId_channel_externalId_key"
  ON "ContactIdentity"("tenantId", "channel", "externalId");
CREATE INDEX IF NOT EXISTS "ContactIdentity_contactId_idx" ON "ContactIdentity"("contactId");

DO $$ BEGIN
    ALTER TABLE "ContactIdentity" ADD CONSTRAINT "ContactIdentity_contactId_fkey"
      FOREIGN KEY ("contactId") REFERENCES "Contact"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- ─── Backfill ────────────────────────────────────────────────────────────────
-- Una identidad WHATSAPP por cada contacto que ya existe, con su telefono como
-- externalId. El ON CONFLICT lo hace idempotente: se puede correr de nuevo sin duplicar.
-- gen_random_uuid() en vez de cuid porque esto es SQL puro; el formato del id no lo lee
-- nadie, solo tiene que ser unico.
INSERT INTO "ContactIdentity" ("id", "tenantId", "contactId", "channel", "externalId", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, c."tenantId", c."id", 'WHATSAPP', c."phone", c."createdAt", CURRENT_TIMESTAMP
FROM "Contact" c
WHERE c."phone" IS NOT NULL
ON CONFLICT ("tenantId", "channel", "externalId") DO NOTHING;
