-- Igual que la migracion de Tenant.openaiApiKey/openaiModel: estas columnas y esta
-- tabla ya existian en bases que corrieron `prisma db push` en algun momento (Contact.company,
-- Conversation.lastInboundAt, y toda la feature de QuickReply) pero nunca quedaron en el
-- historial de migraciones. Detectado con `prisma migrate diff --from-migrations --to-schema-datamodel`
-- comparando el historial completo contra schema.prisma. IF NOT EXISTS para no romper
-- las bases que ya las tienen (dev local, la VPS de siempre).

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN IF NOT EXISTS "company" TEXT;
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "lastInboundAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE IF NOT EXISTS "QuickReply" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "shortcut" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QuickReply_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "QuickReply_tenantId_idx" ON "QuickReply"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "QuickReply_tenantId_shortcut_key" ON "QuickReply"("tenantId", "shortcut");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "QuickReply" ADD CONSTRAINT "QuickReply_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
