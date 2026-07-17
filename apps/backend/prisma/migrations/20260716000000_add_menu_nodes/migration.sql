-- AlterEnum
ALTER TYPE "ConversationBotState" ADD VALUE IF NOT EXISTS 'AWAITING_QUERY';
ALTER TYPE "ConversationBotState" ADD VALUE IF NOT EXISTS 'AWAITING_POST_REPLY';

-- CreateEnum
DO $$ BEGIN
    CREATE TYPE "MenuNodeType" AS ENUM ('MENU', 'TEXT', 'ORDER_LOOKUP', 'AGENT');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "TenantMenuNode" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "parentId" TEXT,
    "type" "MenuNodeType" NOT NULL DEFAULT 'TEXT',
    "title" TEXT NOT NULL,
    "subtitle" TEXT,
    "bodyText" TEXT,
    "promptText" TEXT,
    "config" JSONB,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantMenuNode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TenantMenuNode_tenantId_parentId_idx" ON "TenantMenuNode"("tenantId", "parentId");

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "TenantMenuNode" ADD CONSTRAINT "TenantMenuNode_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

-- AddForeignKey
DO $$ BEGIN
    ALTER TABLE "TenantMenuNode" ADD CONSTRAINT "TenantMenuNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "TenantMenuNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
