-- Texto con el que el bot presenta el menu principal. NULL = el saludo por defecto.
ALTER TABLE "Bot" ADD COLUMN IF NOT EXISTS "menuGreeting" TEXT;
