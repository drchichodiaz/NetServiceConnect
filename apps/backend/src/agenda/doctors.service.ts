import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { normalizePhone } from '../contacts/contacts-import.util';
import { AgendaSettingsService } from './agenda-settings.service';
import { CreateDoctorDto, CreateExceptionDto, SetShiftsDto, ShiftDto, UpdateDoctorDto } from './dto/agenda.dto';
import { addDays, dateColumn, fromDateColumn, fromLocal, isValidDate, MINUTES_PER_DAY, toLocal } from './agenda-time';
import { overlaps } from './availability';

const WEEKDAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

/** Los horarios van de a 15 minutos, que es el paso de la grilla de la agenda. */
function assertGrid(minute: number, what: string) {
  if (minute % 15 !== 0) throw new BadRequestException(`${what} tiene que caer en un cuarto de hora (:00, :15, :30 o :45)`);
}

function hhmm(minute: number) {
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
}

/**
 * Doctores, su turno semanal y las excepciones de un dia. Lo administra la
 * coordinacion; la recepcion solo lo lee a traves de la disponibilidad.
 */
@Injectable()
export class DoctorsService {
  constructor(
    private prisma: PrismaService,
    private settings: AgendaSettingsService,
  ) {}

  async list(tenantId: string) {
    await this.settings.requireEnabled(tenantId);
    return this.prisma.doctor.findMany({
      where: { tenantId },
      orderBy: [{ isActive: 'desc' }, { code: 'asc' }],
      include: {
        shifts: {
          orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
          select: { id: true, weekday: true, startMinute: true, endMinute: true, channelAccountId: true },
        },
      },
    });
  }

