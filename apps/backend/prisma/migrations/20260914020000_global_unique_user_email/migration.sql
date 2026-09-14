-- El email de un usuario pasa a ser unico en todo el sistema, no por empresa.
--
-- El unique era (tenantId, email), pero el login busca por email SIN tenant y se queda
-- con el primer usuario que encuentra: con el mismo email en dos empresas, una de las
-- dos personas no podia entrar — recibia "credenciales invalidas" aunque su contrasena
-- fuera correcta, porque se comparaba contra la cuenta de la otra empresa.
--
-- Recuperar la contrasena tiene el mismo problema: alguien escribe su email y el sistema
-- tiene que saber de que cuenta se trata. Con esto, no hay ambiguedad que resolver.
--
-- Verificado antes de escribir esta migracion: ni la base local ni la de produccion
-- tienen un email repetido entre empresas, asi que el indice se puede crear sin tocar
-- ningun dato.

DROP INDEX IF EXISTS "User_tenantId_email_key";
CREATE UNIQUE INDEX IF NOT EXISTS "User_email_key" ON "User"("email");
