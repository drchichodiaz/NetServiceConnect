#!/usr/bin/env bash
# Deploy script para el VPS. Corre: git pull -> generate+migrate+build backend ->
# restart backend -> build frontend -> restart frontend.
# Se corta en el primer error (set -e), asi nunca reinicia un servicio con un build roto.
set -euo pipefail

cd "$(dirname "$0")"

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
