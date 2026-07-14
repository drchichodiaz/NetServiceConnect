-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "ConversationMode" AS ENUM ('BOT', 'AGENT');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "ConversationBotState" AS ENUM ('MENU', 'AWAITING_ORDER_NUMBER');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AlterTable
-- Default AGENT a proposito: las conversaciones ya existentes viven con un
-- humano asignado y no deben caer en el flujo del bot.
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "mode" "ConversationMode" NOT NULL DEFAULT 'AGENT';
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "botState" "ConversationBotState";

-- CreateTable
CREATE TABLE IF NOT EXISTS "TenantBotConfig" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "horariosText" TEXT,
    "sucursalesText" TEXT,
    "serviciosText" TEXT,
    "orderStatusApiUrl" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantBotConfig_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TenantBotConfig_tenantId_key" ON "TenantBotConfig"("tenantId");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "TenantBotConfig" ADD CONSTRAINT "TenantBotConfig_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
