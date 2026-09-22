-- Etiquetas de contacto: con que se segmenta una campaña.
--
-- No tocan nada de lo existente — son dos tablas nuevas y una columna opcional en
-- Campaign. Un tenant que no cree ninguna etiqueta sigue funcionando igual que hoy.
--
-- Las tablas Tag/ConversationTag (etiquetas de conversacion, retiradas del producto)
-- quedan como estan: describen otra cosa y no se mezclan con estas.

-- CreateTable
CREATE TABLE IF NOT EXISTS "ContactTag" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#6366f1',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactTag_pkey" PRIMARY KEY ("id")
);

-- El unique va por slug y no por name: es lo que impide que "VIP", "vip" y "Vip"
-- convivan como tres etiquetas distintas.
CREATE UNIQUE INDEX IF NOT EXISTS "ContactTag_tenantId_slug_key" ON "ContactTag"("tenantId", "slug");
CREATE INDEX IF NOT EXISTS "ContactTag_tenantId_idx" ON "ContactTag"("tenantId");

-- CreateTable
CREATE TABLE IF NOT EXISTS "ContactTagLink" (
    "contactId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactTagLink_pkey" PRIMARY KEY ("contactId", "tagId")
);

CREATE INDEX IF NOT EXISTS "ContactTagLink_tagId_idx" ON "ContactTagLink"("tagId");

-- Las FK se agregan solo si no estan: el IF NOT EXISTS de arriba deja la migracion
-- repetible, y ADD CONSTRAINT no lo acepta.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ContactTag_tenantId_fkey') THEN
    ALTER TABLE "ContactTag" ADD CONSTRAINT "ContactTag_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ContactTagLink_contactId_fkey') THEN
    ALTER TABLE "ContactTagLink" ADD CONSTRAINT "ContactTagLink_contactId_fkey"
      FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ContactTagLink_tagId_fkey') THEN
    ALTER TABLE "ContactTagLink" ADD CONSTRAINT "ContactTagLink_tagId_fkey"
      FOREIGN KEY ("tagId") REFERENCES "ContactTag"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Con que filtro se armo cada campaña. Las campañas viejas quedan en NULL, que se lee
-- como "no sabemos" y la pantalla simplemente no muestra la linea.
ALTER TABLE "Campaign" ADD COLUMN IF NOT EXISTS "recipientFilter" JSONB;
