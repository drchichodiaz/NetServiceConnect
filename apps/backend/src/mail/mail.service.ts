import { Injectable, Logger, forwardRef, Inject } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import { SystemConfigService } from '../system-config/system-config.service';

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /**
   * A quien le contesta el "Responder" del cliente de correo. Lo usan los reportes de
   * soporte: el correo sale del dominio del sistema (es el unico que puede firmar),
   * pero responderlo tiene que escribirle a la persona que reporto, no al buzon del
   * sistema, que no lee nadie.
   */
  replyTo?: string;
}

export interface MailSendResult {
  sent: boolean;
  /** El error tal cual lo devolvio el servidor SMTP. Solo se le muestra a un super
   *  admin probando la configuracion — nunca al usuario final. */
  error?: string;
}

/**
 * Envio de correo por SMTP.
 *
 * Va por SMTP y no por el SDK de un proveedor a proposito: el codigo queda atado al
 * protocolo y no a la empresa. Mudarse de Resend a SES, Postmark o un servidor propio
 * es cambiar la configuracion, sin recompilar ni tocar la logica de recuperacion.
 *
 * La configuracion se lee en cada envio, no al arrancar: como tambien se puede cargar
 * desde el panel, tomarla una sola vez al inicio haria que guardar una configuracion
 * nueva no tuviera efecto hasta reiniciar el backend. La conexion se cachea y se
 * descarta sola cuando alguno de los datos cambia.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  private transporter: nodemailer.Transporter | null = null;
  /** Huella de la config con la que se armo el transporter cacheado. */
  private fingerprint = '';

  constructor(
    @Inject(forwardRef(() => SystemConfigService))
    private systemConfig: SystemConfigService,
  ) {}

  async isConfigured(): Promise<boolean> {
    const cfg = await this.systemConfig.getMailConfig();
    return !!(cfg.host && cfg.user && cfg.pass);
  }

  /**
   * No lanza: quien llama decide si un fallo de correo rompe su operacion. En "olvide
   * mi contrasena" la respuesta al usuario es la misma salga o no, para no revelar que
   * direcciones existen.
   */
  async send(message: MailMessage): Promise<MailSendResult> {
    const cfg = await this.systemConfig.getMailConfig();

    if (!cfg.host || !cfg.user || !cfg.pass) {
      this.logger.warn(`[correo no enviado - SMTP sin configurar] para=${message.to} asunto="${message.subject}"`);
      return { sent: false, error: 'SMTP sin configurar' };
    }

    const transporter = this.getTransporter(cfg);

    try {
      const info = await transporter.sendMail({
        from: cfg.from || cfg.user,
        to: message.to,
        ...(message.replyTo && { replyTo: message.replyTo }),
        subject: message.subject,
        text: message.text,
        html: message.html,
      });
      this.logger.log(`Correo enviado a ${message.to} (${info.messageId})`);
      return { sent: true };
    } catch (err: any) {
      const detail = err?.response || err?.message || String(err);
      this.logger.error(`Fallo el envio a ${message.to}: ${detail}`);
      return { sent: false, error: detail };
    }
  }

  /** Correo de prueba, para que configurar SMTP no sea a ciegas. */
  async sendTest(to: string): Promise<MailSendResult> {
    return this.send({
      to,
      subject: 'Prueba de configuración — NetService Connect',
      text: 'Si estás leyendo esto, el envío de correo del sistema quedó funcionando.',
      html:
        '<p style="font-family:sans-serif;font-size:14px;color:#101819">' +
        'Si estás leyendo esto, el envío de correo del sistema quedó funcionando.</p>',
    });
  }

  private getTransporter(cfg: { host: string; port: number; user: string; pass: string }) {
    const fingerprint = `${cfg.host}|${cfg.port}|${cfg.user}|${cfg.pass}`;
    if (this.transporter && this.fingerprint === fingerprint) return this.transporter;

    this.transporter?.close();
    this.transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      // 465 es SMTPS (TLS desde el saludo); 587 arranca en claro y sube con STARTTLS.
      // Al reves, la conexion queda colgada hasta el timeout.
      secure: cfg.port === 465,
      auth: { user: cfg.user, pass: cfg.pass },
    });
    this.fingerprint = fingerprint;
    return this.transporter;
  }
}
