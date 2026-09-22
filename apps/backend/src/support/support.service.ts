import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { CreateSupportRequestDto, FailedCallDto } from './dto/create-support-request.dto';

/** Cuantos errores recientes se guardan y se mandan. Mas que esto no se lee nadie. */
const MAX_RECENT_ERRORS = 10;

/** Cuando arranco este backend. Dice, con buena aproximacion, de cuando es el deploy. */
const STARTED_AT = new Date();

@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    private prisma: PrismaService,
    private mail: MailService,
    private systemConfig: SystemConfigService,
    private config: ConfigService,
  ) {}

  /**
   * Guarda el reporte y lo manda por correo.
   *
   * En ese orden y a proposito: si el envio falla (SMTP sin configurar en este entorno,
   * proveedor caido), el reporte ya esta guardado y no se pierde. Por eso tampoco lanza
   * cuando el correo no sale — para quien reporta, el reporte llego.
   */
  async create(
    tenantId: string,
    user: { id: string; name?: string | null; email: string; role?: string | null },
    dto: CreateSupportRequestDto,
  ) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { name: true, slug: true },
    });

    const context = {
      ...dto.context,
      recentErrors: (dto.context?.recentErrors ?? []).slice(0, MAX_RECENT_ERRORS),
      // Lo que sabe el servidor y el navegador no: de que entorno se trata y desde
      // cuando corre este backend.
      server: {
        version: this.config.get<string>('APP_VERSION') || 'sin declarar',
        startedAt: STARTED_AT.toISOString(),
        frontendUrl: this.config.get<string>('FRONTEND_URL') || '',
      },
    };

    const report = await this.prisma.supportRequest.create({
      data: {
        tenantId,
        userId: user.id,
        activity: dto.activity.trim(),
        problem: dto.problem.trim(),
        blocking: !!dto.blocking,
        context: context as any,
      },
    });

    /** Lo que la persona cita por telefono. Los 8 primeros alcanzan para encontrarlo. */
    const ticket = report.id.slice(-8).toUpperCase();
    const to = await this.resolveSupportEmail();

    if (!to) {
      this.logger.warn(
        `[soporte ${ticket}] guardado pero NO enviado: no hay direccion de soporte configurada ` +
          `(Configuracion > Sistema, o SUPPORT_EMAIL en el entorno)`,
      );
      await this.prisma.supportRequest.update({
        where: { id: report.id },
        data: { emailError: 'Sin dirección de soporte configurada' },
      });
      // Para quien reporta no cambia nada: el reporte quedo guardado igual.
      return { ticket, emailSent: false };
    }

    const subject =
      `[Connect${tenant?.name ? ` · ${tenant.name}` : ''}] ${dto.blocking ? '🔴 BLOQUEA · ' : ''}` +
      `${firstLine(dto.problem)} (${ticket})`;

    const result = await this.mail.send({
      to,
      // Se responde al que reporto, no al buzon del sistema.
      replyTo: user.email,
      subject,
      text: textReport(ticket, user, tenant, dto, context),
      html: htmlReport(ticket, user, tenant, dto, context),
    });

    await this.prisma.supportRequest.update({
      where: { id: report.id },
      data: { emailSent: result.sent, emailError: result.sent ? null : result.error ?? 'Error desconocido' },
    });

    if (result.sent) this.logger.log(`[soporte ${ticket}] enviado a ${to} (${user.email})`);
    else this.logger.error(`[soporte ${ticket}] guardado pero fallo el envio a ${to}: ${result.error}`);

    return { ticket, emailSent: result.sent };
  }

  /**
   * La direccion del panel gana sobre la del entorno, igual que con el resto de la
   * configuracion de correo: quien tiene acceso al servidor usa el .env, quien no, el
   * panel. Vacia en las dos = el reporte se guarda y no se envia.
   */
  private async resolveSupportEmail(): Promise<string> {
    const stored = (await this.systemConfig.getSupportEmail())?.trim();
    return stored || (this.config.get<string>('SUPPORT_EMAIL') || '').trim();
  }
}

/** La primera linea del problema, para el asunto. */
function firstLine(text: string): string {
  const line = text.trim().split('\n')[0].trim();
  return line.length > 80 ? `${line.slice(0, 77)}…` : line;
}

function describeError(e: FailedCallDto): string {
  const when = e.at ? new Date(e.at).toLocaleString('es-PA') : '';
  return `${e.method} ${e.url} → ${e.status}${e.requestId ? ` · req ${e.requestId}` : ''}` +
    `${e.message ? ` · ${e.message}` : ''}${when ? ` · ${when}` : ''}`;
}

