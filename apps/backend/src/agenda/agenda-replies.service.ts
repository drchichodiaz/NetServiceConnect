import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventBusService } from '../events/event-bus.service';

export type AgendaReplyKind = 'CONFIRM' | 'RESCHEDULE' | 'STALE';

export interface AgendaReplyMatch {
  kind: AgendaReplyKind;
  appointmentId: string;
  /** La conversacion donde salio el recordatorio: ahi va la respuesta si no hay otra abierta. */
  conversationId: string;
}

/** Lo que se le contesta al paciente segun lo que toco. */
const ACK: Record<AgendaReplyKind, string> = {
  CONFIRM: '¡Gracias! Su cita queda confirmada. Lo esperamos.',
  RESCHEDULE: 'Con gusto. En un momento alguien de la clínica le escribe por aquí para buscarle otro horario.',
  STALE: 'Esa cita ya no está vigente. Si necesita una nueva, escríbanos por aquí y con gusto le ayudamos.',
};

/**
 * Las respuestas del paciente a los botones del recordatorio ("Confirmo" /
 * "Reprogramar").
 *
 * Como se reconoce a que cita responde: cuando el paciente toca un boton de una
 * plantilla, Meta manda `type: 'button'` con `context.id` = el id del mensaje original.
 * Ese id es el Message.externalId del recordatorio, y la cita guarda el Message.id en
 * reminderMessageId. Sin ese enlace habria que adivinar la cita por telefono y fecha.
 *
 * Vive en el modulo de agenda y solo usa la base, para que el webhook (modulo de
 * WhatsApp) lo pueda usar sin que agenda y WhatsApp se importen mutuamente.
 */
@Injectable()
export class AgendaRepliesService {
  private readonly logger = new Logger(AgendaRepliesService.name);

  constructor(
    private prisma: PrismaService,
    private events: EventBusService,
  ) {}

  /** Si el mensaje entrante es la respuesta a un recordatorio de la agenda. */
  async match(tenantId: string, msg: any): Promise<AgendaReplyMatch | null> {
    if (msg?.type !== 'button' || !msg?.context?.id) return null;

    const original = await this.prisma.message.findFirst({
      where: { tenantId, externalId: msg.context.id },
      select: { id: true, conversationId: true },
    });
    if (!original) return null;

    const appt = await this.prisma.appointment.findFirst({
      where: { tenantId, reminderMessageId: original.id },
      select: { id: true, status: true, startsAt: true },
    });
    if (!appt) return null;

    const answer = this.normalize(msg.button?.payload || msg.button?.text || '');
    let kind: AgendaReplyKind | null = null;
    if (answer.includes('confirm')) kind = 'CONFIRM';
    else if (answer.includes('reprogram') || answer.includes('cambiar')) kind = 'RESCHEDULE';
    if (!kind) return null;

    // Tocar el boton de un recordatorio viejo (cita cancelada, ya pasada o cerrada) no
    // puede confirmar nada: se le avisa y la conversacion pasa a la clinica.
    const open = appt.status === 'SCHEDULED' || appt.status === 'CONFIRMED';
    if (!open || appt.startsAt.getTime() < Date.now()) kind = 'STALE';

    return { kind, appointmentId: appt.id, conversationId: original.conversationId };
  }

  /** Aplica la respuesta a la cita y devuelve el texto con el que se le contesta. */
  async apply(tenantId: string, match: AgendaReplyMatch): Promise<string> {
    const now = new Date();
    if (match.kind === 'CONFIRM') {
      await this.prisma.appointment.updateMany({
        where: { id: match.appointmentId, tenantId, status: 'SCHEDULED' },
        data: { status: 'CONFIRMED', confirmedAt: now },
      });
    } else if (match.kind === 'RESCHEDULE') {
      // No se mueve ni se cancela sola: la recepcion habla con el paciente y decide.
      // La marca es lo que la hace visible en la agenda ("pide reprogramar").
      await this.prisma.appointment.updateMany({
        where: { id: match.appointmentId, tenantId },
        data: { rescheduleRequestedAt: now },
      });
    }

    const appt = await this.prisma.appointment.findUnique({ where: { id: match.appointmentId }, select: { channelAccountId: true } });
    if (appt) {
      this.events.publish({ type: 'agenda_changed', tenantId, payload: { channelAccountIds: [appt.channelAccountId] } });
    }
    await this.prisma.auditLog.create({
      data: {
        tenantId,
        conversationId: match.conversationId,
        action: 'appointment.patient_reply',
        metadata: { appointmentId: match.appointmentId, kind: match.kind },
      },
    });
    this.logger.log(`[agenda] respuesta ${match.kind} a la cita ${match.appointmentId}`);
    return ACK[match.kind];
  }

  private normalize(text: string) {
    return text.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
  }
}
