-- Nodo de menu que manda una ubicacion, y mensajes de tipo ubicacion (los que manda
-- ese nodo y los que comparte un cliente). Solo agrega valores: no toca filas.
ALTER TYPE "MenuNodeType" ADD VALUE IF NOT EXISTS 'LOCATION';
ALTER TYPE "MessageType" ADD VALUE IF NOT EXISTS 'LOCATION';
