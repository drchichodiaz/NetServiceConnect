-- Medicion del consumo de IA (fase 0 del motor de creditos).
--
-- Aditiva y sin backfill: nadie paga nada todavia. Lo unico que cambia es que cada
-- llamada a OpenAI deja una fila con sus tokens, su costo y los creditos que
-- corresponderian si el cobro estuviera activo (AiUsage.billed = false).
--
-- Los parametros comerciales van en SystemConfig y no en el codigo porque son precio,
-- no logica: se ajustan sin redeploy y quedan iguales en los dos entornos.

-- CreateTable: precios por modelo, en USD por millon de tokens.
CREATE TABLE IF NOT EXISTS "AiPrice" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'openai',
    "model" TEXT NOT NULL,
    "inputPerMTok" DECIMAL(12,6) NOT NULL,
    "cachedInputPerMTok" DECIMAL(12,6) NOT NULL,
    "outputPerMTok" DECIMAL(12,6) NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiPrice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AiPrice_provider_model_effectiveFrom_key"
    ON "AiPrice"("provider", "model", "effectiveFrom");
CREATE INDEX IF NOT EXISTS "AiPrice_provider_model_effectiveFrom_idx"
    ON "AiPrice"("provider", "model", "effectiveFrom");

-- CreateTable: una fila por llamada al proveedor, exitosa o fallida.
CREATE TABLE IF NOT EXISTS "AiUsage" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "feature" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'openai',
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "cachedInputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costMicros" INTEGER NOT NULL DEFAULT 0,
    "priceId" TEXT,
    "markupFactor" DECIMAL(6,3) NOT NULL,
    "credits" INTEGER NOT NULL DEFAULT 0,
    "billed" BOOLEAN NOT NULL DEFAULT false,
    "requestId" TEXT NOT NULL,
    "providerRequestId" TEXT,
    "conversationId" TEXT,
    "userId" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "AiUsage_requestId_key" ON "AiUsage"("requestId");
CREATE INDEX IF NOT EXISTS "AiUsage_tenantId_createdAt_idx" ON "AiUsage"("tenantId", "createdAt");
CREATE INDEX IF NOT EXISTS "AiUsage_tenantId_feature_createdAt_idx" ON "AiUsage"("tenantId", "feature", "createdAt");
CREATE INDEX IF NOT EXISTS "AiUsage_createdAt_idx" ON "AiUsage"("createdAt");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AiUsage_tenantId_fkey') THEN
    ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_tenantId_fkey"
      FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  -- El precio no se borra nunca (la tabla es inmutable), pero si alguien lo borrara a
  -- mano el uso tiene que sobrevivir: los tokens son la fuente de verdad, el costo es
  -- un derivado que se puede recalcular.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AiUsage_priceId_fkey') THEN
    ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_priceId_fkey"
      FOREIGN KEY ("priceId") REFERENCES "AiPrice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AiUsage_conversationId_fkey') THEN
    ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_conversationId_fkey"
      FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'AiUsage_userId_fkey') THEN
    ALTER TABLE "AiUsage" ADD CONSTRAINT "AiUsage_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Parametros comerciales del motor de creditos.
ALTER TABLE "SystemConfig" ADD COLUMN IF NOT EXISTS "aiMarkupFactor" DECIMAL(6,3) NOT NULL DEFAULT 2;
ALTER TABLE "SystemConfig" ADD COLUMN IF NOT EXISTS "aiCreditUsdValue" DECIMAL(12,6) NOT NULL DEFAULT 0.001;
ALTER TABLE "SystemConfig" ADD COLUMN IF NOT EXISTS "aiMinCreditsPerOp" INTEGER NOT NULL DEFAULT 1;

-- Precios de partida de los tres modelos que el sistema ofrece hoy, en USD por millon
-- de tokens, con vigencia retroactiva para que cualquier uso encuentre una fila.
--
-- VERIFICAR contra la lista publica vigente antes de cobrar: aca no se editan, se
-- agrega una fila nueva con otro effectiveFrom y esta queda como historico.
INSERT INTO "AiPrice" ("id", "provider", "model", "inputPerMTok", "cachedInputPerMTok", "outputPerMTok", "effectiveFrom", "source")
VALUES
  ('aiprice_openai_gpt4omini_v1', 'openai', 'gpt-4o-mini',  0.150000,  0.075000,  0.600000, '2020-01-01 00:00:00', 'Lista publica OpenAI (carga inicial, verificar)'),
  ('aiprice_openai_gpt4o_v1',     'openai', 'gpt-4o',       2.500000,  1.250000, 10.000000, '2020-01-01 00:00:00', 'Lista publica OpenAI (carga inicial, verificar)'),
  ('aiprice_openai_gpt4turbo_v1', 'openai', 'gpt-4-turbo', 10.000000, 10.000000, 30.000000, '2020-01-01 00:00:00', 'Lista publica OpenAI (carga inicial, verificar)')
ON CONFLICT DO NOTHING;
