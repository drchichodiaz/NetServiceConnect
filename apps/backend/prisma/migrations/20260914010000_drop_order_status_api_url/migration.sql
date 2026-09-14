-- Quita TenantBotConfig.orderStatusApiUrl.
--
-- Era de antes del arbol de menu: un endpoint de consulta de pedidos por tenant. La
-- funcion existe, pero por nodo — un MenuNode de tipo ORDER_LOOKUP guarda su apiUrl y
-- su plantilla de respuesta en `config`, y LookupService es quien la ejecuta. Esta
-- columna, en cambio, nunca la leyo nadie: solo viajaba del formulario a la base.
--
-- El campo ya estaba deshabilitado en el panel y marcado como "Proximamente", asi que
-- no hay valores que valga la pena conservar.
ALTER TABLE "TenantBotConfig" DROP COLUMN IF EXISTS "orderStatusApiUrl";
