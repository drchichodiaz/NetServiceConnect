import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsAppService } from '../whatsapp/whatsapp.service';
import { WhatsAppAccountsService } from '../whatsapp/accounts.service';
import { ContactIdentityService } from '../contacts/contact-identity.service';
import { fromLocal, MINUTES_PER_DAY, toLocal } from '../agenda/agenda-time';
import { DoctorLinkService } from '../agenda/doctor-link.service';

export type NoticeKind = 'CONFIRMATION' | 'REMINDER' | 'DELAY';

const SETTING: Record<NoticeKind, 'confirmationTemplateId' | 'reminderTemplateId' | 'delayTemplateId'> = {
  CONFIRMATION: 'confirmationTemplateId',
  REMINDER: 'reminderTemplateId',
  DELAY: 'delayTemplateId',
};

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/**
 * "viernes 2 de octubre", en la hora de la clinica. Armado a mano: toLocaleDateString
 * pone "viernes, 2 de octubre", y esa coma queda rara en medio de una oracion.
 */
function dayText(instant: Date, timeZone: string) {
  const { date } = toLocal(instant, timeZone);
  const [y, m, d] = date.split('-').map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[weekday]} ${d} de ${MONTHS[m - 1]}`;
}

/** "9:30 a.m.", como se escribe en Centroamerica. */
function hourText(instant: Date, timeZone: string) {
  const { minute } = toLocal(instant, timeZone);
  const h = Math.floor(minute / 60);
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(minute % 60).padStart(2, '0')} ${h < 12 ? 'a.m.' : 'p.m.'}`;
}

/**
 * "a las {{3}}." con una hora que ya termina en punto ("10:00 a.m.") daria "a.m..": si en
 * la plantilla la variable va seguida de un punto, se le saca el suyo.
 */
function fitToTemplate(bodyText: string, values: string[]) {
  return values.map((v, i) => (bodyText.includes(`{{${i + 1}}}.`) && v.endsWith('.') ? v.slice(0, -1) : v));
}

