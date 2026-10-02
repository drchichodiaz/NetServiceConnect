-- Reserva de citas desde el bot de WhatsApp: un tipo de nodo, un estado de la
-- conversacion y dos ajustes de la agenda. Aditiva.
ALTER TYPE "MenuNodeType" ADD VALUE IF NOT EXISTS 'BOOK_APPOINTMENT';
ALTER TYPE "ConversationBotState" ADD VALUE IF NOT EXISTS 'AWAITING_BOOKING';

ALTER TABLE "AgendaSettings" ADD COLUMN IF NOT EXISTS "bookingDaysAhead" INTEGER NOT NULL DEFAULT 14;
ALTER TABLE "AgendaSettings" ADD COLUMN IF NOT EXISTS "bookingMinNoticeMinutes" INTEGER NOT NULL DEFAULT 120;
