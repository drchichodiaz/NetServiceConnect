-- AlterTable
-- IF NOT EXISTS: algunos entornos (prod) ya tenian esta tabla/columna aplicada
-- manualmente via `prisma db push` antes de que existiera esta migracion.
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "mediaMimeType" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "SystemConfig" (
    "id" TEXT NOT NULL DEFAULT '1',
    "metaAppId" TEXT,
    "metaConfigId" TEXT,
    "metaAppSecret" TEXT,
    "metaVerifyToken" TEXT,
    "metaApiVersion" TEXT NOT NULL DEFAULT 'v19.0',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemConfig_pkey" PRIMARY KEY ("id")
);
