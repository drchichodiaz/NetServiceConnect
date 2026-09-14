-- Permisos por linea: que lineas puede ver cada usuario.
--
-- La ausencia de filas ES el permiso: un usuario sin ninguna fila ve todas las lineas
-- del tenant. Por eso esta migracion no necesita backfill y no le cambia el acceso a
-- nadie — limitar a alguien pasa a ser una accion explicita.

CREATE TABLE IF NOT EXISTS "UserChannelAccount" (
    "userId"           TEXT NOT NULL,
    "channelAccountId" TEXT NOT NULL,
    "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserChannelAccount_pkey" PRIMARY KEY ("userId", "channelAccountId")
);

CREATE INDEX IF NOT EXISTS "UserChannelAccount_userId_idx"           ON "UserChannelAccount"("userId");
CREATE INDEX IF NOT EXISTS "UserChannelAccount_channelAccountId_idx" ON "UserChannelAccount"("channelAccountId");

-- Las dos en cascada: si se borra el usuario o la linea, la asignacion no tiene sentido.
DO $$ BEGIN
    ALTER TABLE "UserChannelAccount" ADD CONSTRAINT "UserChannelAccount_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
    ALTER TABLE "UserChannelAccount" ADD CONSTRAINT "UserChannelAccount_channelAccountId_fkey"
      FOREIGN KEY ("channelAccountId") REFERENCES "ChannelAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
