import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateAgendaSettingsDto } from './dto/agenda.dto';

const TEMPLATE_FIELDS = [
  'confirmationTemplateId',
  'reminderTemplateId',
  'doctorSummaryTemplateId',
  'delayTemplateId',
] as const;

/** Lo que vale mientras la empresa no tiene fila: los mismos defaults que la tabla. */
const DEFAULTS = {
  enabled: false,
  slotMinutes: 45,
  reminderHoursBefore: 24,
  doctorSummaryHour: 7,
  confirmationTemplateId: null,
  reminderTemplateId: null,
  doctorSummaryTemplateId: null,
  delayTemplateId: null,
};

/**
 * Configuracion de la agenda de una empresa.
 *
 * Quien la ACTIVA es el super admin, desde la pantalla de Empresas (TenantsService): la
 * agenda se vende aparte y una empresa no deberia poder prenderla sola. Lo que se
 * ajusta aca —duracion, avisos, plantillas— lo decide la coordinacion de la empresa.
 */
@Injectable()
export class AgendaSettingsService {
  constructor(private prisma: PrismaService) {}

  async get(tenantId: string) {
    const [row, tenant] = await Promise.all([
      this.prisma.agendaSettings.findUnique({ where: { tenantId } }),
      this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { timezone: true } }),
    ]);
    const base = row ?? DEFAULTS;
    return {
      enabled: base.enabled,
      slotMinutes: base.slotMinutes,
      reminderHoursBefore: base.reminderHoursBefore,
      doctorSummaryHour: base.doctorSummaryHour,
      confirmationTemplateId: base.confirmationTemplateId,
      reminderTemplateId: base.reminderTemplateId,
      doctorSummaryTemplateId: base.doctorSummaryTemplateId,
      delayTemplateId: base.delayTemplateId,
      timezone: tenant.timezone,
    };
  }

  /** La configuracion, o un 403 si la empresa no tiene la agenda activada. */
  async requireEnabled(tenantId: string) {
    const settings = await this.get(tenantId);
    if (!settings.enabled) throw new ForbiddenException('La agenda no está activada para esta empresa');
    return settings;
  }

  async update(tenantId: string, dto: UpdateAgendaSettingsDto) {
    await this.requireEnabled(tenantId);

    if (dto.slotMinutes !== undefined && dto.slotMinutes % 15 !== 0) {
      throw new BadRequestException('La duración de la cita tiene que ser múltiplo de 15 minutos');
    }

    const data: Record<string, unknown> = {};
    for (const key of ['slotMinutes', 'reminderHoursBefore', 'doctorSummaryHour'] as const) {
      if (dto[key] !== undefined) data[key] = dto[key];
    }
    for (const key of TEMPLATE_FIELDS) {
      const value = dto[key];
      if (value === undefined) continue;
      if (!value) {
        data[key] = null;
        continue;
      }
      // Solo que sea de la empresa: puede estar pendiente de aprobacion. El envio es el
      // que exige que este aprobada, y asi se puede dejar configurada mientras Meta decide.
      const template = await this.prisma.messageTemplate.findFirst({ where: { id: value, tenantId } });
      if (!template) throw new BadRequestException('Esa plantilla no existe');
      data[key] = value;
    }

    await this.prisma.agendaSettings.update({ where: { tenantId }, data });
    return this.get(tenantId);
  }
}
