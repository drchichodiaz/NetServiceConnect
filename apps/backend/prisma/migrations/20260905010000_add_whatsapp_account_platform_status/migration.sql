-- Estado del numero segun Meta, cacheado. Distinto de signupStatus: un numero puede
-- estar dado de alta en el sistema pero sin registrar en la Cloud API, y en ese estado
-- no puede enviar mensajes. Sin esto no habia forma de ver ese hueco desde el panel.
ALTER TABLE "WhatsAppAccount" ADD COLUMN IF NOT EXISTS "platformStatus" TEXT;
ALTER TABLE "WhatsAppAccount" ADD COLUMN IF NOT EXISTS "statusCheckedAt" TIMESTAMP(3);
