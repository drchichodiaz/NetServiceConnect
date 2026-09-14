-- Configuracion de correo saliente administrable desde el panel.
--
-- Mismo patron que las credenciales de Meta: lo que este aca tiene prioridad sobre las
-- variables MAIL_* del entorno. Quien tiene acceso al servidor sigue usando el .env;
-- quien no, lo carga desde Configuracion > Sistema.
--
-- mailPass se guarda CIFRADO, no en texto plano: es la credencial que permite mandar
-- correo firmado con el dominio del sistema, y una copia de la base no deberia
-- alcanzar para usarla. La clave de cifrado vive en el .env del servidor.
ALTER TABLE "SystemConfig" ADD COLUMN IF NOT EXISTS "mailHost" TEXT;
ALTER TABLE "SystemConfig" ADD COLUMN IF NOT EXISTS "mailPort" INTEGER;
ALTER TABLE "SystemConfig" ADD COLUMN IF NOT EXISTS "mailUser" TEXT;
ALTER TABLE "SystemConfig" ADD COLUMN IF NOT EXISTS "mailPass" TEXT;
ALTER TABLE "SystemConfig" ADD COLUMN IF NOT EXISTS "mailFrom" TEXT;
