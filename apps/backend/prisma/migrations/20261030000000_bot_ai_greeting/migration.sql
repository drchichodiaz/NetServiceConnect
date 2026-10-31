-- Primer mensaje de un bot que arranca en chat con IA
ALTER TABLE "Bot" ADD COLUMN IF NOT EXISTS "aiGreeting" TEXT;
