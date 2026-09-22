-- Partners: quien vende el sistema y nos trae clientes.
--
-- Un partner NO es un tenant ni un usuario — es gente de la operacion comercial de
-- quien opera este servidor. Por eso la tabla no tiene tenantId.
--
-- Las empresas que ya existian quedan con partnerId NULL, que se lee como venta
-- directa. No hay nada que migrar.

-- CreateTable
CREATE TABLE IF NOT EXISTS "Partner" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "taxId" TEXT,
    "agreement" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);

-- Atribucion de la venta en cada empresa.
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "partnerId" TEXT;
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "soldAt" TIMESTAMP(3);
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "partnerNote" TEXT;

CREATE INDEX IF NOT EXISTS "Tenant_partnerId_idx" ON "Tenant"("partnerId");

-- SetNull y no Cascade: borrar un partner no puede llevarse por delante las empresas
-- que vendio. Quedan como venta directa y se les puede volver a asignar otro.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Tenant_partnerId_fkey') THEN
    ALTER TABLE "Tenant" ADD CONSTRAINT "Tenant_partnerId_fkey"
      FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
