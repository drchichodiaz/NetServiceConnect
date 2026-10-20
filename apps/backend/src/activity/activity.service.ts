import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ChannelAccessService } from '../common/services/channel-access.service';
import { fromLocal, isValidDate, MINUTES_PER_DAY, toLocal } from '../agenda/agenda-time';
import { clinicName, dayText, hourText } from '../agenda/agenda-text';

/** Quien hizo lo que dice la linea. */
export type ActivityActor = 'bot' | 'user' | 'patient';

/** Para filtrar: de que se trata la linea. */
export type ActivityCategory = 'appointments' | 'handoffs' | 'bot' | 'team';

export interface ActivityItem {
  id: string;
  at: string;
  actor: ActivityActor;
  /** El nombre del usuario cuando actor = 'user'. */
  actorName: string | null;
  category: ActivityCategory;
  text: string;
  channelAccountId: string | null;
  conversationId: string | null;
  /** Si quien mira puede abrir la conversacion: un agente solo abre las suyas. */
  canOpenConversation: boolean;
  appointmentId: string | null;
}

/**
 * Lo que va en la bitacora. Lo demas que se registra es ruido interno (respuestas que
 * el bot no entendio, entradas al menu) o repite otra linea: "conversation.closed" del
 * bot es lo mismo que "bot.resolved_without_agent", y "bot.handoff_requested" lo mismo
 * que "conversation.bot_handoff", que ademas sabe a quien quedo asignada.
 */
const ACTIONS = [
  'conversation.created',
  'conversation.started',
  'conversation.assigned',
  'conversation.bot_handoff',
  'conversation.status.closed',
  'conversation.status.open',
  'conversation.status.pending',
  'conversation.order_lookup_resolved',
  'bot.resolved_without_agent',
  'appointment.created',
  'appointment.moved',
  'appointment.extended',
  'appointment.status',
  'appointment.patient_reply',
];

/** Un dia muy movido de una empresa grande ronda el millar; esto es solo un techo. */
const MAX_ROWS = 3000;

/** Por que el bot paso la conversacion a una persona, dicho para la recepcion. */
const HANDOFF_REASONS: Record<string, string> = {
  menu_selection: 'pidió hablar con un agente',
  post_reply_agent: 'pidió hablar con un agente',
  ai_chat_escape: 'pidió hablar con una persona',
  query_escape: 'pidió hablar con una persona',
  booking_escape: 'pidió hablar con una persona',
  ai_specialist_request: 'pidió cita con un especialista',
  max_retries_reached: 'el bot no le entendió',
  query_no_match: 'el bot no encontró lo que buscaba',
  reschedule_by_clinic: 'pidió ayuda con su cita',
  booking_no_slots: 'no había horarios libres para reservar',
  reschedule_no_slots: 'no había horarios libres para cambiar su cita',
  booking_too_late: 'falta poco para su cita y quiere cambiarla',
  booking_self_service_off: 'quiere cambiar su cita',
  booking_stale: 'su cita ya no estaba vigente',
  order_lookup_not_configured: 'consultó un pedido',
  order_lookup_error: 'no se pudo consultar su pedido',
  manual_takeover: '',
};

const STATUS_TEXT: Record<string, string> = {
  CONFIRMED: 'confirmada',
  ARRIVED: '"llegó"',
  DONE: 'atendida',
  NO_SHOW: '"no vino"',
  SCHEDULED: 'agendada',
};

type Row = Awaited<ReturnType<ActivityService['loadRows']>>[number];
type Appt = Awaited<ReturnType<ActivityService['loadAppointments']>>[number];

/**
 * La bitacora de la empresa: lo que fue pasando en el dia, en orden, en palabras.
 *
 * Sale de AuditLog, que ya registra cada paso del bot, de los operadores y de la
 * agenda. No guarda nada propio: por eso tambien muestra los dias anteriores a que
 * existiera esta pantalla.
 */
@Injectable()
export class ActivityService {
  constructor(
    private prisma: PrismaService,
    private channelAccess: ChannelAccessService,
  ) {}

