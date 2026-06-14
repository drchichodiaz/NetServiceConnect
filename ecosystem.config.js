module.exports = {
  apps: [
    {
      name: 'netservice-api',
      cwd: './apps/backend',
      script: 'dist/main.js',
      interpreter: 'node',
      env: {
        NODE_ENV: 'production',
        PORT: 4000,
      },
      watch: false,
      max_memory_restart: '512M',
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
      max_memory_restart: '512M',
      restart_delay: 3000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
    },
  ],
};
