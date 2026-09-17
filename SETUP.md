# NetService Connect — Setup Guide

## Requisitos previos
- Node.js 20+
- PostgreSQL 15+
- Cuenta de desarrollador Meta (Meta for Developers)
- OpenAI API Key

## Estructura del proyecto

```
NetserviceConnect/
├── apps/
│   ├── backend/     # NestJS + Prisma
│   └── frontend/    # Next.js 14
└── package.json     # npm workspaces
```

## 1. Configurar variables de entorno

### Backend
```bash
cp apps/backend/.env.example apps/backend/.env
```

Editar `apps/backend/.env`:
```
DATABASE_URL="postgresql://USER:PASSWORD@localhost:5432/netservice_connect"
JWT_SECRET="genera-un-secreto-largo-y-aleatorio"
META_APP_ID="tu_app_id_de_meta"
META_APP_SECRET="tu_app_secret_de_meta"
META_VERIFY_TOKEN="token-verificacion-webhook"
OPENAI_API_KEY="sk-..."
```

### Frontend
```bash
cp apps/frontend/.env.example apps/frontend/.env.local
```

Editar `apps/frontend/.env.local`:
```
NEXT_PUBLIC_API_URL=http://localhost:3001/api
NEXT_PUBLIC_META_APP_ID=tu_app_id_de_meta
```

## 2. Instalar dependencias

```bash
npm install
```

## 3. Base de datos

```bash
# Crear la base de datos primero en PostgreSQL
createdb netservice_connect

# Generar cliente Prisma y ejecutar migraciones
npm run db:generate
npm run db:migrate

# Seed inicial (tenant demo + admin)
npm run db:seed
```

Credenciales demo: `admin@demo.com` / `admin123`

## 4. Iniciar el proyecto

```bash
# Ambas apps en paralelo
npm run dev

# O por separado
npm run backend    # http://localhost:3001
npm run frontend   # http://localhost:3000
```

## 5. Configurar Meta WhatsApp (Embedded Signup)

### En Meta for Developers:
1. Crear app en https://developers.facebook.com
2. Agregar producto "WhatsApp Business"
3. Configurar el Embedded Signup:
   - En "WhatsApp > Configuration" agregar el dominio del frontend
   - Copiar el App ID al env del frontend
4. Configurar el Webhook:
   - URL: `https://tudominio.com/api/whatsapp/webhook`
   - Verify Token: el valor de `META_VERIFY_TOKEN` de tu .env
   - Suscribir a: `messages`

### Para desarrollo local con ngrok:
```bash
ngrok http 3001
# Usar la URL HTTPS de ngrok como webhook URL en Meta
```

## 6. Conectar WhatsApp en el sistema

1. Iniciar sesión en la plataforma
2. Ir a Settings → WhatsApp
3. Hacer clic en "Conectar con WhatsApp Business"
4. Seguir el flujo de Embedded Signup de Meta
5. El sistema guardará automáticamente la configuración

## API Endpoints

### Auth
- `POST /api/auth/login` — Login
- `POST /api/auth/register` — Registrar usuario
- `GET /api/auth/me` — Usuario actual

### Conversaciones
- `GET /api/conversations` — Lista (filtros: status, assignedUserId, search)
- `GET /api/conversations/:id` — Detalle
- `PATCH /api/conversations/:id` — Actualizar (status, assignedUserId, tagIds)
- `POST /api/conversations/:id/read` — Marcar como leído

### Mensajes
- `GET /api/conversations/:id/messages` — Mensajes con paginación por cursor

### WhatsApp
- `GET /api/whatsapp/webhook` — Verificación del webhook (Meta)
- `POST /api/whatsapp/webhook` — Recibir eventos (Meta)
- `POST /api/whatsapp/send` — Enviar mensaje
- `GET /api/whatsapp/account` — Ver configuración
- `POST /api/whatsapp/connect` — Guardar configuración (Embedded Signup)
- `DELETE /api/whatsapp/account` — Desconectar

### AI
- `POST /api/conversations/:id/ai/suggest` — Sugerencia de respuesta

### Notas internas
- `GET /api/conversations/:id/notes`
- `POST /api/conversations/:id/notes`
- `DELETE /api/conversations/:id/notes/:noteId`

### Usuarios, Tenants
- CRUD estándar en `/api/users`, `/api/tenants`

## Multi-tenancy

Cada usuario tiene `tenantId` en el JWT. Todos los endpoints están aislados por tenant mediante el campo `tenantId` en todas las consultas. El middleware de `JwtAuthGuard` + `JwtStrategy` garantiza que cada request solo acceda a datos de su tenant.

## Arquitectura del flujo de mensajes

```
Meta → POST /api/whatsapp/webhook
         ↓
    WebhookService
         ↓
    Upsert Contact
         ↓
    Find/Create Conversation
         ↓
    Create Message (INBOUND)
         ↓
    Actualizar lastMessageAt en Conversation
```
