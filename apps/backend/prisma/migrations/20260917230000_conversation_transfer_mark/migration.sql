-- Marca de traspaso en la bandeja.
--
-- assignedAt: cuando la conversacion paso a manos de quien la tiene asignada.
-- assignedSeenAt: cuando esa persona la abrio despues de ese traspaso.
-- Mientras assignedSeenAt sea NULL o anterior a assignedAt, la conversacion se muestra
-- como recien transferida.
--
-- IF NOT EXISTS por el drift historico de produccion (hubo `prisma db push` sin archivo
-- de migracion antes de 2026-07-08): la columna podria existir ya en algun entorno y
-- sin la guarda el deploy se cae.
--
-- Ambas quedan NULL en las filas existentes, que es exactamente lo que se quiere: nada
-- de lo que ya estaba asignado aparece como transferido de golpe al desplegar.
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "assignedAt" TIMESTAMP(3);
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "assignedSeenAt" TIMESTAMP(3);
