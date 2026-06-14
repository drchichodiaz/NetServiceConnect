import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { randomBytes } from 'crypto';
import { adminService } from '../admin/AdminService';
import { whatsAppService } from '../whatsapp/WhatsAppService';
import { whatsAppTemplateService } from '../whatsapp/WhatsAppTemplateService';
import { googleCalendarService } from '../calendar/GoogleCalendarService';
import { eventBus, AppEvent } from '../events/EventBus';
import { config } from '../config';
import { format } from 'date-fns';
import { requireAuth, hashPassword, checkPasswordHash } from '../middleware/requireAuth';
import { prisma } from '../lib/prisma';

const statusValues = ['booked', 'completed', 'no_show', 'cancelled'] as const;

// ─── Auth helpers ─────────────────────────────────────────────────────────────

/** Devuelve el tenantId correcto según el rol del usuario autenticado:
 *  - tenant:      usa siempre el tenantId del JWT (no se puede suplantar)
 *  - super_admin: usa el ?tenantId= de la query, o DEFAULT_TENANT_ID como fallback
 */
function getTenantId(req: FastifyRequest): string {
  if (req.user?.role === 'tenant' && req.user.tenantId) return req.user.tenantId;
  const query = req.query as Record<string, string>;
  return query.tenantId ?? config.DEFAULT_TENANT_ID;
}

function guardSuperAdmin(req: FastifyRequest, reply: FastifyReply): boolean {
  if (req.user?.role !== 'super_admin') {
    reply.code(403).send({ error: 'Solo el super-admin puede realizar esta acción.' });
    return false;
  }
  return true;
}

function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  return Array.from(randomBytes(12)).map(b => chars[b % chars.length]).join('');
}

function generateUsername(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30);
}

