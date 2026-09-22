-- Avisos de consumo de creditos (50 / 75 / 90 / 100 %).
--
-- Subir un escalon manda el aviso; bajar (una recarga, un ajuste) mueve el umbral hacia
-- abajo en silencio, para que el aviso vuelva a estar disponible cuando el consumo suba
-- otra vez. Eso cumple "una vez por umbral y por ciclo" sin necesitar un motor de
-- suscripciones, que hoy no existe.
ALTER TABLE "AiWallet" ADD COLUMN IF NOT EXISTS "lastAlertThreshold" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AiWallet" ADD COLUMN IF NOT EXISTS "lastAlertAt" TIMESTAMP(3);
