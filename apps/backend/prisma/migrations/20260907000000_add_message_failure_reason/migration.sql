-- Motivo de fallo de entrega que manda Meta en el webhook de estado. Se descartaba:
-- el mensaje quedaba en FAILED con un icono rojo y no habia forma de saber por que.
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "failureReason" TEXT;
