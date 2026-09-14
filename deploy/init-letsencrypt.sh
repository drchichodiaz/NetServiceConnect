#!/bin/sh
# Pide el certificado inicial de Let's Encrypt. Se corre UNA sola vez, al instalar el
# server; despues el contenedor certbot renueva solo.
#
#   ./deploy/init-letsencrypt.sh
#
# El huevo y la gallina: nginx no arranca si las rutas de ssl_certificate no existen,
# pero certbot necesita a nginx arriba para responder el desafio HTTP. Por eso se
# crea primero un certificado autofirmado descartable, se levanta nginx con el, y
# recien ahi se pide el de verdad y se recarga.
set -e

cd "$(dirname "$0")/.."

if [ ! -f .env.production ]; then
  echo "Falta .env.production (copiar de .env.production.example)" >&2
  exit 1
fi

# Se leen las dos variables a mano en vez de hacer `. .env.production`: los valores
# del archivo no estan entrecomillados y los que tienen espacios (BRAND_TAGLINE)
# rompen el source.
env_get() {
  grep -E "^$1=" .env.production | tail -1 | cut -d= -f2- | sed 's/\r$//; s/^"//; s/"$//'
}

DOMAIN=$(env_get DOMAIN)
LETSENCRYPT_EMAIL=$(env_get LETSENCRYPT_EMAIL)

if [ -z "$DOMAIN" ] || [ -z "$LETSENCRYPT_EMAIL" ]; then
  echo "Definir DOMAIN y LETSENCRYPT_EMAIL en .env.production" >&2
  exit 1
fi

COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.production --profile nginx"

echo "==> Dominio: $DOMAIN"

if $COMPOSE run --rm --entrypoint sh certbot -c \
    '[ -f /etc/letsencrypt/renewal/connect.conf ]' 2>/dev/null; then
  echo "==> Ya hay un certificado emitido para 'connect', no se toca."
  echo "    Para rehacerlo: docker compose ... run --rm --entrypoint sh certbot -c 'rm -rf /etc/letsencrypt/{live,archive,renewal}/connect*'"
  exit 0
fi

echo "==> Certificado autofirmado temporal, solo para que nginx pueda arrancar"
$COMPOSE run --rm --entrypoint sh certbot -c \
  "mkdir -p /etc/letsencrypt/live/connect && \
   openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
     -keyout /etc/letsencrypt/live/connect/privkey.pem \
     -out /etc/letsencrypt/live/connect/fullchain.pem \
     -subj '/CN=$DOMAIN'"

echo "==> Levantando nginx"
$COMPOSE up -d nginx

echo "==> Descartando el temporal y pidiendo el certificado real"
$COMPOSE run --rm --entrypoint sh certbot -c \
  "rm -rf /etc/letsencrypt/live/connect /etc/letsencrypt/archive/connect /etc/letsencrypt/renewal/connect.conf"

# --entrypoint certbot es obligatorio: `compose run` hereda el entrypoint del
# servicio (el loop de renovacion), asi que sin esto los argumentos de certonly
# le llegan como posicionales al `sh -c`, que los ignora y se queda durmiendo
# 12h. El contenedor no falla: se cuelga.
$COMPOSE run --rm --entrypoint certbot certbot certonly \
  --webroot -w /var/www/certbot \
  --cert-name connect \
  -d "$DOMAIN" \
  --email "$LETSENCRYPT_EMAIL" \
  --agree-tos --no-eff-email --non-interactive

echo "==> Recargando nginx con el certificado real"
$COMPOSE exec nginx nginx -s reload

echo "==> Listo: https://$DOMAIN"
