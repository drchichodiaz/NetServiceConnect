-- Multi-numero por tenant: WhatsAppAccount deja de ser 1:1 con Tenant y pasa a ser
-- una fila por linea (ej: una por sucursal). Conversation guarda por cual linea entro.
-- Idempotente (IF NOT EXISTS / DO $$) igual que las migraciones anteriores, para poder
-- correrla sobre bases que en algun momento pasaron por `prisma db push`.

-- ─── WhatsAppAccount: nuevas columnas ────────────────────────────────────────
ALTER TABLE "WhatsAppAccount" ADD COLUMN IF NOT EXISTS "label" TEXT;
ALTER TABLE "WhatsAppAccount" ADD COLUMN IF NOT EXISTS "isDefault" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "WhatsAppAccount" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- ─── WhatsAppAccount: 1:1 -> 1:N ─────────────────────────────────────────────
-- El unique de tenantId era lo unico que impedia guardar mas de una linea.
DROP INDEX IF EXISTS "WhatsAppAccount_tenantId_key";

CREATE UNIQUE INDEX IF NOT EXISTS "WhatsAppAccount_tenantId_phoneNumberId_key"
  ON "WhatsAppAccount"("tenantId", "phoneNumberId");
CREATE INDEX IF NOT EXISTS "WhatsAppAccount_tenantId_idx" ON "WhatsAppAccount"("tenantId");
-- El webhook resuelve la linea por phoneNumberId en cada mensaje entrante.
CREATE INDEX IF NOT EXISTS "WhatsAppAccount_phoneNumberId_idx" ON "WhatsAppAccount"("phoneNumberId");

-- ─── Conversation: por que linea entro ───────────────────────────────────────
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "whatsappAccountId" TEXT;

DO $$ BEGIN
    ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_whatsappAccountId_fkey"
      FOREIGN KEY ("whatsappAccountId") REFERENCES "WhatsAppAccount"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "Conversation_tenantId_whatsappAccountId_idx"
  ON "Conversation"("tenantId", "whatsappAccountId");

-- ─── Backfill ────────────────────────────────────────────────────────────────
-- Antes de esta migracion cada tenant tenia como maximo una cuenta, asi que toda
-- conversacion existente pertenece inequivocamente a esa. Sin esto, las respuestas
-- a conversaciones viejas caerian en el fallback de "linea por defecto".
UPDATE "Conversation" c
   SET "whatsappAccountId" = w."id"
  FROM "WhatsAppAccount" w
 WHERE w."tenantId" = c."tenantId"
   AND c."whatsappAccountId" IS NULL;

-- La linea que ya existia pasa a ser la default del tenant (la que se usa para dar
-- de alta plantillas y para conversaciones salientes sin linea elegida).
UPDATE "WhatsAppAccount" w
   SET "isDefault" = true
 WHERE NOT EXISTS (
         SELECT 1 FROM "WhatsAppAccount" d
          WHERE d."tenantId" = w."tenantId" AND d."isDefault"
       )
   AND w."id" = (
         SELECT w2."id" FROM "WhatsAppAccount" w2
          WHERE w2."tenantId" = w."tenantId"
          ORDER BY w2."createdAt" ASC
          LIMIT 1
       );
