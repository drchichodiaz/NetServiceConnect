-- Motor de creditos de IA (fase 1): saldo, lotes, reservas y libro mayor.
--
-- Aditiva y sin backfill. Todas las empresas arrancan en aiBillingMode = 'BYOK', que es
-- exactamente como venian funcionando: con su propia clave, sin saldo y sin cobro. El
-- cobro se prende empresa por empresa pasandola a 'PLATFORM'.
--
-- Nadie queda con billetera hasta que se le acredite el primer lote.

-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AiBillingMode') THEN
    CREATE TYPE "AiBillingMode" AS ENUM ('BYOK', 'PLATFORM');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AiLotKind') THEN
    CREATE TYPE "AiLotKind" AS ENUM ('MONTHLY_ALLOCATION', 'PURCHASE', 'BONUS', 'ADJUSTMENT');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AiHoldStatus') THEN
    CREATE TYPE "AiHoldStatus" AS ENUM ('HELD', 'SETTLED', 'RELEASED', 'EXPIRED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'AiCreditEntryKind') THEN
    CREATE TYPE "AiCreditEntryKind" AS ENUM ('MONTHLY_ALLOCATION', 'PURCHASE', 'BONUS', 'AI_USAGE', 'EXPIRATION', 'REFUND', 'ADJUSTMENT');
  END IF;
END $$;

-- Modo de cobro por empresa.
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "aiBillingMode" "AiBillingMode" NOT NULL DEFAULT 'BYOK';

-- Clave y modelo de plataforma. La clave va cifrada por la aplicacion (CryptoService).
ALTER TABLE "SystemConfig" ADD COLUMN IF NOT EXISTS "aiPlatformApiKey" TEXT;
ALTER TABLE "SystemConfig" ADD COLUMN IF NOT EXISTS "aiPlatformModel" TEXT NOT NULL DEFAULT 'gpt-4o-mini';

-- CreateTable: el saldo, una fila por empresa. spendable = balance - reserved, y se
-- mantiene materializado para que la autorizacion sea un solo UPDATE condicional.
CREATE TABLE IF NOT EXISTS "AiWallet" (
    "tenantId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "reserved" INTEGER NOT NULL DEFAULT 0,
    "spendable" INTEGER NOT NULL DEFAULT 0,
    "aiEnabled" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiWallet_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable: cada acreditacion, con su vencimiento propio.
CREATE TABLE IF NOT EXISTS "AiCreditLot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "AiLotKind" NOT NULL,
    "credits" INTEGER NOT NULL,
    "remaining" INTEGER NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "periodId" TEXT,
    "note" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiCreditLot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AiCreditLot_tenantId_closedAt_expiresAt_idx"
    ON "AiCreditLot"("tenantId", "closedAt", "expiresAt");

-- CreateTable: reservas de operaciones en vuelo.
CREATE TABLE IF NOT EXISTS "AiHold" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "status" "AiHoldStatus" NOT NULL DEFAULT 'HELD',
    "credits" INTEGER NOT NULL,
    "feature" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "conversationId" TEXT,
    "userId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiHold_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AiHold_status_expiresAt_idx" ON "AiHold"("status", "expiresAt");
CREATE INDEX IF NOT EXISTS "AiHold_tenantId_createdAt_idx" ON "AiHold"("tenantId", "createdAt");

-- CreateTable: el libro mayor, append-only.
CREATE TABLE IF NOT EXISTS "AiCreditEntry" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "kind" "AiCreditEntryKind" NOT NULL,
    "credits" INTEGER NOT NULL,
    "balanceBefore" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "lotId" TEXT,
    "usageId" TEXT,
    "note" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiCreditEntry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "AiCreditEntry_tenantId_createdAt_idx" ON "AiCreditEntry"("tenantId", "createdAt");

-- Con que reserva se autorizo cada uso.
ALTER TABLE "AiUsage" ADD COLUMN IF NOT EXISTS "holdId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AiWallet_tenantId_fkey') THEN
    ALTER TABLE "AiWallet" ADD CONSTRAINT "AiWallet_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AiCreditLot_tenantId_fkey') THEN
    ALTER TABLE "AiCreditLot" ADD CONSTRAINT "AiCreditLot_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AiHold_tenantId_fkey') THEN
    ALTER TABLE "AiHold" ADD CONSTRAINT "AiHold_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AiCreditEntry_tenantId_fkey') THEN
    ALTER TABLE "AiCreditEntry" ADD CONSTRAINT "AiCreditEntry_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  -- El ledger sobrevive al lote y al uso: un movimiento historico no puede
  -- desaparecer porque se haya limpiado lo que lo origino.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AiCreditEntry_lotId_fkey') THEN
    ALTER TABLE "AiCreditEntry" ADD CONSTRAINT "AiCreditEntry_lotId_fkey"
      FOREIGN KEY ("lotId") REFERENCES "AiCreditLot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AiCreditEntry_usageId_fkey') THEN
    ALTER TABLE "AiCreditEntry" ADD CONSTRAINT "AiCreditEntry_usageId_fkey"
      FOREIGN KEY ("usageId") REFERENCES "AiUsage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AiUsage_holdId_fkey') THEN
    ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_holdId_fkey"
      FOREIGN KEY ("holdId") REFERENCES "AiHold"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
