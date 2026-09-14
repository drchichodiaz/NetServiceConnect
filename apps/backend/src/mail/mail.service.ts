import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Envio de correo por SMTP.
 *
 * Va por SMTP y no por el SDK de un proveedor a proposito: el codigo queda atado al
 * protocolo y no a la empresa. Hoy apunta a Resend; mudarse a SES, Postmark o a un
 * servidor propio es cambiar las variables de MAIL_* y reiniciar, sin recompilar ni
 * tocar la logica de recuperacion de contrasena.
 *
 * Si no hay configuracion de SMTP el servicio no falla: loguea lo que hubiera mandado y
 * sigue. Eso permite levantar el backend en desarrollo sin credenciales, y que un
 * despliegue al que todavia no le cargaron la API key no se caiga entero — el precio es
 * que el correo no sale, y por eso lo avisa en el log con nivel warn.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: nodemailer.Transporter | null;
  private readonly from: string;

  constructor(private config: ConfigService) {
    const host = this.config.get<string>('MAIL_HOST');
    const user = this.config.get<string>('MAIL_USER');
    const pass = this.config.get<string>('MAIL_PASS');
    this.from = this.config.get<string>('MAIL_FROM') || 'NetService Connect <onboarding@resend.dev>';

    if (!host || !user || !pass) {
      this.transporter = null;
      this.logger.warn('SMTP sin configurar (MAIL_HOST/MAIL_USER/MAIL_PASS): los correos se van a loguear, no a enviar');
      return;
    }

    const port = Number(this.config.get('MAIL_PORT') ?? 587);
    this.transporter = nodemailer.createTransport({
      host,
      port,
      // 465 es SMTPS (TLS desde el saludo); 587 arranca en claro y sube a TLS con
      // STARTTLS. Ponerlo al reves hace que la conexion quede colgada hasta el timeout.
      secure: port === 465,
      auth: { user, pass },
    });
  }

  get isConfigured(): boolean {
    return this.transporter !== null;
  }

  /**
   * Devuelve true si el correo salio. No lanza: quien llama decide si un fallo de
   * correo tiene que romper su operacion, y en el caso de "olvide mi contrasena" la
   * respuesta al usuario es la misma haya salido o no, para no revelar que direcciones
   * existen en el sistema.
   */
  async send(message: MailMessage): Promise<boolean> {
    if (!this.transporter) {
      this.logger.warn(`[correo no enviado - SMTP sin configurar] para=${message.to} asunto="${message.subject}"`);
      return false;
    }

    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to: message.to,
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      this.logger.log(`Correo enviado a ${message.to} (${info.messageId})`);
      return true;
    } catch (err: any) {
      // El detalle va al log del servidor, nunca al usuario: un error de SMTP puede
      // traer el host y el usuario de la cuenta.
      this.logger.error(`Fallo el envio a ${message.to}: ${err?.message ?? err}`);
      return false;
    }
  }
}
