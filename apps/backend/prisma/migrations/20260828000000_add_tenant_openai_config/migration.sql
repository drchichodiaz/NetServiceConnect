-- Estas columnas ya existian en bases que corrieron `prisma db push` en algun momento
-- (ver Tenant.openaiApiKey/openaiModel en schema.prisma) pero nunca quedaron en el
-- historial de migraciones — una base nueva corriendo `prisma migrate deploy` no las
-- creaba. IF NOT EXISTS para no romper las bases que ya las tienen.

-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "openaiApiKey" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "openaiModel" TEXT;
