# Build context: raíz del repo (es un monorepo con npm workspaces).
# docker build -f apps/frontend/Dockerfile .
#
# Los NEXT_PUBLIC_* se hornean en el bundle de cliente EN BUILD TIME, no en runtime —
# por eso van como build args (ver docker-compose.prod.yml), no como `environment:`.

FROM node:20-alpine AS builder
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/frontend/package.json apps/frontend/package.json
RUN npm install -w apps/frontend
COPY apps/frontend apps/frontend

ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_META_APP_ID
ARG NEXT_PUBLIC_META_CONFIG_ID
ARG NEXT_PUBLIC_BRAND_NAME
ARG NEXT_PUBLIC_BRAND_TAGLINE
ARG NEXT_PUBLIC_ENABLE_NETSERVICE_PANEL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_META_APP_ID=$NEXT_PUBLIC_META_APP_ID \
    NEXT_PUBLIC_META_CONFIG_ID=$NEXT_PUBLIC_META_CONFIG_ID \
    NEXT_PUBLIC_BRAND_NAME=$NEXT_PUBLIC_BRAND_NAME \
    NEXT_PUBLIC_BRAND_TAGLINE=$NEXT_PUBLIC_BRAND_TAGLINE \
    NEXT_PUBLIC_ENABLE_NETSERVICE_PANEL=$NEXT_PUBLIC_ENABLE_NETSERVICE_PANEL

WORKDIR /repo/apps/frontend
RUN npm run build

FROM node:20-alpine
WORKDIR /repo
COPY package.json package-lock.json ./
COPY apps/frontend/package.json apps/frontend/package.json
RUN npm install -w apps/frontend --omit=dev
COPY --from=builder /repo/apps/frontend/.next apps/frontend/.next
# No hay carpeta public/ hoy en el proyecto — si se agrega en el futuro, sumar acá
# `COPY apps/frontend/public apps/frontend/public`.

WORKDIR /repo/apps/frontend
EXPOSE 3000
CMD ["npm", "run", "start"]
