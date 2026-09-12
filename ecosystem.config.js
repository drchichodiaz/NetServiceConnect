// Cantidad de procesos de la API. Por defecto 1, que es el unico valor seguro sin
// Redis: los eventos en vivo del panel (SSE) se reparten en memoria, asi que con
// varios procesos un mensaje recibido por un worker no llegaria a los agentes
// conectados a otro.
//
// Para escalar: levantar Redis, poner REDIS_URL en apps/backend/.env, y recien ahi
// subir API_INSTANCES (ej: API_INSTANCES=max usa todos los nucleos).
const apiInstances = process.env.API_INSTANCES || 1;
const clustered = apiInstances !== 1 && apiInstances !== '1';

module.exports = {
  apps: [
    {
      name: 'netservice-api',
      cwd: './apps/backend',
      script: 'dist/main.js',
      interpreter: 'node',
      instances: apiInstances,
      // En cluster PM2 reparte las conexiones entre los workers; en fork corre uno solo.
      exec_mode: clustered ? 'cluster' : 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
      },
      watch: false,
      // 512M quedaba corto con muchas conexiones SSE abiertas mas Prisma en memoria,
      // y cada reinicio por memoria corta a todos los agentes a la vez.
      max_memory_restart: '1G',
      restart_delay: 3000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
    {
      name: 'netservice-frontend',
      cwd: './apps/frontend',
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
      watch: false,
      max_memory_restart: '1G',
      restart_delay: 3000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
