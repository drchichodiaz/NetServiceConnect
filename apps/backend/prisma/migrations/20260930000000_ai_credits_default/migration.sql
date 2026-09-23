-- Las empresas nuevas nacen manejandose por creditos.
--
-- Cambiar el default NO toca las filas que ya existen: las empresas dadas de alta antes
-- de esto siguen en BYOK hasta que se las pase a mano desde el panel de creditos. Eso
-- es a proposito — migrar a un cliente sin haberle acreditado saldo primero le deja el
-- bot derivando a un agente.
ALTER TABLE "Tenant" ALTER COLUMN "aiBillingMode" SET DEFAULT 'PLATFORM';

-- Creditos de regalo para una cuenta nueva. 0 = ninguno.
ALTER TABLE "SystemConfig" ADD COLUMN IF NOT EXISTS "aiTrialCredits" INTEGER NOT NULL DEFAULT 0;
