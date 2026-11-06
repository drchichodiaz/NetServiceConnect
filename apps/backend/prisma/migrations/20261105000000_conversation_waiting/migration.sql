-- Quien espera respuesta de una persona, y cuando contesto una persona por ultima vez.
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "waitingSince" TIMESTAMP(3);
ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "lastAgentReplyAt" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "Conversation_tenantId_waitingSince_idx" ON "Conversation"("tenantId", "waitingSince");

-- Ultima respuesta de una persona: un mensaje saliente con autor. El bot, las campañas
-- y los avisos automaticos salen sin autor.
UPDATE "Conversation" c
SET "lastAgentReplyAt" = m.last_at
FROM (
  SELECT "conversationId", MAX("createdAt") AS last_at
  FROM "Message"
  WHERE "direction" = 'OUTBOUND' AND "senderId" IS NOT NULL
  GROUP BY "conversationId"
) m
WHERE m."conversationId" = c."id" AND c."lastAgentReplyAt" IS NULL;

-- Las que hoy estan con el equipo y tienen al cliente sin contestar. Si el bot se la
-- paso a alguien despues de la ultima respuesta de una persona, esperan desde ese
-- traspaso (lo que escribio antes lo atendio el bot); si no, desde el primer mensaje
-- del cliente posterior a esa respuesta.
WITH base AS (
  SELECT c."id", COALESCE(c."lastAgentReplyAt", 'epoch'::timestamp) AS floor_at,
    (SELECT MAX(a."createdAt") FROM "AuditLog" a
      WHERE a."conversationId" = c."id" AND a."action" = 'conversation.bot_handoff'
        AND COALESCE(a."metadata"->>'reason', '') <> 'manual_takeover') AS handoff_at
  FROM "Conversation" c
  WHERE c."status" <> 'CLOSED' AND c."mode" = 'AGENT' AND c."waitingSince" IS NULL
),
w AS (
  SELECT b."id",
    CASE WHEN b.handoff_at > b.floor_at THEN b.handoff_at
      ELSE (SELECT MIN(m."createdAt") FROM "Message" m
            WHERE m."conversationId" = b."id" AND m."direction" = 'INBOUND' AND m."createdAt" > b.floor_at)
    END AS since
  FROM base b
)
UPDATE "Conversation" c SET "waitingSince" = w.since
FROM w WHERE w."id" = c."id" AND w.since IS NOT NULL;
