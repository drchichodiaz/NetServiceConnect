import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AppointmentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EventBusService } from '../events/event-bus.service';
import { ContactIdentityService } from '../contacts/contact-identity.service';
import { ChannelAccessService } from '../common/services/channel-access.service';
import { normalizePhone } from '../contacts/contacts-import.util';
import { AgendaSettingsService } from './agenda-settings.service';
import { AvailabilityService } from './availability.service';
import { toLocal } from './agenda-time';
import { CreateAppointmentDto, UpdateAppointmentDto } from './dto/appointments.dto';

type Actor = { id: string; tenantId: string };

/** Estados en que la cita sigue ocupando el horario del doctor. */
const ACTIVE: AppointmentStatus[] = ['SCHEDULED', 'CONFIRMED', 'ARRIVED', 'DONE', 'NO_SHOW'];

/** Lo que se devuelve de una cita: con el paciente y el doctor, que es lo que se pinta. */
const INCLUDE = {
  contact: { select: { id: true, name: true, phone: true } },
  doctor: { select: { id: true, code: true, name: true } },
} as const;

/**
 * La base rechazo la cita porque el doctor ya tiene otra que se pisa (restriccion
 * Appointment_no_overlap). Prisma no trae el codigo de Postgres (23P01) en `code`: llega
 * como un error de conector con el texto crudo, asi que se reconoce por el mensaje.
 */
function isOverlapError(err: unknown): boolean {
  const text = String((err as any)?.message ?? '');
  return text.includes('Appointment_no_overlap') || text.includes('23P01');
}