  async create(tenantId: string, dto: CreateDoctorDto) {
    await this.settings.requireEnabled(tenantId);
    const code = dto.code.trim();
    await this.assertCodeFree(tenantId, code);
    return this.prisma.doctor.create({
      data: { tenantId, code, name: dto.name.trim(), phone: this.cleanPhone(dto.phone) },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateDoctorDto) {
    await this.settings.requireEnabled(tenantId);
    const doctor = await this.findOrThrow(tenantId, id);

    const data: Record<string, unknown> = {};
    if (dto.code !== undefined && dto.code.trim() !== doctor.code) {
      await this.assertCodeFree(tenantId, dto.code.trim());
      data.code = dto.code.trim();
    }
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.phone !== undefined) data.phone = this.cleanPhone(dto.phone);
    // Desactivar no toca sus citas: las que ya tiene se siguen viendo en la agenda y la
    // clinica decide que hacer con ellas. Lo que deja de pasar es que le asignen nuevas.
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    return this.prisma.doctor.update({ where: { id }, data });
  }

  /**
   * Reemplaza el turno semanal entero. Se manda completo y no turno por turno porque
   * asi se edita en pantalla (la semana del doctor de una vez), y porque validar que
   * no se pisen solo tiene sentido mirando todos juntos.
   */
  async setShifts(tenantId: string, doctorId: string, dto: SetShiftsDto) {
    await this.settings.requireEnabled(tenantId);
    await this.findOrThrow(tenantId, doctorId);
    await this.assertLines(tenantId, dto.shifts.map((s) => s.channelAccountId));

    for (const s of dto.shifts) this.assertShiftHours(s);

    // Un doctor no puede estar en dos clinicas a la vez, ni tener dos turnos pisados en
    // la misma: con turnos superpuestos la disponibilidad lo contaria dos veces.
    const byDay = new Map<number, ShiftDto[]>();
    for (const s of dto.shifts) byDay.set(s.weekday, [...(byDay.get(s.weekday) ?? []), s]);
    for (const [weekday, list] of byDay) {
      const sorted = [...list].sort((a, b) => a.startMinute - b.startMinute);
      for (let i = 1; i < sorted.length; i++) {
        const a = sorted[i - 1];
        const b = sorted[i];
        if (overlaps({ start: a.startMinute, end: a.endMinute }, { start: b.startMinute, end: b.endMinute })) {
          throw new BadRequestException(
            `El ${WEEKDAYS[weekday]} tiene dos turnos que se pisan (${hhmm(a.startMinute)}–${hhmm(a.endMinute)} y ${hhmm(b.startMinute)}–${hhmm(b.endMinute)})`,
          );
        }
      }
    }

    await this.prisma.$transaction([
      this.prisma.doctorShift.deleteMany({ where: { doctorId } }),
      this.prisma.doctorShift.createMany({
        data: dto.shifts.map((s) => ({
          tenantId,
          doctorId,
          channelAccountId: s.channelAccountId,
          weekday: s.weekday,
          startMinute: s.startMinute,
          endMinute: s.endMinute,
        })),
      }),
    ]);

    return this.prisma.doctorShift.findMany({
      where: { doctorId },
      orderBy: [{ weekday: 'asc' }, { startMinute: 'asc' }],
      select: { id: true, weekday: true, startMinute: true, endMinute: true, channelAccountId: true },
    });
  }

  /** Excepciones entre dos fechas (inclusive). Sin rango: de hoy a 60 dias. */
  async listExceptions(tenantId: string, from?: string, to?: string, doctorId?: string) {
    const settings = await this.settings.requireEnabled(tenantId);
    const today = toLocal(new Date(), settings.timezone).date;
    const start = from ?? today;
    const end = to ?? addDays(start, 60);
    if (!isValidDate(start) || !isValidDate(end)) throw new BadRequestException('Fecha inválida');

    const rows = await this.prisma.doctorException.findMany({
      where: {
        tenantId,
        ...(doctorId && { doctorId }),
        date: { gte: dateColumn(start), lte: dateColumn(end) },
      },
      orderBy: [{ date: 'asc' }, { startMinute: 'asc' }],
      include: { doctor: { select: { id: true, code: true, name: true } } },
    });
    return rows.map((r) => ({ ...r, date: fromDateColumn(r.date) }));
  }

  async createException(tenantId: string, dto: CreateExceptionDto) {
    const settings = await this.settings.requireEnabled(tenantId);
    await this.findOrThrow(tenantId, dto.doctorId);
    if (!isValidDate(dto.date)) throw new BadRequestException('Fecha inválida');

    const hasStart = dto.startMinute !== undefined;
    const hasEnd = dto.endMinute !== undefined;
    if (hasStart !== hasEnd) throw new BadRequestException('Falta la hora de inicio o la de fin');
    if (hasStart) this.assertShiftHours({ startMinute: dto.startMinute!, endMinute: dto.endMinute! });

    if (dto.kind === 'WORKS_AT') {
      if (!dto.channelAccountId) throw new BadRequestException('Falta la clínica de ese día');
      if (!hasStart) throw new BadRequestException('Falta el horario de ese día');
      await this.assertLines(tenantId, [dto.channelAccountId]);
      // Mismo motivo que en el turno semanal: dos tramos pisados lo pondrian en dos
      // clinicas a la vez.
      const sameDay = await this.prisma.doctorException.findMany({
        where: { doctorId: dto.doctorId, date: dateColumn(dto.date), kind: 'WORKS_AT' },
      });
      const clash = sameDay.find((e) =>
        overlaps({ start: e.startMinute!, end: e.endMinute! }, { start: dto.startMinute!, end: dto.endMinute! }),
      );
      if (clash) {
        throw new BadRequestException(
          `Ese día ya tiene otra clínica cargada de ${hhmm(clash.startMinute!)} a ${hhmm(clash.endMinute!)}`,
        );
      }
    } else if (dto.channelAccountId) {
      // Una ausencia es del doctor, no de una clinica: si falta, falta en todas.
      throw new BadRequestException('Una ausencia no lleva clínica');
    }

    const exception = await this.prisma.doctorException.create({
      data: {
        tenantId,
        doctorId: dto.doctorId,
        date: dateColumn(dto.date),
        kind: dto.kind,
        startMinute: dto.startMinute ?? null,
        endMinute: dto.endMinute ?? null,
        channelAccountId: dto.kind === 'WORKS_AT' ? dto.channelAccountId! : null,
        note: dto.note?.trim() || null,
      },
    });

    // Una ausencia no cancela nada sola: las citas que ya estaban quedan donde estan y
    // la recepcion decide si las mueve o las pasa a otro doctor. Pero la coordinacion
    // tiene que enterarse en el momento, no el dia que el paciente llega.
    let affectedAppointments = 0;
    if (dto.kind === 'ABSENT') {
      const from = fromLocal(dto.date, dto.startMinute ?? 0, settings.timezone);
      const to = fromLocal(dto.date, dto.endMinute ?? MINUTES_PER_DAY, settings.timezone);
      affectedAppointments = await this.prisma.appointment.count({
        where: { doctorId: dto.doctorId, status: { not: 'CANCELLED' }, startsAt: { lt: to }, endsAt: { gt: from } },
      });
    }

    return { ...exception, date: fromDateColumn(exception.date), affectedAppointments };
  }

  async deleteException(tenantId: string, id: string) {
    await this.settings.requireEnabled(tenantId);
    const row = await this.prisma.doctorException.findFirst({ where: { id, tenantId } });
    if (!row) throw new NotFoundException('Excepción no encontrada');
    await this.prisma.doctorException.delete({ where: { id } });
    return { ok: true };
  }

  private async findOrThrow(tenantId: string, id: string) {
    const doctor = await this.prisma.doctor.findFirst({ where: { id, tenantId } });
    if (!doctor) throw new NotFoundException('Doctor no encontrado');
    return doctor;
  }

  private async assertCodeFree(tenantId: string, code: string) {
    const taken = await this.prisma.doctor.findUnique({ where: { tenantId_code: { tenantId, code } } });
    if (taken) throw new ConflictException(`Ya hay un doctor con el código ${code}`);
  }

  /** Que todas las clinicas sean lineas de WhatsApp de esta empresa. */
  private async assertLines(tenantId: string, ids: string[]) {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return;
    const found = await this.prisma.channelAccount.count({
      where: { id: { in: unique }, tenantId, channel: 'WHATSAPP' },
    });
    if (found !== unique.length) throw new BadRequestException('Alguna de las clínicas no existe');
  }

  private assertShiftHours(s: { startMinute: number; endMinute: number }) {
    if (s.startMinute >= s.endMinute) throw new BadRequestException('La hora de fin tiene que ser posterior a la de inicio');
    assertGrid(s.startMinute, 'La hora de inicio');
    assertGrid(s.endMinute, 'La hora de fin');
  }

  private cleanPhone(raw?: string): string | null {
    if (!raw) return null;
    const phone = normalizePhone(raw);
    if (!phone) return null;
    // Con codigo de pais: un numero local de 8 digitos no le llega a nadie por WhatsApp.
    if (phone.length < 10) throw new BadRequestException('El WhatsApp del doctor va con código de país (ej: 502 5300 0000)');
    return phone;
  }
}
