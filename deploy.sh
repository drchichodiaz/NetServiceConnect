#!/usr/bin/env bash
# Deploy script para el VPS. Corre: git pull -> generate+migrate+build backend ->
# restart backend -> build frontend -> restart frontend.
# Se corta en el primer error (set -e), asi nunca reinicia un servicio con un build roto.
set -euo pipefail

cd "$(dirname "$0")"

# `npm install` reescribe package-lock.json al resolver dependencias en esta maquina,
# asi que el siguiente pull choca contra esa modificacion local y aborta. El server es
# un destino de deploy, no una maquina de desarrollo: lo que esta en el repo manda.
echo "==> descartando cambios locales del lockfile"
git checkout -- package-lock.json

echo "==> git pull"
git pull origin main

echo "==> instalando dependencias (raiz, workspaces)"
npm install

echo "==> backend: prisma generate + migrate deploy"
cd apps/backend
npx prisma generate
npx prisma migrate deploy

echo "==> backend: build"
npm run build

echo "==> backend: restart (pm2)"
pm2 restart netservice-api

echo "==> frontend: build"
cd ../frontend
npm run build

echo "==> frontend: restart (pm2)"
pm2 restart netservice-frontend

cd ..
echo "==> listo"
pm2 status
