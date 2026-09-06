-- Las plantillas de WhatsApp viven en un WABA, no en el tenant. Sin esto se podia
-- enviar desde una linea una plantilla creada en otro WABA, y Meta contestaba 132001
-- ("template name does not exist in the translation") sin que el panel supiera por que.

ALTER TABLE "MessageTemplate" ADD COLUMN IF NOT EXISTS "wabaId" TEXT;

-- Backfill: hasta ahora las plantillas se creaban siempre contra la linea por defecto
-- del tenant, asi que ese es el WABA al que pertenecen las que ya existen.
UPDATE "MessageTemplate" t
   SET "wabaId" = (
         SELECT w."wabaId" FROM "WhatsAppAccount" w
          WHERE w."tenantId" = t."tenantId"
          ORDER BY w."isDefault" DESC, w."sortOrder" ASC, w."createdAt" ASC
          LIMIT 1
       )
 WHERE t."wabaId" IS NULL;

-- El nombre pasa a ser unico por WABA: el mismo nombre necesita poder existir en
-- cada WABA del tenant.
DROP INDEX IF EXISTS "MessageTemplate_tenantId_name_language_key";
CREATE UNIQUE INDEX IF NOT EXISTS "MessageTemplate_tenantId_wabaId_name_language_key"
  ON "MessageTemplate"("tenantId", "wabaId", "name", "language");
