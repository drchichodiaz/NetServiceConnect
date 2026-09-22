-- Boton de soporte: el usuario reporta un problema y nos llega por correo.
--
-- El reporte se guarda ademas de enviarse, porque el correo puede fallar (SMTP sin
-- configurar en este entorno, proveedor caido) y ahi el reporte se perderia entero
-- mientras la persona cree que llego.

-- CreateTable
CREATE TABLE IF NOT EXISTS "SupportRequest" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "activity" TEXT NOT NULL,
    "problem" TEXT NOT NULL,
    "blocking" BOOLEAN NOT NULL DEFAULT false,
    "context" JSONB,
    "emailSent" BOOLEAN NOT NULL DEFAULT false,
    "emailError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "SupportRequest_tenantId_createdAt_idx" ON "SupportRequest"("tenantId", "createdAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SupportRequest_tenantId_fkey') THEN
    ALTER TABLE "SupportRequest" ADD CONSTRAINT "SupportRequest_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  -- El usuario se pone en NULL si lo borran: el reporte sigue sirviendo sin el.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'SupportRequest_userId_fkey') THEN
    ALTER TABLE "SupportRequest" ADD CONSTRAINT "SupportRequest_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- A donde llegan los reportes de ESTE entorno. Se carga desde Configuracion > Sistema
-- (o con SUPPORT_EMAIL en el entorno); vacio = el reporte se guarda pero no se envia.
ALTER TABLE "SystemConfig" ADD COLUMN IF NOT EXISTS "supportEmail" TEXT;
