import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { randomBytes, createHash } from 'crypto';
import * as bcrypt from 'bcryptjs';

/** Cuanto vale un link. Corto porque un mail viejo en una bandeja ajena no deberia
 *  seguir sirviendo, y pedir otro cuesta un clic. */
const TOKEN_TTL_MINUTES = 60;

@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    private prisma: PrismaService,
    private mail: MailService,
    private config: ConfigService,
  ) {}

  /**
   * Paso 1: alguien dice que olvido su contrasena.
   *
   * Responde lo mismo exista o no la direccion, y tarde lo mismo: si dijera "ese email
   * no esta registrado" cualquiera podria averiguar quien usa el sistema probando
   * direcciones. Por eso tampoco informa si el correo salio.
   */
  async requestReset(email: string, origin?: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
      include: { tenant: { select: { name: true, isActive: true } } },
    });

    if (!user || !user.isActive || !user.tenant.isActive) {
      this.logger.log(`Pedido de recuperacion para una direccion sin cuenta activa`);
      return;
    }

    // Los pedidos anteriores que sigan vivos se invalidan: si alguien pide el link tres
    // veces, solo el ultimo mail sirve.
    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    const token = randomBytes(32).toString('hex');
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + TOKEN_TTL_MINUTES * 60_000),
      },
    });

    const base = origin || this.config.get<string>('FRONTEND_URL') || '';
    const link = `${base.replace(/\/$/, '')}/reset-password?token=${token}`;

    const result = await this.mail.send({
      to: user.email,
      subject: 'Restablecer tu contraseña',
      text: textEmail(user.name, user.tenant.name, link),
      html: htmlEmail(user.name, user.tenant.name, link),
    });

    // Sin SMTP configurado el mail no sale y el flujo quedaria imposible de probar, asi
    // que en ese caso — y SOLO en ese — el enlace va al log para poder copiarlo. Con
    // SMTP configurado el token no se escribe en ningun lado fuera del correo.
    if (!result.sent && !(await this.mail.isConfigured())) {
      this.logger.warn(`[SMTP sin configurar] enlace de recuperacion: ${link}`);
    }
  }

  /** Paso 2: llega con el token del mail y una contrasena nueva. */
  async resetPassword(token: string, newPassword: string): Promise<void> {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { user: { select: { id: true, isActive: true } } },
    });

    // Un solo mensaje para "no existe", "ya se uso" y "vencio": distinguirlos le diria a
    // quien prueba tokens al azar cuando acerto uno que alguna vez fue valido.
    const invalid = new BadRequestException('El enlace no es válido o ya venció. Pedí uno nuevo.');
    if (!record || record.usedAt || record.expiresAt < new Date() || !record.user.isActive) {
      throw invalid;
    }

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { password: await bcrypt.hash(newPassword, 10) },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
    ]);

    this.logger.log(`Contrasena restablecida para el usuario ${record.userId}`);
  }
}

/** SHA-256 alcanza: el token ya es 256 bits de aleatoriedad, no una contrasena que
 *  alguien pueda adivinar por fuerza bruta, asi que no hace falta bcrypt acá. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function textEmail(name: string, tenant: string, link: string): string {
  return [
    `Hola ${name},`,
    ``,
    `Pediste restablecer la contraseña de tu cuenta en ${tenant}.`,
    `Abrí este enlace para elegir una nueva:`,
    ``,
    link,
    ``,
    `El enlace vence en ${TOKEN_TTL_MINUTES} minutos y sirve una sola vez.`,
    `Si no lo pediste vos, podés ignorar este mensaje: tu contraseña no cambió.`,
  ].join('\n');
}

function htmlEmail(name: string, tenant: string, link: string): string {
  return `<!doctype html>
<html lang="es">
  <body style="margin:0;padding:24px;background:#f5f7f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#101819">
    <table role="presentation" style="max-width:480px;margin:0 auto;background:#ffffff;border:1px solid #dce4e4;border-radius:8px">
      <tr>
        <td style="padding:28px">
          <p style="margin:0 0 16px;font-size:15px">Hola ${escapeHtml(name)},</p>
          <p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#4b5c5f">
            Pediste restablecer la contraseña de tu cuenta en <strong>${escapeHtml(tenant)}</strong>.
          </p>
          <p style="margin:0 0 24px">
            <a href="${link}" style="display:inline-block;background:#128c4a;color:#ffffff;text-decoration:none;font-size:14px;font-weight:500;padding:11px 20px;border-radius:6px">
              Elegir una contraseña nueva
            </a>
          </p>
          <p style="margin:0 0 8px;font-size:12px;line-height:1.6;color:#71868a">
            El enlace vence en ${TOKEN_TTL_MINUTES} minutos y sirve una sola vez.
          </p>
          <p style="margin:0;font-size:12px;line-height:1.6;color:#71868a">
            Si no lo pediste vos, podés ignorar este mensaje: tu contraseña no cambió.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** El nombre del usuario y el de la empresa los escribe gente, asi que van escapados
 *  aunque el destinatario sea el propio duenio de la cuenta. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