function hhmm(minute: number) {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

/**
 * Crear, mover, alargar y cerrar citas.
 *
 * El doctor lo elige el sistema entre los libres (AvailabilityService.freeDoctors), pero
 * quien garantiza que no haya dos citas pisadas es la base: entre calcular quien esta
 * libre y guardar pasan milisegundos, y en ese hueco otra recepcion puede haber dado el
 * mismo horario. Cuando pasa, la base rechaza la segunda y aca se reintenta una vez con
 * el siguiente doctor libre, o se explica que el horario se acaba de ocupar.
 */
@Injectable()
export class AppointmentsService {
  constructor(
    private prisma: PrismaService,
    private settings: AgendaSettingsService,
    private availability: AvailabilityService,
    private identities: ContactIdentityService,
    private channelAccess: ChannelAccessService,
    private events: EventBusService,
  ) {}

  async get(actor: Actor, id: string) {
    const appt = await this.findAccessible(actor, id);
    return appt;
  }

  /** Las proximas citas de un paciente, en las clinicas que el usuario puede ver. */
  async listForContact(actor: Actor, contactId: string) {
    await this.settings.requireEnabled(actor.tenantId);
    const allowed = await this.channelAccess.allowedAccountIds(actor.id);
    return this.prisma.appointment.findMany({
      where: {
        tenantId: actor.tenantId,
        contactId,
        endsAt: { gte: new Date() },
        status: { not: 'CANCELLED' },
        ...(allowed && { channelAccountId: { in: allowed } }),
      },
      orderBy: { startsAt: 'asc' },
      take: 20,
      include: INCLUDE,
    });
  }

  async create(actor: Actor, dto: CreateAppointmentDto) {
    const settings = await this.settings.requireEnabled(actor.tenantId);
    await this.availability.assertClinicAccess(actor.tenantId, actor, dto.channelAccountId);

    const minutes = dto.minutes ?? settings.slotMinutes;
    const startsAt = this.parseStart(dto.startsAt, settings.timezone);
    const endsAt = new Date(startsAt.getTime() + minutes * 60000);
    this.assertNotPast(endsAt);
    this.assertLength(minutes);

    const contactId = await this.resolveContact(actor.tenantId, dto);

    for (let attempt = 0; attempt < 2; attempt++) {
      const doctorId = await this.pickDoctor(actor.tenantId, dto.channelAccountId, startsAt, minutes, dto.doctorId);
      try {
        const appt = await this.prisma.appointment.create({
          data: {
            tenantId: actor.tenantId,
            channelAccountId: dto.channelAccountId,
            doctorId,
            contactId,
            startsAt,
            endsAt,
            reason: dto.reason?.trim() || null,
            notes: dto.notes?.trim() || null,
            createdById: actor.id,
          },
          include: INCLUDE,
        });
        await this.audit(actor, 'appointment.created', appt.id, { doctorId, startsAt });
        this.publish(actor.tenantId, appt.channelAccountId);
        return appt;
      } catch (err) {
        // Doctor elegido a mano: no hay a quien pasar la cita, se explica y listo.
        if (!isOverlapError(err) || dto.doctorId || attempt === 1) throw this.translate(err);
      }
    }
    throw new ConflictException('Ese horario se acaba de ocupar. Elija otro.');
  }

  /**
   * Mover (hora, duracion o clinica), cambiar de doctor, o editar motivo y notas.
   *
   * Si cambia la hora y no se eligio doctor, se queda con el que tenia si sigue libre;
   * si no, se asigna otro. Mover una cita la vuelve a dejar "agendada": la confirmacion
   * que habia dado el paciente era para el horario viejo, y el recordatorio tiene que
   * volver a salir para el nuevo.
   */
  async update(actor: Actor, id: string, dto: UpdateAppointmentDto) {
    const settings = await this.settings.requireEnabled(actor.tenantId);
    const current = await this.findAccessible(actor, id);
    this.assertOpen(current.status);

    const channelAccountId = dto.channelAccountId ?? current.channelAccountId;
    if (channelAccountId !== current.channelAccountId) {
      await this.availability.assertClinicAccess(actor.tenantId, actor, channelAccountId);
    }

    const startsAt = dto.startsAt ? this.parseStart(dto.startsAt, settings.timezone) : current.startsAt;
    const minutes = dto.minutes ?? Math.round((current.endsAt.getTime() - current.startsAt.getTime()) / 60000);
    this.assertLength(minutes);
    const endsAt = new Date(startsAt.getTime() + minutes * 60000);

    const moved =
      startsAt.getTime() !== current.startsAt.getTime() ||
      endsAt.getTime() !== current.endsAt.getTime() ||
      channelAccountId !== current.channelAccountId;
    const reassigned = dto.doctorId !== undefined && dto.doctorId !== current.doctorId;

    let doctorId = current.doctorId;
    if (moved || reassigned) {
      if (moved) this.assertNotPast(endsAt);
      const free = await this.availability.freeDoctors(actor.tenantId, channelAccountId, startsAt, minutes, id);
      if (dto.doctorId) {
        if (!free.some((d) => d.id === dto.doctorId)) {
          throw new ConflictException('Ese doctor no está libre en ese horario');
        }
        doctorId = dto.doctorId;
      } else if (!free.some((d) => d.id === current.doctorId)) {
        if (free.length === 0) throw new ConflictException('No hay doctores libres en ese horario');
        doctorId = free[0].id;
      }
    }

    const data: Record<string, unknown> = { channelAccountId, doctorId, startsAt, endsAt };
    if (dto.reason !== undefined) data.reason = dto.reason.trim() || null;
    if (dto.notes !== undefined) data.notes = dto.notes.trim() || null;
    if (moved && (startsAt.getTime() !== current.startsAt.getTime() || channelAccountId !== current.channelAccountId)) {
      Object.assign(data, {
        status: current.status === 'CONFIRMED' ? 'SCHEDULED' : current.status,
        confirmedAt: null,
        reminderSentAt: null,
        reminderMessageId: null,
        rescheduleRequestedAt: null,
        // Sale una confirmacion nueva con el horario nuevo (la manda el worker).
        confirmationSentAt: null,
        confirmationMessageId: null,
        notifyError: null,
      });
    }

    try {
      const appt = await this.prisma.appointment.update({ where: { id }, data, include: INCLUDE });
      if (moved || reassigned) {
        await this.audit(actor, 'appointment.moved', id, {
          from: { startsAt: current.startsAt, doctorId: current.doctorId, channelAccountId: current.channelAccountId },
          to: { startsAt, doctorId, channelAccountId },
        });
      }
      this.publish(actor.tenantId, current.channelAccountId, channelAccountId);
      return appt;
    } catch (err) {
      throw this.translate(err);
    }
  }

  /**
   * Alargar de a 15 minutos, siempre con el mismo doctor: la consulta ya esta en curso,
   * no se le puede pasar el paciente a otro. Si choca con la cita siguiente, el error
   * dice con cual, que es lo que necesita la recepcion para avisarle al que espera.
   */
  async extend(actor: Actor, id: string, minutes = 15) {
    const settings = await this.settings.requireEnabled(actor.tenantId);
    const current = await this.findAccessible(actor, id);
    this.assertOpen(current.status);
    if (minutes % 15 !== 0 || minutes <= 0 || minutes > 120) throw new BadRequestException('Se alarga de a 15 minutos');

    const endsAt = new Date(current.endsAt.getTime() + minutes * 60000);
    const next = await this.prisma.appointment.findFirst({
      where: {
        doctorId: current.doctorId,
        id: { not: id },
        status: { in: ACTIVE },
        startsAt: { lt: endsAt },
        endsAt: { gt: current.endsAt },
      },
      orderBy: { startsAt: 'asc' },
      include: { contact: { select: { name: true, phone: true } } },
    });
    if (next) {
      const at = hhmm(toLocal(next.startsAt, settings.timezone).minute);
      throw new ConflictException({
        message: `El doctor tiene otra cita a las ${at} (${next.contact.name || next.contact.phone || 'otro paciente'})`,
        nextAppointmentId: next.id,
      });
    }

    // Tampoco puede pasarse del turno del doctor en esa clinica.
    const free = await this.availability.freeDoctors(
      actor.tenantId,
      current.channelAccountId,
      current.startsAt,
      Math.round((endsAt.getTime() - current.startsAt.getTime()) / 60000),
      id,
    );
    if (!free.some((d) => d.id === current.doctorId)) {
      throw new ConflictException('Alargarla se pasa del horario del doctor en esta clínica');
    }

    try {
      const appt = await this.prisma.appointment.update({ where: { id }, data: { endsAt }, include: INCLUDE });
      await this.audit(actor, 'appointment.extended', id, { minutes });
      this.publish(actor.tenantId, current.channelAccountId);
      return appt;
    } catch (err) {
      throw this.translate(err);
    }
  }

  /**
   * Cambia el estado. Cancelar libera el horario (la restriccion anti-choques ignora
   * las canceladas). Una cancelada no se reactiva: su horario ya pudo haberse dado, y
   * reactivarla podria pisar otra cita. Se crea una nueva.
   */
  async setStatus(actor: Actor, id: string, status: AppointmentStatus) {
    await this.settings.requireEnabled(actor.tenantId);
    const current = await this.findAccessible(actor, id);
    if (current.status === 'CANCELLED') throw new BadRequestException('La cita está cancelada. Cree una nueva.');
    if (current.status === status) return current;

    const now = new Date();
    const data: Record<string, unknown> = { status };
    if (status === 'CANCELLED') data.cancelledAt = now;
    if (status === 'CONFIRMED') data.confirmedAt = now;

    const appt = await this.prisma.appointment.update({ where: { id }, data, include: INCLUDE });
    await this.audit(actor, 'appointment.status', id, { from: current.status, to: status });
    this.publish(actor.tenantId, current.channelAccountId);
    return appt;
  }

  // ─── Internos ────────────────────────────────────────────────────────────────

  private async findAccessible(actor: Actor, id: string) {
    await this.settings.requireEnabled(actor.tenantId);
    const appt = await this.prisma.appointment.findFirst({ where: { id, tenantId: actor.tenantId }, include: INCLUDE });
    if (!appt) throw new NotFoundException('Cita no encontrada');
    if (!(await this.channelAccess.canAccessAccount(actor.id, appt.channelAccountId))) {
      throw new ForbiddenException('No tiene acceso a la agenda de esa clínica');
    }
    return appt;
  }

  private async pickDoctor(tenantId: string, channelAccountId: string, startsAt: Date, minutes: number, wanted?: string) {
    const free = await this.availability.freeDoctors(tenantId, channelAccountId, startsAt, minutes);
    if (wanted) {
      if (!free.some((d) => d.id === wanted)) throw new ConflictException('Ese doctor no está libre en ese horario');
      return wanted;
    }
    if (free.length === 0) throw new ConflictException('No hay doctores libres en ese horario');
    return free[0].id;
  }

  /**
   * El paciente: uno que ya existe (desde la conversacion o el buscador), o uno nuevo
   * por telefono. Por telefono se resuelve igual que cuando escribe por WhatsApp, asi
   * que si despues escribe, cae en la misma ficha y no en una duplicada.
   */
  private async resolveContact(tenantId: string, dto: CreateAppointmentDto): Promise<string> {
    if (dto.contactId) {
      const contact = await this.prisma.contact.findFirst({ where: { id: dto.contactId, tenantId }, select: { id: true } });
      if (!contact) throw new BadRequestException('Ese paciente no existe');
      return contact.id;
    }
    const phone = dto.phone ? normalizePhone(dto.phone) : '';
    if (!phone) throw new BadRequestException('Falta el paciente: elija uno o escriba su WhatsApp');
    if (phone.length < 10) throw new BadRequestException('Falta el código de país en el WhatsApp del paciente: escriba el número completo, con el código de país adelante');
    const contact = await this.identities.resolve(tenantId, 'WHATSAPP', phone, { name: dto.name?.trim() || undefined });
    // Si ya existia sin nombre y ahora nos lo dicen, se completa.
    if (!contact.name && dto.name?.trim()) {
      await this.prisma.contact.update({ where: { id: contact.id }, data: { name: dto.name.trim() } });
    }
    return contact.id;
  }

  /** La hora tiene que ser un instante valido y caer en la grilla de 15 minutos local. */
  private parseStart(raw: string, timeZone: string): Date {
    const startsAt = new Date(raw);
    if (Number.isNaN(startsAt.getTime())) throw new BadRequestException('Hora inválida');
    if (startsAt.getUTCSeconds() !== 0 || startsAt.getUTCMilliseconds() !== 0 || toLocal(startsAt, timeZone).minute % 15 !== 0) {
      throw new BadRequestException('La cita tiene que empezar en :00, :15, :30 o :45');
    }
    return startsAt;
  }

  private assertLength(minutes: number) {
    if (!Number.isInteger(minutes) || minutes < 15 || minutes > 240 || minutes % 15 !== 0) {
      throw new BadRequestException('La duración va de a 15 minutos, hasta 4 horas');
    }
  }

  /** Se puede cargar una cita que ya empezo (el paciente llego sin turno), no una que ya termino. */
  private assertNotPast(endsAt: Date) {
    if (endsAt.getTime() <= Date.now()) throw new BadRequestException('Ese horario ya pasó');
  }

  private assertOpen(status: AppointmentStatus) {
    if (status === 'CANCELLED') throw new BadRequestException('La cita está cancelada');
    if (status === 'DONE' || status === 'NO_SHOW') throw new BadRequestException('La cita ya se cerró');
  }

  private translate(err: unknown) {
    if (isOverlapError(err)) return new ConflictException('Ese horario se acaba de ocupar. Elija otro.');
    return err;
  }

  private async audit(actor: Actor, action: string, appointmentId: string, metadata: Record<string, unknown>) {
    await this.prisma.auditLog.create({
      data: { tenantId: actor.tenantId, userId: actor.id, action, metadata: { appointmentId, ...metadata } as any },
    });
  }

  /** Avisa a las pantallas abiertas de esas clinicas que su agenda cambio. */
  private publish(tenantId: string, ...channelAccountIds: string[]) {
    this.events.publish({
      type: 'agenda_changed',
      tenantId,
      payload: { channelAccountIds: [...new Set(channelAccountIds)] },
    });
  }
}