  async list(
    tenantId: string,
    user: { id: string; role: string },
    query: { date?: string; channelAccountId?: string; category?: string },
  ) {
    const tenant = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { timezone: true } });
    const tz = tenant.timezone;
    const date = query.date || toLocal(new Date(), tz).date;
    if (!isValidDate(date)) throw new BadRequestException('Fecha inválida');

    const allowed = await this.channelAccess.allowedAccountIds(user.id);
    const lines = await this.prisma.channelAccount.findMany({
      where: { tenantId, channel: 'WHATSAPP', ...(allowed && { id: { in: allowed } }) },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, label: true, displayName: true, businessName: true },
    });
    const lineName = new Map(lines.map((l) => [l.id, clinicName(l)]));

    const rows = await this.loadRows(tenantId, fromLocal(date, 0, tz), fromLocal(date, MINUTES_PER_DAY, tz));
    const appointments = await this.loadAppointments(tenantId, rows);
    const byAppointment = new Map(appointments.map((a) => [a.id, a]));
    const doctorIds = new Set<string>();
    for (const r of rows) {
      const m = (r.metadata ?? {}) as any;
      for (const id of [m.doctorId, m.to?.doctorId, m.from?.doctorId]) if (typeof id === 'string') doctorIds.add(id);
    }
    const doctors = await this.prisma.doctor.findMany({ where: { tenantId, id: { in: [...doctorIds] } }, select: { id: true, code: true } });
    const doctorCode = new Map(doctors.map((d) => [d.id, d.code]));
    const users = await this.prisma.user.findMany({ where: { tenantId }, select: { id: true, name: true } });
    const userName = new Map(users.map((u) => [u.id, u.name]));

    const items: ActivityItem[] = [];
    for (const row of rows) {
      const appt = byAppointment.get(((row.metadata ?? {}) as any).appointmentId);
      const channelAccountId = row.conversation?.channelAccountId ?? appt?.channelAccountId ?? null;
      // Lo de una linea que no puede ver no le aparece. Lo que no tiene linea si (igual
      // que en la bandeja: dejarlo afuera lo volveria invisible para todos).
      if (channelAccountId && allowed && !allowed.includes(channelAccountId)) continue;
      if (query.channelAccountId && channelAccountId !== query.channelAccountId) continue;

      const described = this.describe(row, appt, { tz, doctorCode, userName });
      if (!described) continue;
      if (query.category && described.category !== query.category) continue;

      const conversationId = row.conversationId ?? null;
      items.push({
        id: row.id,
        at: row.createdAt.toISOString(),
        ...described,
        actorName: described.actor === 'user' ? row.user?.name ?? null : null,
        channelAccountId,
        conversationId,
        canOpenConversation: !!conversationId && (user.role !== 'AGENT' || row.conversation?.assignedUserId === user.id),
        appointmentId: appt?.id ?? null,
      });
    }

    return {
      date,
      timezone: tz,
      lines: lines.map((l) => ({ id: l.id, label: lineName.get(l.id)! })),
      truncated: rows.length >= MAX_ROWS,
      items,
    };
  }

  private loadRows(tenantId: string, from: Date, to: Date) {
    return this.prisma.auditLog.findMany({
      where: { tenantId, action: { in: ACTIONS }, createdAt: { gte: from, lt: to } },
      orderBy: { createdAt: 'desc' },
      take: MAX_ROWS,
      include: {
        user: { select: { name: true } },
        conversation: {
          select: { channelAccountId: true, assignedUserId: true, contact: { select: { name: true, phone: true } } },
        },
      },
    });
  }

  /** Las citas que nombran las lineas, incluidas las canceladas: la linea es de cuando paso. */
  private loadAppointments(tenantId: string, rows: { metadata: unknown }[]) {
    const ids = [...new Set(rows.map((r) => ((r.metadata ?? {}) as any).appointmentId).filter((id): id is string => typeof id === 'string'))];
    return this.prisma.appointment.findMany({
      where: { tenantId, id: { in: ids } },
      select: {
        id: true,
        channelAccountId: true,
        startsAt: true,
        doctor: { select: { code: true } },
        contact: { select: { name: true, phone: true } },
      },
    });
  }

  /** La linea en palabras, o null si no va en la bitacora. */
  private describe(
    row: Row,
    appt: Appt | undefined,
    ctx: { tz: string; doctorCode: Map<string, string>; userName: Map<string, string> },
  ): { actor: ActivityActor; category: ActivityCategory; text: string } | null {
    const m = (row.metadata ?? {}) as any;
    const contact = row.conversation?.contact ?? appt?.contact;
    const patient = contact ? contact.name?.trim() || (contact.phone ? `+${contact.phone}` : 'Un cliente') : 'Un cliente';
    const who = row.userId ? 'user' : 'bot';
    const when = (iso: string | Date | undefined, doctorId?: string) => {
      if (!iso) return '';
      const local = toLocal(new Date(iso), ctx.tz);
      const doctor = (doctorId && ctx.doctorCode.get(doctorId)) || '';
      return `${dayText(local.date)}, ${hourText(local.minute)}${doctor ? ` con ${doctor}` : ''}`;
    };
    const apptWhen = appt ? when(appt.startsAt) : '';

    switch (row.action) {
      case 'conversation.created':
        return { actor: 'patient', category: 'bot', text: `${patient} escribió (conversación nueva)` };
      case 'conversation.started':
        return { actor: 'user', category: 'team', text: `Le escribió a ${patient} (conversación nueva)` };
      case 'conversation.assigned': {
        // Un usuario borrado despues ya no tiene nombre, pero la conversacion si se asigno.
        if (!m.to) return { actor: 'user', category: 'team', text: `Dejó sin asignar la conversación de ${patient}` };
        return { actor: 'user', category: 'team', text: `Asignó la conversación de ${patient} a ${ctx.userName.get(m.to) ?? 'otra persona'}` };
      }
      case 'conversation.bot_handoff': {
        if (m.reason === 'manual_takeover') return { actor: 'user', category: 'team', text: `Tomó la conversación de ${patient} (la tenía el bot)` };
        const reason = HANDOFF_REASONS[m.reason as string];
        const tail = m.assignedUserId ? `, quedó con ${ctx.userName.get(m.assignedUserId) ?? 'otra persona'}` : ', sin asignar';
        return { actor: 'bot', category: 'handoffs', text: `Pasó a ${patient} a un operador${reason ? `: ${reason}` : ''}${tail}` };
      }
      case 'conversation.status.closed':
        return { actor: 'user', category: 'team', text: `Cerró la conversación con ${patient}` };
      case 'conversation.status.open':
        return { actor: 'user', category: 'team', text: `Reabrió la conversación con ${patient}` };
      case 'conversation.status.pending':
        return { actor: 'user', category: 'team', text: `Dejó pendiente la conversación con ${patient}` };
      case 'conversation.order_lookup_resolved':
        return { actor: 'bot', category: 'bot', text: `Le consultó a ${patient} el dato ${m.orderNumber ?? ''}`.trim() };
      case 'bot.resolved_without_agent':
        return { actor: 'bot', category: 'bot', text: `Atendió a ${patient} y cerró la conversación sin operador` };

      case 'appointment.created': {
        const at = when(m.startsAt ?? appt?.startsAt, m.doctorId);
        if (m.source === 'bot') return { actor: 'bot', category: 'appointments', text: `${patient} reservó una cita: ${at}` };
        return { actor: who, category: 'appointments', text: `Agendó una cita a ${patient}: ${at}` };
      }
      case 'appointment.moved': {
        const to = when(m.to?.startsAt, m.to?.doctorId);
        if (m.source === 'patient') return { actor: 'patient', category: 'appointments', text: `${patient} cambió su cita al ${to}` };
        return { actor: who, category: 'appointments', text: `Movió la cita de ${patient} al ${to}` };
      }
      case 'appointment.extended':
        return { actor: who, category: 'appointments', text: `Alargó ${m.minutes ?? 15} min la cita de ${patient}` };
      case 'appointment.status': {
        if (m.to === 'CANCELLED') {
          if (m.source === 'patient') return { actor: 'patient', category: 'appointments', text: `${patient} canceló su cita del ${apptWhen}` };
          return { actor: who, category: 'appointments', text: `Canceló la cita de ${patient} del ${apptWhen}` };
        }
        const status = STATUS_TEXT[m.to as string];
        if (!status) return null;
        return { actor: who, category: 'appointments', text: `Marcó como ${status} la cita de ${patient} del ${apptWhen}` };
      }
      case 'appointment.patient_reply':
        if (m.kind === 'CONFIRM') return { actor: 'patient', category: 'appointments', text: `${patient} confirmó su cita del ${apptWhen}` };
        if (m.kind === 'RESCHEDULE') return { actor: 'patient', category: 'appointments', text: `${patient} pidió reprogramar su cita del ${apptWhen}` };
        return null;
    }
    return null;
  }
}
