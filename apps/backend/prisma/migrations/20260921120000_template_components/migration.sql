-- Componentes completos de plantilla: encabezado (texto o imagen), pie y botones.
--
-- Hasta ahora una MessageTemplate solo guardaba el BODY, asi que el alta contra Meta
-- mandaba un unico componente y el envio un unico bloque de parametros. Estas columnas
-- son lo que falta para armar los otros tres.
--
-- headerMediaIds cachea el media id que Meta devuelve al subir la imagen, por linea:
-- ese id vive ~30 dias y es por numero de telefono, no por WABA.
--
-- IF NOT EXISTS por el drift historico de produccion (hubo `prisma db push` sin archivo
-- de migracion antes de 2026-07-08).
--
-- Todas nullable y sin default: una plantilla existente queda exactamente como estaba
-- (solo body), que es el comportamiento previo.
ALTER TABLE "MessageTemplate" ADD COLUMN IF NOT EXISTS "headerFormat" TEXT;
ALTER TABLE "MessageTemplate" ADD COLUMN IF NOT EXISTS "headerText" TEXT;
ALTER TABLE "MessageTemplate" ADD COLUMN IF NOT EXISTS "headerMediaPath" TEXT;
ALTER TABLE "MessageTemplate" ADD COLUMN IF NOT EXISTS "headerMediaMime" TEXT;
ALTER TABLE "MessageTemplate" ADD COLUMN IF NOT EXISTS "headerMediaIds" JSONB;
ALTER TABLE "MessageTemplate" ADD COLUMN IF NOT EXISTS "footerText" TEXT;
ALTER TABLE "MessageTemplate" ADD COLUMN IF NOT EXISTS "buttons" JSONB;