export async function adminRoutes(app: FastifyInstance) {
  // Todas las rutas /admin/* requieren token JWT válido
  app.addHook('preHandler', requireAuth);

  // ── SSE: stream de eventos en tiempo real ─────────────────────────────────
  // GET /admin/events?tenantId=
  // El browser abre esta conexión una sola vez y recibe eventos push del servidor.
  app.get('/admin/events', async (req, reply) => {
    const query    = req.query as Record<string, string>;
    const tenantId = getTenantId(req);

    // Cabeceras SSE
    reply.raw.writeHead(200, {
      'Content-Type':                'text/event-stream',
      'Cache-Control':               'no-cache',
      'Connection':                  'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering':           'no', // desactiva buffering en nginx
    });

    // Helper para enviar un evento al cliente
    const send = (event: AppEvent) => {
      reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    // Heartbeat cada 25s para mantener la conexión viva (proxies cierran a los 30s)
    const heartbeat = setInterval(() => {
      reply.raw.write(': heartbeat\n\n');
    }, 25_000);

    // Suscribirse solo a eventos del tenant de este cliente
    const listener = (event: AppEvent) => {
      if (event.tenantId === tenantId || event.tenantId === 'system') {
        send(event);
      }
    };

    eventBus.on('app_event', listener);

    // Limpiar cuando el cliente desconecta
    req.raw.on('close', () => {
      clearInterval(heartbeat);
      eventBus.off('app_event', listener);
    });

    // Evento inicial para confirmar conexión
    reply.raw.write(`data: ${JSON.stringify({ type: 'connected', tenantId, ts: Date.now() })}\n\n`);

    // Mantener la respuesta abierta indefinidamente
    await new Promise(() => {/* never resolves — SSE stays open */});
  });

  // GET /admin/dashboard?date=YYYY-MM-DD&tenantId=
  app.get('/admin/dashboard', async (req, reply) => {
    const query = req.query as Record<string, string>;
    const tenantId = getTenantId(req);
    const date     = query.date     ?? format(new Date(), 'yyyy-MM-dd');

    try {
      const stats = await adminService.getDashboard(tenantId, date);
      return reply.send(stats);
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Error al cargar dashboard.' });
    }
  });

  // GET /admin/appointments?date=&from=&to=&status=&tenantId=&professionalId=
  app.get('/admin/appointments', async (req, reply) => {
    const query = req.query as Record<string, string>;
    const tenantId = getTenantId(req);

    try {
      const appointments = await adminService.listAppointments({
        tenantId,
        date:           query.date,
        from:           query.from,
        to:             query.to,
        status:         query.status,
        professionalId: query.professionalId,
      });
      return reply.send({ appointments });
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Error al listar citas.' });
    }
  });

  // GET /admin/appointments/export?from=&to=&status=&professionalId=&tenantId=
  app.get('/admin/appointments/export', async (req, reply) => {
    const query    = req.query as Record<string, string>;
    const tenantId = getTenantId(req);

    const from = query.from ? new Date(query.from) : new Date(Date.now() - 30 * 86400000);
    const to   = query.to   ? new Date(query.to)   : new Date();
    to.setHours(23, 59, 59, 999);

    const where: Record<string, any> = {
      tenantId,
      startTime: { gte: from, lte: to },
    };
    if (query.status)         where.status         = query.status;
    if (query.professionalId) where.professionalId = query.professionalId;

    const rows = await prisma.appointment.findMany({
      where,
      orderBy: { startTime: 'asc' },
      include: { professional: { select: { name: true } } },
    });

    const escCsv = (v: string | null | undefined) => {
      if (v == null) return '';
      const s = String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"`
        : s;
    };

    const header = ['ID', 'Fecha', 'Hora inicio', 'Hora fin', 'Paciente', 'Teléfono', 'Servicio', 'Especialidad', 'Profesional', 'Estado', 'Notas', 'Creado'].join(',');

    const lines = rows.map(r => [
      r.id,
      format(r.startTime, 'yyyy-MM-dd'),
      format(r.startTime, 'HH:mm'),
      format(r.endTime,   'HH:mm'),
      r.patientName,
      r.patientPhone ?? '',
      r.service,
      r.specialty ?? '',
      r.professional.name,
      r.status,
      r.notes ?? '',
      format(r.createdAt, 'yyyy-MM-dd HH:mm'),
    ].map(escCsv).join(','));

    const csv      = [header, ...lines].join('\r\n');
    const filename = `citas_${format(from, 'yyyy-MM-dd')}_${format(to, 'yyyy-MM-dd')}.csv`;

    return reply
      .header('Content-Type', 'text/csv; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send('﻿' + csv); // BOM para Excel en español
  });

  // GET /admin/appointments/pending?tenantId=
  app.get('/admin/appointments/pending', async (req, reply) => {
    const tenantId = getTenantId(req);
    try {
      const appointments = await adminService.listPendingAppointments(tenantId);
      return reply.send({ appointments });
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Error al listar citas pendientes.' });
    }
  });

  // POST /admin/appointments/:id/approve
  app.post<{ Params: { id: string } }>('/admin/appointments/:id/approve', async (req, reply) => {
    const tenantId = getTenantId(req);
    try {
      const result = await adminService.approveAppointment(req.params.id, tenantId);
      if (!result.success) return reply.code(400).send({ error: result.error });
      return reply.send({ success: true });
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Error al aprobar la cita.' });
    }
  });

  // POST /admin/appointments/:id/reject
  app.post<{ Params: { id: string } }>('/admin/appointments/:id/reject', async (req, reply) => {
    const tenantId = getTenantId(req);
    try {
      const result = await adminService.rejectAppointment(req.params.id, tenantId);
      if (!result.success) return reply.code(400).send({ error: result.error });
      return reply.send({ success: true });
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Error al rechazar la cita.' });
    }
  });

  // PATCH /admin/appointments/:id/reschedule
  app.patch<{ Params: { id: string } }>('/admin/appointments/:id/reschedule', async (req, reply) => {
    const tenantId = getTenantId(req);
    const schema = z.object({
      startTime: z.string().datetime(),
      endTime:   z.string().datetime().nullable().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });

    const newStart = new Date(parsed.data.startTime);
    const newEnd   = parsed.data.endTime
      ? new Date(parsed.data.endTime)
      : new Date(newStart.getTime() + 30 * 60 * 1000); // fallback: +30min

    try {
      const result = await adminService.rescheduleAppointment(req.params.id, tenantId, newStart, newEnd);
      if (!result.success) return reply.code(400).send({ error: result.error });
      return reply.send({ success: true });
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Error al reprogramar la cita.' });
    }
  });

  // GET /admin/settings?tenantId=
  app.get('/admin/settings', async (req, reply) => {
    const tenantId = getTenantId(req);
    try {
      const settings = await adminService.getTenantSettings(tenantId);
      if (!settings) return reply.code(404).send({ error: 'Clínica no encontrada.' });
      return reply.send(settings);
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Error al cargar configuración.' });
    }
  });

  // PATCH /admin/settings?tenantId=
  app.patch('/admin/settings', async (req, reply) => {
    const tenantId = getTenantId(req);
    const schema = z.object({
      supervisedMode: z.boolean().optional(),
      name:           z.string().min(1).optional(),
      timezone:       z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
    try {
      const result = await adminService.updateTenantSettings(tenantId, parsed.data);
      if (!result.success) return reply.code(400).send({ error: result.error });
      return reply.send({ success: true });
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Error al actualizar configuración.' });
    }
  });

  // GET /admin/appointments/:id?tenantId=
  app.get<{ Params: { id: string } }>('/admin/appointments/:id', async (req, reply) => {
    const query    = req.query as Record<string, string>;
    const tenantId = getTenantId(req);

    try {
      const detail = await adminService.getAppointmentDetail(req.params.id, tenantId);
      if (!detail) return reply.code(404).send({ error: 'Cita no encontrada.' });
      return reply.send(detail);
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Error al cargar detalle de cita.' });
    }
  });

  // ── Profesionales ──────────────────────────────────────────────────────────

  // GET /admin/professionals?tenantId=
  app.get('/admin/professionals', async (req, reply) => {
    const query    = req.query as Record<string, string>;
    const tenantId = getTenantId(req);
    try {
      const professionals = await adminService.listProfessionals(tenantId);
      return reply.send({ professionals });
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Error al listar profesionales.' });
    }
  });

  // GET /admin/professionals/:id?tenantId=
  app.get<{ Params: { id: string } }>('/admin/professionals/:id', async (req, reply) => {
    const query    = req.query as Record<string, string>;
    const tenantId = getTenantId(req);
    try {
      const prof = await adminService.getProfessional(req.params.id, tenantId);
      if (!prof) return reply.code(404).send({ error: 'Profesional no encontrado.' });
      return reply.send(prof);
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Error al cargar profesional.' });
    }
  });

  // PATCH /admin/professionals/:id
  app.patch<{ Params: { id: string } }>('/admin/professionals/:id', async (req, reply) => {
    const bodySchema = z.object({
      tenantId:  z.string().optional(),
      name:      z.string().optional(),
      specialty: z.string().optional(),
      email:     z.string().email().nullable().optional(),
      schedule:  z.record(z.unknown()).optional(),
      services:  z.array(z.object({
        id:              z.string(),
        name:            z.string(),
        durationMinutes: z.number(),
        price:           z.number(),
      })).optional(),
    });

    const parse = bodySchema.safeParse(req.body);
    if (!parse.success) {
      return reply.code(400).send({ error: 'Datos inválidos.', details: parse.error.flatten() });
    }

    const tenantId = getTenantId(req);
    try {
      const result = await adminService.updateProfessional(req.params.id, tenantId, parse.data);
      if (!result.success) return reply.code(404).send({ error: result.error });
      return reply.send({ ok: true });
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Error al actualizar profesional.' });
    }
  });

  // POST /admin/professionals
  app.post('/admin/professionals', async (req, reply) => {
    const bodySchema = z.object({
      tenantId:  z.string().optional(),
      name:      z.string().min(1),
      specialty: z.string().min(1),
      email:     z.string().email().optional(),
      schedule:  z.record(z.unknown()),
      services:  z.array(z.object({
        id:              z.string(),
        name:            z.string(),
        durationMinutes: z.number(),
        price:           z.number(),
      })).optional(),
    });

    const parse = bodySchema.safeParse(req.body);
    if (!parse.success) {
      return reply.code(400).send({ error: 'Datos inválidos.', details: parse.error.flatten() });
    }

    const tenantId = getTenantId(req);
    try {
      const count = await prisma.professional.count({ where: { tenantId } });
      if (count >= 3) {
        return reply.code(403).send({ error: 'Tu plan incluye hasta 3 profesionales. Elimina uno antes de agregar otro.' });
      }
      const prof = await adminService.createProfessional(tenantId, parse.data);
      return reply.code(201).send(prof);
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Error al crear profesional.' });
    }
  });

  // PATCH /admin/appointments/:id/status
  app.patch<{ Params: { id: string } }>('/admin/appointments/:id/status', async (req, reply) => {
    const bodySchema = z.object({
      status:   z.enum(statusValues),
      notes:    z.string().optional(),
      tenantId: z.string().optional(),
    });

    const parse = bodySchema.safeParse(req.body);
    if (!parse.success) {
      return reply.code(400).send({ error: 'Datos inválidos.', details: parse.error.flatten() });
    }

    const { status, notes } = parse.data;
    const tenantId = getTenantId(req);

    try {
      const result = await adminService.updateStatus({
        appointmentId: req.params.id,
        tenantId,
        status,
        notes,
      });

      if (!result.success) return reply.code(400).send({ error: result.error });
      return reply.send({ ok: true });
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Error al actualizar estado.' });
    }
  });

  // ── Tenant config (tenant propio) ────────────────────────────────────────────

  // GET /admin/tenant — info del tenant actual (name, timezone)
  app.get('/admin/tenant', async (req, reply) => {
    const tenantId = getTenantId(req);
    try {
      const tenant = await prisma.tenant.findUnique({
        where:  { id: tenantId },
        select: {
          id: true, name: true, timezone: true, adminEmail: true, createdAt: true,
          emailVerified: true,
          trialEndsAt: true, trialAppointmentsUsed: true, trialAppointmentsLimit: true,
        },
      });
      if (!tenant) return reply.code(404).send({ error: 'Tenant no encontrado.' });
      return reply.send(tenant);
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Error al obtener información.' });
    }
  });

  // PATCH /admin/tenant — actualizar nombre, zona horaria y email de recuperación
  app.patch('/admin/tenant', async (req, reply) => {
    const tenantId = getTenantId(req);
    const parse = z.object({
      name:       z.string().min(1).optional(),
      timezone:   z.string().optional(),
      adminEmail: z.string().email().optional().nullable(),
    }).safeParse(req.body);

    if (!parse.success) return reply.code(400).send({ error: 'Datos inválidos.' });

    try {
      const updated = await prisma.tenant.update({
        where: { id: tenantId },
        data:  parse.data,
      });
      return reply.send({ ok: true, name: updated.name });
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Error al actualizar.' });
    }
  });

  // PATCH /admin/tenant/password — cambiar contraseña (solo tenant, no super_admin)
  app.patch('/admin/tenant/password', async (req, reply) => {
    if (req.user.role !== 'tenant') {
      return reply.code(403).send({ error: 'El super-admin cambia su contraseña en el .env.' });
    }

    const parse = z.object({
      currentPassword: z.string().min(1),
      newPassword:     z.string().min(6),
    }).safeParse(req.body);

    if (!parse.success) return reply.code(400).send({ error: 'Datos inválidos. La nueva contraseña debe tener al menos 6 caracteres.' });

    const tenant = await prisma.tenant.findUnique({ where: { id: req.user.tenantId } });
    if (!tenant?.adminPasswordHash || !checkPasswordHash(parse.data.currentPassword, tenant.adminPasswordHash)) {
      return reply.code(401).send({ error: 'Contraseña actual incorrecta.' });
    }

    await prisma.tenant.update({
      where: { id: req.user.tenantId },
      data:  { adminPasswordHash: hashPassword(parse.data.newPassword) },
    });

    return reply.send({ ok: true });
  });

  // ── Tenants (super-admin) ──────────────────────────────────────────────────

  // GET /admin/tenants  — solo super_admin
  app.get('/admin/tenants', async (req, reply) => {
    if (!guardSuperAdmin(req, reply)) return;
    try {
      const tenants = await adminService.listTenants();
      return reply.send({ tenants });
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Error al listar tenants.' });
    }
  });

  // POST /admin/tenants  — solo super_admin
  app.post('/admin/tenants', async (req, reply) => {
    if (!guardSuperAdmin(req, reply)) return;

    const daySchema = z.object({
      active: z.boolean(),
      slots:  z.array(z.object({ start: z.string(), end: z.string() })),
    });

    const parse = z.object({
      name:          z.string().min(1),
      timezone:      z.string().default('America/Bogota'),
      profName:      z.string().min(1),
      profSpecialty: z.string().min(1),
      services:      z.array(z.object({ name: z.string().min(1), durationMinutes: z.number().min(5) })).min(1),
      schedule:      z.object({
        monday: daySchema, tuesday: daySchema, wednesday: daySchema,
        thursday: daySchema, friday: daySchema, saturday: daySchema, sunday: daySchema,
      }),
    }).safeParse(req.body);

    if (!parse.success) {
      return reply.code(400).send({ error: 'Datos inválidos.', details: parse.error.flatten() });
    }

    try {
      // Generar credenciales de acceso para el tenant
      const baseUsername    = generateUsername(parse.data.name);
      const existing        = await prisma.tenant.findUnique({ where: { adminUsername: baseUsername } });
      const adminUsername   = existing ? `${baseUsername}-${Date.now().toString(36)}` : baseUsername;
      const tempPassword    = generatePassword();
      const adminPasswordHash = hashPassword(tempPassword);

      const result = await adminService.createTenant({
        ...parse.data,
        adminUsername,
        adminPasswordHash,
      });

      return reply.code(201).send({
        ...result,
        credentials: { username: adminUsername, password: tempPassword },
      });
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Error al crear tenant.' });
    }
  });

  // ── WhatsApp config ────────────────────────────────────────────────────────

  // GET /admin/whatsapp/status?tenantId=
  app.get('/admin/whatsapp/status', async (req, reply) => {
    const query    = req.query as Record<string, string>;
    const tenantId = getTenantId(req);
    try {
      const cfg = await whatsAppService.getConfig(tenantId);
      const meta = {
        appId:            config.APP_ID || null,
        embeddedConfigId: config.WHATSAPP_EMBEDDED_CONFIG_ID || null,
        apiVersion:       config.META_API_VERSION,
      };
      if (!cfg) return reply.send({ connected: false, ...meta });
      return reply.send({
        connected:     true,
        displayPhone:  cfg.displayPhone,
        phoneNumberId: cfg.phoneNumberId,
        wabaId:        cfg.wabaId,
        ...meta,
      });
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Error al obtener estado.' });
    }
  });

  // POST /admin/whatsapp/embedded-signup
  // Recibe el código OAuth del Embedded Signup de Meta, lo intercambia por un token
  // y guarda la configuración de WhatsApp automáticamente.
  app.post('/admin/whatsapp/embedded-signup', async (req, reply) => {
    const parse = z.object({
      code:          z.string().min(1),
      tenantId:      z.string().optional(),
      // Session info enviado por el frontend desde el postMessage de Meta (sessionInfoVersion 3)
      wabaId:        z.string().optional(),
      phoneNumberId: z.string().optional(),
    }).safeParse(req.body);

    if (!parse.success) return reply.code(400).send({ error: 'Datos inválidos.' });

    const tenantId = getTenantId(req);
    const BASE     = `https://graph.facebook.com/${config.META_API_VERSION}`;
    const { wabaId: sessionWabaId, phoneNumberId: sessionPhoneId } = parse.data;

    try {
      // 1. Intercambiar código por access token de corta duración
      const tokenRes  = await fetch(`https://graph.facebook.com/oauth/access_token?client_id=${config.APP_ID}&client_secret=${config.APP_SECRET}&code=${parse.data.code}`);
      const tokenData = await tokenRes.json() as { access_token?: string; error?: { message: string } };
      if (!tokenData.access_token) {
        return reply.code(400).send({ error: tokenData.error?.message ?? 'Error al obtener token de Meta.' });
      }

      // 2. Extender el token a largo plazo (~60 días)
      const extendRes  = await fetch(`https://graph.facebook.com/oauth/access_token?grant_type=fb_exchange_token&client_id=${config.APP_ID}&client_secret=${config.APP_SECRET}&fb_exchange_token=${tokenData.access_token}`);
      const extendData = await extendRes.json() as { access_token?: string };
      const longToken  = extendData.access_token ?? tokenData.access_token;

      // 3 + 4. Si tenemos session info del postMessage, usarlos directamente sin llamar a Meta
      let wabaId     = sessionWabaId;
      let phoneId    = sessionPhoneId;
      let displayPhone = '';

      if (!wabaId || !phoneId) {
        // Fallback: obtener WABA ID de los permisos granulares
        const scopesRes  = await fetch(`${BASE}/me?fields=granular_scopes&access_token=${longToken}`);
        const scopesData = await scopesRes.json() as { granular_scopes?: Array<{ scope: string; target_ids: string[] }> };
        wabaId = wabaId ?? scopesData.granular_scopes?.find(s => s.scope === 'whatsapp_business_management')?.target_ids?.[0];

        if (!wabaId) {
          return reply.code(400).send({ error: 'No se encontró una cuenta de WhatsApp Business en la autorización.' });
        }

        const phonesRes  = await fetch(`${BASE}/${wabaId}/phone_numbers?access_token=${longToken}`);
        const phonesData = await phonesRes.json() as { data?: Array<{ id: string; display_phone_number: string }> };
        const phones     = phonesData.data ?? [];
        if (phones.length === 0) {
          return reply.code(400).send({ error: 'No hay números de teléfono registrados en esta cuenta de WhatsApp Business.' });
        }
        phoneId      = phones[0].id;
        displayPhone = phones[0].display_phone_number;
      } else {
        // Tenemos session info — intentar obtener el display_phone_number pero no fallar si no se puede
        const phoneRes  = await fetch(`${BASE}/${phoneId}?fields=display_phone_number&access_token=${longToken}`);
        const phoneData = await phoneRes.json() as { display_phone_number?: string };
        displayPhone = phoneData.display_phone_number ?? '';
      }

      // 5. Suscribir webhook al WABA (usar el token del usuario, no el app token)
      await fetch(`${BASE}/${wabaId}/subscribed_apps`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${longToken}` },
      }).catch(err => req.log.warn('[EmbeddedSignup] Webhook subscription failed:', err));

      // 6. Guardar configuración primero (antes de registrar, para no perder el token)
      const cfg = await whatsAppService.saveConfig({
        tenantId,
        phoneNumberId: phoneId,
        accessToken:   longToken,
        displayPhone,
        wabaId,
      });

      // 7. Registrar número con la Cloud API (status "Pending" → activo)
      const registerRes  = await fetch(`${BASE}/${phoneId}/register`, {
        method:  'POST',
        headers: { Authorization: `Bearer ${longToken}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ messaging_product: 'whatsapp' }),
      });
      const registerData = await registerRes.json() as { success?: boolean; error?: { message: string; code: number } };

      // 80007 = ya registrado (ok), 100 con "pin is required" = necesita PIN de 2FA
      if (!registerRes.ok && registerData.error?.code !== 80007) {
        const needsPin = registerData.error?.message?.toLowerCase().includes('pin');
        req.log.info({ phoneNumberId: cfg.phoneNumberId, needsPin }, '[EmbeddedSignup] guardado, registro pendiente');
        return reply.send({
          ok:          true,
          displayPhone: cfg.displayPhone,
          phoneNumberId: cfg.phoneNumberId,
          needsPin,
          registerError: needsPin ? null : registerData.error?.message,
        });
      }

      req.log.info({ phoneNumberId: cfg.phoneNumberId }, '[EmbeddedSignup] guardado y registrado OK');
      return reply.send({ ok: true, displayPhone: cfg.displayPhone, phoneNumberId: cfg.phoneNumberId });
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Error conectando con Meta.' });
    }
  });

  // POST /admin/whatsapp/register-phone — registrar número con PIN de 2FA
  app.post('/admin/whatsapp/register-phone', async (req, reply) => {
    const parse = z.object({
      pin:      z.string().length(6),
      tenantId: z.string().optional(),
    }).safeParse(req.body);
    if (!parse.success) return reply.code(400).send({ error: 'PIN inválido (debe ser 6 dígitos).' });

    const tenantId = getTenantId(req);
    const BASE     = `https://graph.facebook.com/${config.META_API_VERSION}`;

    const cfg = await whatsAppService.getConfig(tenantId);
    if (!cfg) return reply.code(404).send({ error: 'No hay configuración de WhatsApp para este tenant.' });

    const res  = await fetch(`${BASE}/${cfg.phoneNumberId}/register`, {
      method:  'POST',
      headers: { Authorization: `Bearer ${cfg.accessToken}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ messaging_product: 'whatsapp', pin: parse.data.pin }),
    });
    const data = await res.json() as { success?: boolean; error?: { message: string } };

    if (!res.ok) {
      return reply.code(400).send({ error: data.error?.message ?? 'Error al registrar con PIN.' });
    }
    return reply.send({ ok: true });
  });

  // POST /admin/whatsapp/connect
  app.post('/admin/whatsapp/connect', async (req, reply) => {
    const bodySchema = z.object({
      tenantId:      z.string().optional(),
      phoneNumberId: z.string().min(1),
      accessToken:   z.string().min(1),
      wabaId:        z.string().optional(),
    });

    const parse = bodySchema.safeParse(req.body);
    if (!parse.success) {
      return reply.code(400).send({ error: 'Datos inválidos.', details: parse.error.flatten() });
    }

    const tenantId = getTenantId(req);

    try {
      // Validar token con Meta API
      const validation = await whatsAppService.validateToken(
        parse.data.phoneNumberId,
        parse.data.accessToken,
      );

      if (!validation.valid) {
        return reply.code(400).send({ error: `Token inválido: ${validation.error}` });
      }

      const cfg = await whatsAppService.saveConfig({
        tenantId,
        phoneNumberId: parse.data.phoneNumberId,
        accessToken:   parse.data.accessToken,
        displayPhone:  validation.displayPhone,
        wabaId:        parse.data.wabaId,
      });

      return reply.send({
        ok:           true,
        displayPhone: cfg.displayPhone,
        phoneNumberId: cfg.phoneNumberId,
      });
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Error al guardar configuración.' });
    }
  });

  // DELETE /admin/whatsapp/connect?tenantId=
  app.delete('/admin/whatsapp/connect', async (req, reply) => {
    const query    = req.query as Record<string, string>;
    const tenantId = getTenantId(req);
    try {
      await whatsAppService.disconnect(tenantId);
      return reply.send({ ok: true });
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Error al desconectar.' });
    }
  });

  // ── WhatsApp Message Templates ────────────────────────────────────────────

  // GET /admin/whatsapp/templates
  app.get('/admin/whatsapp/templates', async (req, reply) => {
    const tenantId = getTenantId(req);
    try {
      const templates = await prisma.messageTemplate.findMany({
        where:   { tenantId },
        orderBy: { createdAt: 'desc' },
      });
      return reply.send({ templates });
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Error al listar plantillas.' });
    }
  });

  // POST /admin/whatsapp/templates
  app.post('/admin/whatsapp/templates', async (req, reply) => {
    const tenantId = getTenantId(req);
    const parse = z.object({
      name:      z.string().min(1).regex(/^[a-z0-9_]+$/, 'Solo minúsculas, números y guion bajo'),
      category:  z.enum(['UTILITY', 'MARKETING', 'AUTHENTICATION']).default('UTILITY'),
      language:  z.string().default('es'),
      bodyText:  z.string().min(1),
      variables: z.array(z.object({
        index:       z.string(),
        description: z.string(),
      })).default([]),
      purpose: z.string().default('reminder'),
    }).safeParse(req.body);

    if (!parse.success) return reply.code(400).send({ error: parse.error.errors[0]?.message ?? 'Datos inválidos.' });

    try {
      const template = await whatsAppTemplateService.createTemplate({ tenantId, ...parse.data });
      return reply.code(201).send({ template });
    } catch (err: unknown) {
      req.log.error(err);
      const msg = err instanceof Error ? err.message : 'Error al crear plantilla.';
      return reply.code(400).send({ error: msg });
    }
  });

  // POST /admin/whatsapp/templates/:id/refresh — consultar estado en Meta
  app.post<{ Params: { id: string } }>('/admin/whatsapp/templates/:id/refresh', async (req, reply) => {
    const tenantId = getTenantId(req);
    try {
      const template = await whatsAppTemplateService.refreshStatus(req.params.id, tenantId);
      return reply.send({ template });
    } catch (err: unknown) {
      req.log.error(err);
      const msg = err instanceof Error ? err.message : 'Error al refrescar estado.';
      return reply.code(400).send({ error: msg });
    }
  });

  // DELETE /admin/whatsapp/templates/:id
  app.delete<{ Params: { id: string } }>('/admin/whatsapp/templates/:id', async (req, reply) => {
    const tenantId = getTenantId(req);
    try {
      await whatsAppTemplateService.deleteTemplate(req.params.id, tenantId);
      return reply.send({ ok: true });
    } catch (err: unknown) {
      req.log.error(err);
      const msg = err instanceof Error ? err.message : 'Error al eliminar plantilla.';
      return reply.code(400).send({ error: msg });
    }
  });

  // ── Handoffs pendientes ────────────────────────────────────────────────────

  // GET /admin/handoffs?tenantId=
  // Devuelve las conversaciones que escalaron a humano y aún no fueron resueltas.
  app.get('/admin/handoffs', async (req, reply) => {
    const query    = req.query as Record<string, string>;
    const tenantId = getTenantId(req);

    try {
      const states = await prisma.conversationState.findMany({
        where:   { tenantId, handoffRequired: true },
        orderBy: { updatedAt: 'desc' },
        take:    50,
        select: {
          conversationId: true,
          patientName:    true,
          patientPhone:   true,
          channel:        true,
          updatedAt:      true,
          notes:          true,
        },
      });
      return reply.send({ handoffs: states });
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Error al cargar handoffs.' });
    }
  });

  // PATCH /admin/handoffs/:conversationId/resolve
  // Marca un handoff como resuelto (handoffRequired = false).
  app.patch<{ Params: { conversationId: string } }>(
    '/admin/handoffs/:conversationId/resolve',
    async (req, reply) => {
      const query    = req.query as Record<string, string>;
      const tenantId = getTenantId(req);

      try {
        await prisma.conversationState.updateMany({
          where: { conversationId: req.params.conversationId, tenantId },
          data:  { handoffRequired: false },
        });
        return reply.send({ ok: true });
      } catch (err) {
        req.log.error(err);
        return reply.code(500).send({ error: 'Error al resolver handoff.' });
      }
    },
  );

  // ── Fechas bloqueadas ──────────────────────────────────────────────────────

  // GET /admin/blocked-dates?tenantId=&professionalId=
  app.get('/admin/blocked-dates', async (req, reply) => {
    const query          = req.query as Record<string, string>;
    const tenantId       = query.tenantId       ?? config.DEFAULT_TENANT_ID;
    const professionalId = query.professionalId ?? undefined;

    try {
      const where: Record<string, unknown> = { tenantId };
      if (professionalId) where.professionalId = professionalId;

      const blockedDates = await prisma.blockedDate.findMany({
        where,
        orderBy: { startDate: 'asc' },
      });
      return reply.send({ blockedDates });
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Error al listar fechas bloqueadas.' });
    }
  });

  // POST /admin/blocked-dates
  app.post('/admin/blocked-dates', async (req, reply) => {
    const bodySchema = z.object({
      tenantId:       z.string().optional(),
      professionalId: z.string().min(1),
      startDate:      z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD requerido'),
      endDate:        z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Formato YYYY-MM-DD requerido'),
      reason:         z.string().optional(),
    });

    const parse = bodySchema.safeParse(req.body);
    if (!parse.success) {
      return reply.code(400).send({ error: 'Datos inválidos.', details: parse.error.flatten() });
    }

    const { professionalId, startDate, endDate, reason } = parse.data;
    const tenantId = getTenantId(req);

    if (startDate > endDate) {
      return reply.code(400).send({ error: 'La fecha de inicio no puede ser posterior a la fecha de fin.' });
    }

    try {
      const blocked = await prisma.blockedDate.create({
        data: { tenantId, professionalId, startDate, endDate, reason: reason ?? null },
      });
      return reply.code(201).send(blocked);
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Error al crear fecha bloqueada.' });
    }
  });

  // DELETE /admin/blocked-dates/:id
  app.delete<{ Params: { id: string } }>('/admin/blocked-dates/:id', async (req, reply) => {
    const query    = req.query as Record<string, string>;
    const tenantId = getTenantId(req);

    try {
      const existing = await prisma.blockedDate.findUnique({ where: { id: req.params.id } });
      if (!existing || existing.tenantId !== tenantId) {
        return reply.code(404).send({ error: 'Fecha bloqueada no encontrada.' });
      }
      await prisma.blockedDate.delete({ where: { id: req.params.id } });
      return reply.send({ ok: true });
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Error al eliminar fecha bloqueada.' });
    }
  });

  // ── Google Calendar — OAuth2 ───────────────────────────────────────────────

  // GET /admin/calendar/status?tenantId=
  app.get('/admin/calendar/status', async (req, reply) => {
    const query    = req.query as Record<string, string>;
    const tenantId = getTenantId(req);
    try {
      const status = await googleCalendarService.getStatus(tenantId);
      return reply.send(status);
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Error al obtener estado de Google Calendar.' });
    }
  });

  // GET /admin/calendar/auth-url?tenantId=
  // Devuelve la URL de consentimiento de Google para redirigir al doctor.
  app.get('/admin/calendar/auth-url', async (req, reply) => {
    const query    = req.query as Record<string, string>;
    const tenantId = getTenantId(req);

    if (!config.GOOGLE_CLIENT_ID || !config.GOOGLE_CLIENT_SECRET) {
      return reply.code(503).send({
        error: 'Google Calendar no está configurado. Agrega GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET al .env.',
      });
    }

    try {
      const url = googleCalendarService.getAuthUrl(tenantId);
      return reply.send({ url });
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Error al generar URL de autenticación.' });
    }
  });

  // GET /admin/calendar/calendars?tenantId=
  // Lista los calendarios de la cuenta Google autorizada para que el doctor elija.
  app.get('/admin/calendar/calendars', async (req, reply) => {
    const query    = req.query as Record<string, string>;
    const tenantId = getTenantId(req);
    try {
      const calendars = await googleCalendarService.listCalendars(tenantId);
      return reply.send({ calendars });
    } catch (err) {
      req.log.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      return reply.code(500).send({ error: `Error al listar calendarios: ${msg}` });
    }
  });

  // POST /admin/calendar/select
  // El doctor elige qué calendario usar.
  app.post('/admin/calendar/select', async (req, reply) => {
    const bodySchema = z.object({
      tenantId:   z.string().optional(),
      calendarId: z.string().min(1),
    });

    const parse = bodySchema.safeParse(req.body);
    if (!parse.success) {
      return reply.code(400).send({ error: 'Datos inválidos.', details: parse.error.flatten() });
    }

    const tenantId = getTenantId(req);
    try {
      await googleCalendarService.selectCalendar(tenantId, parse.data.calendarId);
      return reply.send({ ok: true });
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Error al guardar el calendario.' });
    }
  });

  // DELETE /admin/calendar/connect?tenantId=
  app.delete('/admin/calendar/connect', async (req, reply) => {
    const query    = req.query as Record<string, string>;
    const tenantId = getTenantId(req);
    try {
      await googleCalendarService.disconnect(tenantId);
      return reply.send({ ok: true });
    } catch (err) {
      req.log.error(err);
      return reply.code(500).send({ error: 'Error al desconectar Google Calendar.' });
    }
  });
}