/** "Villa Clarita", "Villa Clarita y Zona 5", "A, B y C". */
function joinNames(names: string[]) {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`;
}

/**
 * Manda un aviso de la agenda a un paciente con la plantilla que eligio la clinica.
 *
 * Las variables van en el orden que se pidio al crear las plantillas:
 *   confirmacion: {{1}} clinica · {{2}} dia · {{3}} hora
 *   recordatorio: {{1}} dia · {{2}} hora · {{3}} clinica
 *   atraso:       {{1}} clinica
 *
 * El aviso sale por la linea de la clinica de la cita, y en una conversacion cerrada si
 * no hay una abierta: queda en el historial del paciente sin ocupar la bandeja.
 */
@Injectable()
export class AgendaNotifierService {
  private readonly logger = new Logger(AgendaNotifierService.name);

  constructor(
    private prisma: PrismaService,
    private whatsapp: WhatsAppService,
    private accounts: WhatsAppAccountsService,
    private identities: ContactIdentityService,
    private links: DoctorLinkService,
  ) {}

  /** Devuelve el Message.id del aviso, o null si ese aviso no esta configurado. */
  async send(appointmentId: string, kind: NoticeKind): Promise<string | null> {
    const appt = await this.prisma.appointment.findUniqueOrThrow({
      where: { id: appointmentId },
      include: { contact: true, channelAccount: true, tenant: { select: { timezone: true, agendaSettings: true } } },
    });
    const templateId = appt.tenant.agendaSettings?.[SETTING[kind]];
    if (!templateId) return null;

    const account = await this.accounts.findActiveCredsOrThrow(appt.tenantId, appt.channelAccountId);
    const template = await this.templateForLine(appt.tenantId, templateId, account.wabaId);
    const recipient = await this.identities.findExternalId(appt.contactId, 'WHATSAPP');
    if (!recipient) throw new BadRequestException('El paciente no tiene WhatsApp');

    const tz = appt.tenant.timezone;
    const clinic =
      appt.channelAccount.label?.trim() || appt.channelAccount.displayName?.trim() || appt.channelAccount.businessName?.trim() || 'la clínica';
    const day = dayText(appt.startsAt, tz);
    const hour = hourText(appt.startsAt, tz);
    const values = kind === 'CONFIRMATION' ? [clinic, day, hour] : kind === 'REMINDER' ? [day, hour, clinic] : [clinic];
    const body = fitToTemplate(template.bodyText, values);

    const { message } = await this.whatsapp.sendTemplateToContact({
      tenantId: appt.tenantId,
      account,
      template,
      contact: appt.contact,
      recipient,
      variables: { body },
      senderId: null,
      assignTo: null,
      newConversationStatus: 'CLOSED',
    });
    return message.id;
  }

  /**
   * El resumen de la mañana a un doctor: cuantas citas tiene hoy, donde y de que hora a
   * que hora, con el boton que abre /mis-citas/<codigo>. Variables:
   *   {{1}} doctor · {{2}} cantidad · {{3}} clinica(s) · {{4}} primera hora · {{5}} ultima hora
   * y el {{1}} del boton de enlace = el codigo firmado del dia.
   *
   * Sale por la linea de la clinica de su primera cita: es la que el doctor ve ese dia.
   * Devuelve el Message.id, o null si no hay plantilla elegida o no tiene citas.
   */
  async sendDoctorSummary(doctorId: string, date: string): Promise<string | null> {
    const doctor = await this.prisma.doctor.findUniqueOrThrow({
      where: { id: doctorId },
      include: { tenant: { select: { timezone: true, agendaSettings: true } } },
    });
    const templateId = doctor.tenant.agendaSettings?.doctorSummaryTemplateId;
    if (!templateId) return null;
    if (!doctor.phone) throw new BadRequestException('El doctor no tiene WhatsApp cargado');

    const tz = doctor.tenant.timezone;
    const appts = await this.prisma.appointment.findMany({
      where: {
        doctorId,
        status: { not: 'CANCELLED' },
        startsAt: { lt: new Date(fromLocal(date, MINUTES_PER_DAY, tz)) },
        endsAt: { gt: new Date(fromLocal(date, 0, tz)) },
      },
      orderBy: { startsAt: 'asc' },
      include: { channelAccount: true },
    });
    if (appts.length === 0) return null;

    const account = await this.accounts.findActiveCredsOrThrow(doctor.tenantId, appts[0].channelAccountId);
    const template = await this.templateForLine(doctor.tenantId, templateId, account.wabaId);
    const buttonIndex = ((template.buttons as any[]) ?? []).findIndex((b) => b?.type === 'URL');
    if (buttonIndex < 0) throw new BadRequestException(`La plantilla "${template.name}" no tiene el botón de enlace`);

    const clinicOf = (a: (typeof appts)[number]) =>
      a.channelAccount.label?.trim() || a.channelAccount.displayName?.trim() || a.channelAccount.businessName?.trim() || 'la clínica';
    const clinics = Array.from(new Set(appts.map(clinicOf)));
    const values = [
      doctor.name,
      String(appts.length),
      joinNames(clinics),
      hourText(appts[0].startsAt, tz),
      hourText(appts.reduce((last, a) => (a.endsAt > last ? a.endsAt : last), appts[0].endsAt), tz),
    ];

    // El doctor queda como contacto de WhatsApp de la empresa: es la forma de mandarle
    // una plantilla y de que, si responde, su mensaje entre como cualquier otro.
    const contact = await this.identities.resolve(doctor.tenantId, 'WHATSAPP', doctor.phone, { name: `${doctor.code} ${doctor.name}` });

    const { message } = await this.whatsapp.sendTemplateToContact({
      tenantId: doctor.tenantId,
      account,
      template,
      contact,
      recipient: doctor.phone,
      variables: { body: fitToTemplate(template.bodyText, values), buttons: [{ index: buttonIndex, value: this.links.sign(doctor.id, date) }] },
      senderId: null,
      assignTo: null,
      newConversationStatus: 'CLOSED',
    });
    return message.id;
  }

  /**
   * La plantilla elegida, pero la del WABA de esta linea. Meta guarda las plantillas por
   * WABA: la clinica elige una en pantalla, y si sus lineas estan en WABAs distintos,
   * la "misma" plantilla es otra fila en cada uno (mismo nombre e idioma).
   */
  private async templateForLine(tenantId: string, templateId: string, wabaId: string) {
    const chosen = await this.prisma.messageTemplate.findFirst({ where: { id: templateId, tenantId } });
    if (!chosen) throw new BadRequestException('La plantilla elegida para este aviso ya no existe');
    const template = await this.prisma.messageTemplate.findFirst({
      where: { tenantId, wabaId, name: chosen.name, language: chosen.language },
    });
    if (!template) throw new BadRequestException(`La plantilla "${chosen.name}" no existe en la cuenta de WhatsApp de esta clínica`);
    if (template.status !== 'APPROVED') throw new BadRequestException(`La plantilla "${chosen.name}" todavía no está aprobada por Meta`);
    return template;
  }
}
