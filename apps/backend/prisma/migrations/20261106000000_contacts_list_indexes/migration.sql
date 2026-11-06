-- La lista de contactos pagina por fecha de actualizacion, y cuenta las conversaciones
-- de cada fila: sin estos indices las dos cosas recorren la tabla entera.
CREATE INDEX IF NOT EXISTS "Contact_tenantId_updatedAt_id_idx" ON "Contact"("tenantId", "updatedAt" DESC, "id" DESC);
CREATE INDEX IF NOT EXISTS "Conversation_contactId_idx" ON "Conversation"("contactId");
