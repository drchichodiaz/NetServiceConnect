# Build context: raíz del repo (es un monorepo con npm workspaces).
# docker build -f apps/backend/Dockerfile .

# openssl: sin el paquete instalado, Prisma no puede detectar la version de OpenSSL
# de Alpine y por defecto intenta cargar el motor de OpenSSL 1.1 (que no existe acá),
# aunque el binary target correcto ya este generado. Ver schema.prisma binaryTargets.
FROM node:20-alpine AS builder
RUN apk add --no-cache openssl
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/package.json
RUN npm install -w apps/backend
COPY apps/backend apps/backend
WORKDIR /repo/apps/backend
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine
RUN apk add --no-cache openssl
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/backend/package.json apps/backend/package.json
RUN npm install -w apps/backend --omit=dev
COPY apps/backend/prisma apps/backend/prisma
WORKDIR /repo/apps/backend
RUN npx prisma generate
COPY --from=builder /repo/apps/backend/dist ./dist

EXPOSE 3001
CMD ["node", "dist/main"]
