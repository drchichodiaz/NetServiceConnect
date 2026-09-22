-- Varios bots por tenant, asignables por linea.
--
-- El deploy no cambia comportamiento: cada tenant recibe un "Bot principal" con su
-- TenantBotConfig actual (info de IA y modo de arranque), todo su arbol de menu pasa a
-- colgar de ese bot, y las lineas quedan sin bot elegido, o sea que usan el
-- predeterminado. TenantBotConfig no se toca: queda como red de rollback.

-- CreateTable
CREATE TABLE "Bot" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "aiKnowledgeBase" TEXT,
    "startInAiChat" BOOLEAN NOT NULL DEFAULT false,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Bot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Bot_tenantId_idx" ON "Bot"("tenantId");

ALTER TABLE "Bot" ADD CONSTRAINT "Bot_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Un bot por defecto por tenant, con lo que hoy tiene configurado.
INSERT INTO "Bot" ("id", "tenantId", "name", "aiKnowledgeBase", "startInAiChat", "isDefault", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, t."id", 'Bot principal', c."aiKnowledgeBase", COALESCE(c."startInAiChat", false), true, NOW(), NOW()
FROM "Tenant" t
LEFT JOIN "TenantBotConfig" c ON c."tenantId" = t."id";

-- Arbol de menu: cada nodo pasa al bot por defecto de su tenant.
ALTER TABLE "TenantMenuNode" ADD COLUMN "botId" TEXT;

UPDATE "TenantMenuNode" n
SET "botId" = b."id"
FROM "Bot" b
WHERE b."tenantId" = n."tenantId" AND b."isDefault" = true;

ALTER TABLE "TenantMenuNode" ALTER COLUMN "botId" SET NOT NULL;

CREATE INDEX "TenantMenuNode_botId_parentId_idx" ON "TenantMenuNode"("botId", "parentId");

ALTER TABLE "TenantMenuNode" ADD CONSTRAINT "TenantMenuNode_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Lineas: sin bot elegido (= el predeterminado) y con bot activo, como hasta hoy.
ALTER TABLE "ChannelAccount" ADD COLUMN "botEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "botId" TEXT;

ALTER TABLE "ChannelAccount" ADD CONSTRAINT "ChannelAccount_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Conversaciones: las que paso por el bot quedan del bot principal, asi las metricas
-- por bot no arrancan de cero y las que estan a mitad de un menu siguen en su arbol.
ALTER TABLE "Conversation" ADD COLUMN "botId" TEXT;

UPDATE "Conversation" cv
SET "botId" = b."id"
FROM "Bot" b
WHERE b."tenantId" = cv."tenantId"
  AND b."isDefault" = true
  AND (
    cv."mode" = 'BOT'
    OR EXISTS (SELECT 1 FROM "AuditLog" a WHERE a."conversationId" = cv."id" AND a."action" = 'bot.started')
  );

CREATE INDEX "Conversation_botId_idx" ON "Conversation"("botId");

ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_botId_fkey" FOREIGN KEY ("botId") REFERENCES "Bot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
