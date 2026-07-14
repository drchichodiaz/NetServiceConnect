-- AlterEnum
ALTER TYPE "ConversationBotState" ADD VALUE IF NOT EXISTS 'BRANCH_MENU';
ALTER TYPE "ConversationBotState" ADD VALUE IF NOT EXISTS 'AWAITING_BRANCH_QUERY';
ALTER TYPE "ConversationBotState" ADD VALUE IF NOT EXISTS 'AWAITING_BRANCH_FOLLOWUP';
ALTER TYPE "ConversationBotState" ADD VALUE IF NOT EXISTS 'AWAITING_RESOLUTION_CONFIRMATION';

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "botContext" JSONB;
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "closedReason" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "TenantBranch" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "scheduleText" TEXT,
    "phone" TEXT,
    "mapsUrl" TEXT,
    "servicesText" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantBranch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TenantBranch_tenantId_idx" ON "TenantBranch"("tenantId");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "TenantBranch" ADD CONSTRAINT "TenantBranch_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