function textReport(
  ticket: string,
  user: { name?: string | null; email: string; role?: string | null },
  tenant: { name: string; slug: string } | null,
  dto: CreateSupportRequestDto,
  context: any,
): string {
  const errors = (context.recentErrors ?? []) as FailedCallDto[];
  return [
    `Reporte ${ticket}${dto.blocking ? ' — BLOQUEA EL TRABAJO' : ''}`,
    '',
    `Quien: ${user.name || '(sin nombre)'} <${user.email}>${user.role ? ` · ${user.role}` : ''}`,
    `Empresa: ${tenant?.name ?? '(desconocida)'}${tenant?.slug ? ` (${tenant.slug})` : ''}`,
    `Pantalla: ${context.url || '(no informada)'}`,
    '',
    'QUÉ ESTABA HACIENDO',
    dto.activity.trim(),
    '',
    'QUÉ PASÓ',
    dto.problem.trim(),
    '',
    'ÚLTIMOS ERRORES DEL PANEL',
    errors.length ? errors.map((e) => `  · ${describeError(e)}`).join('\n') : '  (ninguno registrado)',
    '',
    'ENTORNO',
    `  Versión: ${context.server?.version}`,
    `  Backend arrancó: ${context.server?.startedAt}`,
    `  Navegador: ${context.userAgent || '(no informado)'}`,
    `  Ventana: ${context.viewport || '—'} · Idioma: ${context.language || '—'} · Zona: ${context.timezone || '—'}`,
  ].join('\n');
}

function htmlReport(
  ticket: string,
  user: { name?: string | null; email: string; role?: string | null },
  tenant: { name: string; slug: string } | null,
  dto: CreateSupportRequestDto,
  context: any,
): string {
  const errors = (context.recentErrors ?? []) as FailedCallDto[];
  const body = 'font-family:system-ui,sans-serif;font-size:14px;color:#101819;line-height:1.5';
  const label = 'font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin:18px 0 4px';
  const box = 'background:#f6f7f8;border-radius:8px;padding:10px 12px;white-space:pre-wrap';

  return `<div style="${body};max-width:640px">
  <p style="margin:0 0 4px"><strong>Reporte ${ticket}</strong>${
    dto.blocking ? ' <span style="background:#fee2e2;color:#b91c1c;border-radius:999px;padding:2px 8px;font-size:11px;font-weight:600">BLOQUEA EL TRABAJO</span>' : ''
  }</p>
  <p style="margin:0;color:#6b7280;font-size:13px">
    ${escapeHtml(user.name || '(sin nombre)')} &lt;${escapeHtml(user.email)}&gt;${user.role ? ` · ${escapeHtml(user.role)}` : ''}<br>
    ${escapeHtml(tenant?.name ?? '(empresa desconocida)')}${tenant?.slug ? ` (${escapeHtml(tenant.slug)})` : ''}<br>
    ${escapeHtml(context.url || 'pantalla no informada')}
  </p>

  <p style="${label}">Qué estaba haciendo</p>
  <div style="${box}">${escapeHtml(dto.activity.trim())}</div>

  <p style="${label}">Qué pasó</p>
  <div style="${box}">${escapeHtml(dto.problem.trim())}</div>

  <p style="${label}">Últimos errores del panel</p>
  ${
    errors.length
      ? `<div style="${box};font-family:ui-monospace,monospace;font-size:12px">${errors
          .map((e) => escapeHtml(describeError(e)))
          .join('<br>')}</div>`
      : `<div style="${box};color:#6b7280">Ninguno registrado</div>`
  }

  <p style="${label}">Entorno</p>
  <div style="${box};font-size:12px;color:#374151">Versión: ${escapeHtml(context.server?.version ?? '—')}
Backend arrancó: ${escapeHtml(context.server?.startedAt ?? '—')}
Navegador: ${escapeHtml(context.userAgent || '—')}
Ventana: ${escapeHtml(context.viewport || '—')} · Idioma: ${escapeHtml(context.language || '—')} · Zona: ${escapeHtml(context.timezone || '—')}</div>

  <p style="margin-top:18px;font-size:12px;color:#6b7280">
    Respondiendo este correo le escribís directo a quien lo reportó.
  </p>
</div>`;
}

/** El texto lo escribio una persona: va escapado para que no rompa (ni inyecte) HTML. */
function escapeHtml(text: string): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
