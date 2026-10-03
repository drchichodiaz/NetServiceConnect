import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AgendaSettingsService } from '../agenda/agenda-settings.service';
import { TemplatesService } from '../templates/templates.service';
import { CreateTemplateDto } from '../templates/dto/create-template.dto';

type SettingKey =
  | 'confirmationTemplateId'
  | 'reminderTemplateId'
  | 'doctorSummaryTemplateId'
  | 'delayTemplateId'
  | 'doctorCalendarTemplateId';

interface DefaultTemplate {
  setting: SettingKey;
  name: string;
  bodyText: string;
  exampleValues: string[];
  buttons?: (base: string) => CreateTemplateDto['buttons'];
}

/**
 * Las plantillas con las que arranca la agenda de una clinica. El orden de las variables
 * es el que llena AgendaNotifierService: cambiar un texto aca sin mirar alla rompe el aviso.
 */
const DEFAULTS: DefaultTemplate[] = [
  {
    setting: 'confirmationTemplateId',
    name: 'cita_confirmada',
    bodyText: 'Su cita en {{1}} quedó agendada para el {{2}} a las {{3}}. Si necesita cambiarla, responda a este mensaje.',
    exampleValues: ['Clínica Centro', 'lunes 12 de octubre', '10:00 a.m.'],
  },
  {
    setting: 'reminderTemplateId',
    name: 'cita_recordatorio',
    bodyText: 'Le recordamos su cita de mañana {{1}} a las {{2}} en {{3}}. Por favor confirme su asistencia con uno de los botones.',
    exampleValues: ['lunes 12 de octubre', '10:00 a.m.', 'Clínica Centro'],
    buttons: () => [
      { type: 'QUICK_REPLY', text: 'Confirmo' },
      { type: 'QUICK_REPLY', text: 'Reprogramar' },
    ],
  },
  {
    setting: 'doctorSummaryTemplateId',
    name: 'agenda_doctor_dia',
    bodyText: 'Buenos días, {{1}}. Hoy tiene {{2}} citas en {{3}}, de {{4}} a {{5}}. Puede ver el detalle en el botón de abajo.',
    exampleValues: ['Dra. Pérez', '8', 'Clínica Centro', '8:00 a.m.', '4:30 p.m.'],
    buttons: (base) => [{ type: 'URL', text: 'Ver mis citas', url: `${base}/mis-citas/{{1}}`, urlExample: 'ejemplo123' }],
  },
  {
    setting: 'delayTemplateId',
    name: 'cita_atraso',
    bodyText: 'Le informamos que su doctor en {{1}} viene con unos minutos de atraso. Gracias por su paciencia.',
    exampleValues: ['Clínica Centro'],
  },
  {
    setting: 'doctorCalendarTemplateId',
    name: 'agenda_doctor_calendario',
    bodyText: 'Hola, {{1}}. Ya puede ver sus citas en el calendario de su teléfono. Toque el botón de abajo, elija su calendario y acepte. Se hace una sola vez.',
    exampleValues: ['Dra. Pérez'],
    buttons: (base) => [{ type: 'URL', text: 'Agregar a mi calendario', url: `${base}/calendario/{{1}}`, urlExample: 'ejemplo123' }],
  },
];

@Injectable()
export class AgendaTemplatesService {
  constructor(
    private prisma: PrismaService,
    private config: ConfigService,
    private settings: AgendaSettingsService,
    private templates: TemplatesService,
  ) {}

  /**
   * Crea en Meta las plantillas de la agenda que le falten a la empresa y deja cada una
   * elegida en su aviso. Se puede repetir: una plantilla que ya existe con ese nombre
   * (en cualquier idioma) no se vuelve a crear ni se toca, y un aviso que ya tiene una
   * plantilla elegida la conserva.
   *
   * Meta guarda las plantillas por WABA, asi que se crean en cada WABA con lineas activas.
   * Una que falla no frena a las demas: se informa cual y por que.
   */
  async createDefaults(tenantId: string, origin?: string) {
    await this.settings.requireEnabled(tenantId);

    // Los botones de enlace llevan la direccion de este entorno. La configurada manda; el
    // origen del pedido es el respaldo para un entorno que no la tenga cargada.
    const base = (this.config.get<string>('FRONTEND_URL') || origin || '').replace(/\/$/, '');
    if (!/^https:\/\//i.test(base)) {
      throw new BadRequestException('Este entorno no tiene una dirección pública (https) para los botones de enlace');
    }

    const lines = await this.prisma.channelAccount.findMany({
      where: { tenantId, channel: 'WHATSAPP', isActive: true, wabaId: { not: null } },
      select: { wabaId: true },
    });
    const wabaIds = [...new Set(lines.map((l) => l.wabaId as string))];
    if (wabaIds.length === 0) throw new BadRequestException('Conecte primero una línea de WhatsApp');

    const created: string[] = [];
    const existing: string[] = [];
    const failed: { name: string; error: string }[] = [];
    const chosen: Partial<Record<SettingKey, string>> = {};

    for (const def of DEFAULTS) {
      let anyCreated = false;
      for (const wabaId of wabaIds) {
        let template = await this.prisma.messageTemplate.findFirst({ where: { tenantId, wabaId, name: def.name } });
        if (!template) {
          try {
            template = await this.templates.create(tenantId, {
              name: def.name,
              language: 'es',
              category: 'UTILITY',
              wabaId,
              bodyText: def.bodyText,
              exampleValues: def.exampleValues,
              buttons: def.buttons?.(base),
            });
            anyCreated = true;
          } catch (err: any) {
            failed.push({ name: def.name, error: err?.message || 'No se pudo crear' });
            continue;
          }
        }
        chosen[def.setting] ??= template.id;
      }
      if (anyCreated) created.push(def.name);
      else if (chosen[def.setting]) existing.push(def.name);
    }

    const current = await this.settings.get(tenantId);
    const assign: Partial<Record<SettingKey, string>> = {};
    for (const def of DEFAULTS) {
      if (!current[def.setting] && chosen[def.setting]) assign[def.setting] = chosen[def.setting];
    }
    const saved = Object.keys(assign).length ? await this.settings.update(tenantId, assign) : current;

    return { created, existing, failed, settings: saved };
  }
}
