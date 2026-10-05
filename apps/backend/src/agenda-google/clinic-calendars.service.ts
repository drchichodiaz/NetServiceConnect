import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { isEmail } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AgendaSettingsService } from '../agenda/agenda-settings.service';
import { clinicName } from '../agenda/agenda-text';
import { GoogleCalendarClient } from './google-calendar.client';

/** Con cuantas personas se puede compartir el calendario de una clinica. */
const MAX_EMAILS = 20;

/**
 * Con quien se comparte el calendario de Google de cada clinica. Aca solo se guarda la
 * lista: crear el calendario, compartirlo y escribirle las citas lo hace
 * AgendaGoogleSyncService en su proxima vuelta.
 */
@Injectable()
export class ClinicCalendarsService {
  constructor(
    private prisma: PrismaService,
    private settings: AgendaSettingsService,
    private google: GoogleCalendarClient,
  ) {}

  /** Todas las clinicas de la empresa (lineas de WhatsApp), tengan o no calendario. */
  async list(tenantId: string) {
    await this.settings.requireEnabled(tenantId);
    const lines = await this.prisma.channelAccount.findMany({
      where: { tenantId, channel: 'WHATSAPP', isActive: true },
      orderBy: { createdAt: 'asc' },
      include: { googleCalendar: true },
    });
    return lines.map((line) => {
      const row = line.googleCalendar;
      return {
        channelAccountId: line.id,
        clinic: clinicName(line),
        emails: row?.emails ?? [],
        sharedEmails: row?.sharedEmails ?? [],
        error: row?.error ?? null,
      };
    });
  }

  async setEmails(tenantId: string, channelAccountId: string, raw: string[]) {
    await this.settings.requireEnabled(tenantId);
    if (!this.google.enabled) throw new BadRequestException('Google Calendar no está configurado en este entorno');

    const line = await this.prisma.channelAccount.findFirst({ where: { id: channelAccountId, tenantId, channel: 'WHATSAPP' } });
    if (!line) throw new NotFoundException('Clínica no encontrada');

    const emails = [...new Set(raw.map((e) => e.trim().toLowerCase()).filter(Boolean))];
    const invalid = emails.find((e) => !isEmail(e));
    if (invalid) throw new BadRequestException(`"${invalid}" no es una dirección de correo válida`);
    if (emails.length > MAX_EMAILS) throw new BadRequestException(`Se puede compartir con hasta ${MAX_EMAILS} personas`);

    // Vaciar la lista no borra la fila aca: el worker tiene que borrar antes el calendario.
    await this.prisma.clinicGoogleCalendar.upsert({
      where: { channelAccountId },
      create: { tenantId, channelAccountId, emails },
      update: { emails, error: null },
    });
    return (await this.list(tenantId)).find((c) => c.channelAccountId === channelAccountId);
  }
}
