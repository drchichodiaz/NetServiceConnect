# Deploy con Docker

Camino containerizado, alternativo a `deploy.ps1` (VPS Windows con PM2). Todo el stack
—Postgres, Redis, backend, frontend y, si hace falta, nginx— corre en contenedores.

Hay dos escenarios y se diferencian por **una sola cosa**: quien es dueno de los
puertos 80/443.

| | Server dedicado | Box compartido |
|---|---|---|
| nginx | el del compose (perfil `nginx`) | uno ajeno, que ya esta corriendo |
| Comando | `--profile nginx` | sin perfil |
| Certificado | certbot en el compose | lo maneja el otro stack |

## Server dedicado (instalacion desde cero)

```bash
# 1. Docker
curl -fsSL https://get.docker.com | sh

# 2. Codigo
git clone https://github.com/drchichodiaz/NetServiceConnect.git /opt/netservice-connect
cd /opt/netservice-connect

# 3. Config
cp .env.production.example .env.production
$EDITOR .env.production          # DOMAIN, DB_PASSWORD, JWT_SECRET, FRONTEND_URL, NEXT_PUBLIC_API_URL
cp .env.production .env          # compose lee .env solo para sustituir ${VAR}

# 4. Build y arranque (sin nginx todavia)
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build

# 5. Certificado + nginx. El DNS de DOMAIN ya tiene que apuntar a este server.
./deploy/init-letsencrypt.sh
```

`FRONTEND_URL` y `NEXT_PUBLIC_API_URL` tienen que coincidir con `DOMAIN`
(`https://DOMAIN` y `https://DOMAIN/api`). El primero es el origin que el backend
permite por CORS; el segundo se **hornea en el bundle del frontend en build time**, asi
que cambiarlo despues obliga a `docker compose build frontend`, no alcanza con un
restart.

## Actualizar

```bash
cd /opt/netservice-connect
git checkout -- package-lock.json   # npm lo reescribe en el server y aborta el pull
git pull
docker compose -f docker-compose.prod.yml --env-file .env.production --profile nginx up -d --build
```

En el box compartido, el mismo comando sin `--profile nginx`.

Las migraciones de Prisma corren solas al arrancar el contenedor del backend
(`prisma migrate deploy && node dist/main`). Si fallan, el backend no levanta — a
proposito, es preferible a servir contra una base a medio migrar.

## Verificar que quedo bien

```bash
docker compose -f docker-compose.prod.yml ps
curl -sk -o /dev/null -w '%{http_code}\n' https://DOMAIN/api/auth/me   # 401 esta bien, 502 no
docker logs netservice_backend | grep 'Eventos en vivo'                # debe decir "modo Redis"
```

El **502 en `/api/` con la pagina cargando igual** es el sintoma clasico de nginx con la
IP del backend cacheada; la pagina carga porque eso lo sirve el frontend. La config de
`deploy/nginx/default.conf` ya lo evita con `resolver 127.0.0.11`. Si el proxy es el de
otro stack y no tiene resolver, el parche es `docker exec <nginx> nginx -s reload`.

## Migrar datos desde otro entorno

No alcanza con la base. Son tres cosas:

1. **Base**: `pg_dump` en origen, `psql` contra el contenedor `netservice_db`.
2. **`JWT_SECRET`**: conservar el mismo. Si cambia, se desloguean todos los usuarios.
3. **Adjuntos**: copiar los archivos al volumen `netservice_media` y actualizar su ruta
   desde *Configuracion > Sistema* — esa ruta esta en la base, no en el `.env`.
