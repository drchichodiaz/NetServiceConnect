import { Injectable, BadRequestException, NotFoundException, ForbiddenException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TemplatesService } from '../templates/templates.service';
import { WhatsAppAccountsService } from '../whatsapp/accounts.service';
import { ContactIdentityService } from '../contacts/contact-identity.service';
import { ChannelAccessService } from '../common/services/channel-access.service';
import { parseWorkbookRows, ParsedContactRow } from '../contacts/contacts-import.util';
import { describeSendVariables, TemplateButton } from '../templates/template-components';
import { CreateCampaignDto, VariableMappingDto } from './dto/create-campaign.dto';
import { buildContactTagWhere } from '../contact-tags/contact-tags.service';

/** Tope de filas por campaña. Mas que esto es un problema de otra escala (y de costo). */
const MAX_RECIPIENTS = 20000;
/** Cuantos errores de fila se devuelven al panel; el resto se resume en un contador. */
const MAX_REPORTED_ERRORS = 50;

/**
 * Un destinatario posible, venga del Excel o de los contactos del sistema.
 *
 * Existe para que todo lo de abajo (mapeo de variables, altas, armado de la campaña)
 * no sepa de donde salio la lista: la unica diferencia real entre las dos fuentes es
 * que el Excel trae columnas propias en `extra` y los contactos del sistema no.
 */
interface Candidate {
  phone: string;
  name?: string | null;
  email?: string | null;
  company?: string | null;
  /** Columnas del Excel que no son nombre/telefono/email/empresa. Vacio si vino de contactos. */
  extra: Record<string, string>;
  /** Si ya existe en la base. Los del Excel pueden no existir todavia. */
  contactId?: string;
  optedOutAt?: Date | null;
}

/**
 * Como se elige a quien le llega, cuando la lista sale de los contactos del sistema.
 * Todo lo de aca se combina: las etiquetas acotan, el texto acota mas, y una seleccion
 * explicita de contactos reemplaza a las dos.
 */
export interface ContactFilter {
  contactIds?: string[];
  contactSearch?: string;
  tagIds?: string[];
  excludeTagIds?: string[];
  tagMatch?: 'ANY' | 'ALL';
}

export interface CampaignPreview {
  totalRows: number;
  /** Filas que se van a enviar. */
  ready: number;
  /** Filas descartadas y por que. */
  invalid: number;
  duplicated: number;
  optedOut: number;
  missingVariables: number;
  /** Encabezados de las columnas que no son nombre/telefono/email/empresa. */
  extraColumns: string[];
  /** Que valores pide la plantilla elegida, para poder mapearlos. */
  needs: { header: number; body: number; buttons: { index: number; text: string }[] };
  errors: { row: number; reason: string }[];
  truncatedErrors: boolean;
  sample: { phone: string; name?: string; values: Record<string, string> }[];
}

@Injectable()
export class CampaignsService {
  private readonly logger = new Logger(CampaignsService.name);

  constructor(
    private prisma: PrismaService,
    private templates: TemplatesService,
    private accounts: WhatsAppAccountsService,
    private identities: ContactIdentityService,
    private channelAccess: ChannelAccessService,
  ) {}

  /**
   * Lee el archivo y cuenta que pasaria, sin crear nada.
   *
   * Existe porque una campaña no se puede deshacer: una vez que salio el primer
   * mensaje no hay forma de traerlo de vuelta. Ver antes cuantos van a recibir,
   * cuantos estan dados de baja y con que valores se van a llenar las variables es
   * la unica oportunidad de frenar un error.
   */
  async previewFile(tenantId: string, templateId: string, file: Express.Multer.File): Promise<CampaignPreview> {
    const template = await this.templates.findApprovedOrThrow(tenantId, templateId);
    const errors: { row: number; reason: string }[] = [];
    const { candidates, duplicated, invalid, totalRows } = await this.candidatesFromFile(tenantId, file, errors);
    return this.buildPreview(template, candidates, errors, { duplicated, invalid, totalRows });
  }

  /** Lo mismo pero sobre los contactos que ya estan en el sistema, sin archivo. */
  async previewContacts(
    tenantId: string,
    templateId: string,
    filter: ContactFilter,
  ): Promise<CampaignPreview> {
    const template = await this.templates.findApprovedOrThrow(tenantId, templateId);
    const candidates = await this.candidatesFromContacts(tenantId, filter);
    return this.buildPreview(template, candidates, [], {
      duplicated: 0,
      invalid: 0,
      totalRows: candidates.length,
    });
  }

  private buildPreview(
    template: any,
    candidates: Candidate[],
    errors: { row: number; reason: string }[],
    counts: { duplicated: number; invalid: number; totalRows: number },
  ): CampaignPreview {
    const needs = describeSendVariables({
      headerFormat: template.headerFormat,
      headerText: template.headerText,
      bodyText: template.bodyText,
      buttons: template.buttons as unknown as TemplateButton[] | null,
    });

    const optedOut = candidates.filter((c) => c.optedOutAt).length;

    return {
      totalRows: counts.totalRows,
      ready: candidates.length - optedOut,
      invalid: counts.invalid,
      duplicated: counts.duplicated,
      optedOut,
      // Con el mapeo todavia sin elegir no se puede saber cuales filas quedarian
      // incompletas; se informa cuantos valores pide la plantilla y el panel avisa.
      missingVariables: 0,
      extraColumns: this.extraColumnsOf(candidates),
      needs,
      errors: errors.slice(0, MAX_REPORTED_ERRORS),
      truncatedErrors: errors.length > MAX_REPORTED_ERRORS,
      sample: candidates.slice(0, 5).map((c) => ({
        phone: c.phone,
        name: c.name ?? undefined,
        values: { ...c.extra, __company__: c.company ?? '', __email__: c.email ?? '' },
      })),
    };
  }

  /**
   * Crea la campaña y su lista de destinatarios, en DRAFT. No manda nada todavia:
   * arrancarla es un paso aparte y explicito.
   */
  async create(tenantId: string, userId: string, dto: CreateCampaignDto, file: Express.Multer.File) {
    const account = await this.accounts.findActiveCredsOrThrow(tenantId, dto.channelAccountId);

    // Un usuario con lineas asignadas no puede lanzar una campaña desde una que no
    // le toca. Sin esto, el permiso por linea seria solo visual.
    await this.assertCanUseLine(userId, dto.channelAccountId);

    const template = await this.templates.findApprovedOrThrow(tenantId, dto.templateId, account.wabaId);

    const errors: { row: number; reason: string }[] = [];
    const fromContacts = dto.source === 'CONTACTS';
    const candidates = fromContacts
      ? await this.candidatesFromContacts(tenantId, dto)
      : (await this.candidatesFromFile(tenantId, file, errors)).candidates;

    if (candidates.length === 0) {
      throw new BadRequestException(
        fromContacts
          ? 'Ningún contacto del sistema coincide con esa selección (o ninguno tiene WhatsApp)'
          : 'El archivo no tiene ninguna fila válida para enviar',
      );
    }
    if (candidates.length > MAX_RECIPIENTS) {
      throw new BadRequestException(
        `La selección tiene ${candidates.length} destinatarios y el máximo por campaña es ${MAX_RECIPIENTS}.`,
      );
    }

    const needs = describeSendVariables({
      headerFormat: template.headerFormat,
      headerText: template.headerText,
      bodyText: template.bodyText,
      buttons: template.buttons as unknown as TemplateButton[] | null,
    });
    this.assertMappingCovers(needs, dto.mapping ?? []);

    // Los del Excel pueden no existir todavia; los del sistema ya vienen con su id.
    // Un destinatario siempre tiene que apuntar a un Contact real, para que la
    // conversacion que se abra despues tenga ficha.
    if (!fromContacts) await this.ensureContacts(tenantId, candidates);

    const campaign = await this.prisma.campaign.create({
      data: {
        tenantId,
        name: dto.name,
        templateId: template.id,
        channelAccountId: account.id,
        createdById: userId,
        ratePerMinute: dto.ratePerMinute ?? 20,
        // Para poder mirar despues a quienes se le escribio y por que. No se usa para
        // enviar: los destinatarios ya quedaron congelados en CampaignRecipient.
        recipientFilter: {
          source: dto.source ?? 'FILE',
          ...(fromContacts && {
            contactSearch: dto.contactSearch?.trim() || undefined,
            tagIds: dto.tagIds?.length ? dto.tagIds : undefined,
            excludeTagIds: dto.excludeTagIds?.length ? dto.excludeTagIds : undefined,
            tagMatch: dto.tagIds?.length ? (dto.tagMatch ?? 'ANY') : undefined,
            handPicked: dto.contactIds?.length ? dto.contactIds.length : undefined,
          }),
          ...(!fromContacts && { fileName: file?.originalname }),
        } as any,
      },
    });

    let skipped = 0;
    const rows = candidates.map((candidate) => {
      const optedOut = !!candidate.optedOutAt;
      return {
        campaignId: campaign.id,
        tenantId,
        contactId: candidate.contactId!,
        recipientPhone: candidate.phone,
        variables: this.valuesFor(candidate, dto.mapping ?? []) as any,
        // Los dados de baja entran igual pero como SKIPPED: queda constancia de que
        // estaban en la lista y de que no se les mando, que es lo que hay que poder
        // demostrar si alguien reclama.
        status: optedOut ? ('SKIPPED' as const) : ('PENDING' as const),
        ...(optedOut && { error: 'El contacto pidió no recibir envíos' }),
      };
    });
    skipped = rows.filter((r) => r.status === 'SKIPPED').length;

    await this.prisma.campaignRecipient.createMany({ data: rows, skipDuplicates: true });

    const updated = await this.prisma.campaign.update({
      where: { id: campaign.id },
      data: { totalCount: rows.length, skippedCount: skipped },
    });

    this.logger.log(
      `[campaña] creada ${campaign.id} tenant=${tenantId} origen=${dto.source ?? 'FILE'} ` +
        `destinatarios=${rows.length} salteados=${skipped} plantilla=${template.name}`,
    );

    return { ...updated, invalidRows: errors.length, errors: errors.slice(0, MAX_REPORTED_ERRORS) };
  }

  async findAll(tenantId: string) {
    return this.prisma.campaign.findMany({
      where: { tenantId },
      orderBy: { createdAt: 'desc' },
      include: {
        template: { select: { name: true, language: true } },
        channelAccount: { select: { label: true, phoneNumber: true } },
        createdBy: { select: { name: true } },
      },
    });
  }

  async findOne(tenantId: string, id: string) {
    const campaign = await this.prisma.campaign.findFirst({
      where: { id, tenantId },
      include: {
        template: { select: { name: true, language: true } },
        channelAccount: { select: { label: true, phoneNumber: true } },
        createdBy: { select: { name: true } },
      },
    });
    if (!campaign) throw new NotFoundException('Campaña no encontrada');

    // Los contadores de la fila son un resumen que el worker va actualizando; el
    // recuento real sale de los destinatarios, que es la fuente de verdad.
    const counts = await this.prisma.campaignRecipient.groupBy({
      by: ['status'],
      where: { campaignId: id },
      _count: true,
    });

    return {
      ...campaign,
      counts: Object.fromEntries(counts.map((c) => [c.status, c._count])),
    };
  }

  /** Los que fallaron, para poder mirar que paso sin bajarse la tabla entera. */
  async failures(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    return this.prisma.campaignRecipient.findMany({
      where: { campaignId: id, status: { in: ['FAILED', 'SKIPPED'] } },
      select: { recipientPhone: true, status: true, error: true, attempts: true },
      take: 200,
    });
  }

  async start(tenantId: string, userId: string, id: string) {
    const campaign = await this.mustFind(tenantId, id);
    if (campaign.status === 'RUNNING') return campaign;
    if (campaign.status === 'DONE' || campaign.status === 'CANCELLED') {
      throw new BadRequestException('Esta campaña ya terminó');
    }
    await this.assertCanUseLine(userId, campaign.channelAccountId);

    const pending = await this.prisma.campaignRecipient.count({
      where: { campaignId: id, status: { in: ['PENDING', 'SENDING'] } },
    });
    if (pending === 0) throw new BadRequestException('No quedan destinatarios pendientes en esta campaña');

    this.logger.log(`[campaña] arranca ${id} pendientes=${pending}`);
    return this.prisma.campaign.update({
      where: { id },
      data: { status: 'RUNNING', pausedReason: null, startedAt: campaign.startedAt ?? new Date() },
    });
  }

  async pause(tenantId: string, id: string, reason?: string) {
    await this.mustFind(tenantId, id);
    return this.prisma.campaign.update({
      where: { id },
      data: { status: 'PAUSED', pausedReason: reason ?? null },
    });
  }

  /**
   * Cancelar no borra nada: los pendientes quedan sin mandar y lo ya enviado sigue
   * enviado. Una campaña cancelada no se puede reanudar, a proposito — reanudar algo
   * que alguien freno a las apuradas es la peor forma de mandar mil mensajes.
   */
  async cancel(tenantId: string, id: string) {
    await this.mustFind(tenantId, id);
    await this.prisma.campaignRecipient.updateMany({
      where: { campaignId: id, status: { in: ['PENDING', 'SENDING'] } },
      data: { status: 'SKIPPED', error: 'Campaña cancelada' },
    });
    return this.prisma.campaign.update({
      where: { id },
      data: { status: 'CANCELLED', finishedAt: new Date() },
    });
  }

  // ── Internos ───────────────────────────────────────────────────────────────

  private async mustFind(tenantId: string, id: string) {
    const campaign = await this.prisma.campaign.findFirst({ where: { id, tenantId } });
    if (!campaign) throw new NotFoundException('Campaña no encontrada');
    return campaign;
  }

  private async assertCanUseLine(userId: string, channelAccountId: string) {
    // canAccessAccount ya entiende que un usuario sin lineas asignadas las puede usar
    // todas — la ausencia de filas ES el permiso, no lo contrario.
    if (!(await this.channelAccess.canAccessAccount(userId, channelAccountId))) {
      throw new ForbiddenException('No tenés permiso para enviar desde esa línea');
    }
  }

  /** Candidatos que salen de un Excel/CSV: dedupe, validacion y columnas propias. */
  private async candidatesFromFile(
    tenantId: string,
    file: Express.Multer.File,
    errors: { row: number; reason: string }[],
  ) {
    const parsed = await this.parseOrThrow(file);
    errors.push(...parsed.errors);
    const { unique, duplicated } = this.dedupe(parsed.rows, errors);

    // Se busca si ya existen para saber quien esta dado de baja antes de crear nada.
    const known = unique.length
      ? await this.prisma.contact.findMany({
          where: { tenantId, phone: { in: unique.map((r) => r.phone) } },
          select: { id: true, phone: true, optedOutAt: true },
        })
      : [];
    const byPhone = new Map(known.filter((c) => c.phone).map((c) => [c.phone as string, c]));

    const candidates: Candidate[] = unique.map((row) => {
      const existing = byPhone.get(row.phone);
      return {
        phone: row.phone,
        name: row.name,
        email: row.email,
        company: row.company,
        extra: row.extra,
        contactId: existing?.id,
        optedOutAt: existing?.optedOutAt ?? null,
      };
    });

    return { candidates, duplicated, invalid: parsed.errors.length, totalRows: parsed.rows.length + parsed.errors.length };
  }

  /**
   * Candidatos que salen de los contactos que ya estan en el sistema.
   *
   * Se exige que tengan identidad de WhatsApp, no solo telefono: un contacto sin
   * identidad no se puede enviar, y contarlo aca haria que el resumen prometiera mas
   * destinatarios de los que despues reciben algo.
   */
  private async candidatesFromContacts(
    tenantId: string,
    filter: ContactFilter,
  ): Promise<Candidate[]> {
    const search = filter.contactSearch?.trim();
    const explicit = !!filter.contactIds?.length;

    const contacts = await this.prisma.contact.findMany({
      where: {
        tenantId,
        identities: { some: { channel: 'WHATSAPP' } },
        // Una seleccion explicita gana sobre todo lo demas: es lo que el usuario marco
        // una por una, y filtrarla de nuevo solo podria sacar a alguien que eligio.
        ...(explicit
          ? { id: { in: filter.contactIds } }
          : {
              ...buildContactTagWhere(filter.tagIds, filter.tagMatch, filter.excludeTagIds),
              ...(search && {
                OR: [
                  { name: { contains: search, mode: 'insensitive' as const } },
                  { phone: { contains: search } },
                  { email: { contains: search, mode: 'insensitive' as const } },
                  { company: { contains: search, mode: 'insensitive' as const } },
                ],
              }),
            }),
      },
      select: { id: true, phone: true, name: true, email: true, company: true, optedOutAt: true },
      orderBy: { createdAt: 'desc' },
      take: MAX_RECIPIENTS + 1,
    });

    return contacts
      .filter((c) => c.phone)
      .map((c) => ({
        phone: c.phone as string,
        name: c.name,
        email: c.email,
        company: c.company,
        extra: {},
        contactId: c.id,
        optedOutAt: c.optedOutAt,
      }));
  }

  private async parseOrThrow(file: Express.Multer.File) {
    if (!file?.buffer?.length) throw new BadRequestException('No llegó ningún archivo');
    try {
      return await parseWorkbookRows(file.buffer, file.originalname);
    } catch (err: any) {
      throw new BadRequestException(err?.message || 'No se pudo leer el archivo');
    }
  }

  /** Se queda con la primera fila de cada telefono y reporta las repetidas. */
  private dedupe(rows: ParsedContactRow[], errors: { row: number; reason: string }[]) {
    const seen = new Map<string, ParsedContactRow>();
    let duplicated = 0;
    for (const row of rows) {
      const first = seen.get(row.phone);
      if (first) {
        duplicated += 1;
        errors.push({ row: row.row, reason: `Teléfono repetido en el archivo (ya está en la fila ${first.row})` });
        continue;
      }
      seen.set(row.phone, row);
    }
    return { unique: Array.from(seen.values()), duplicated };
  }

  private extraColumnsOf(candidates: Candidate[]): string[] {
    const cols = new Set<string>();
    for (const c of candidates) Object.keys(c.extra).forEach((k) => cols.add(k));
    return Array.from(cols);
  }

  /**
   * Cada valor que pide la plantilla tiene que tener una columna asignada. Sin esto,
   * una variable sin mapear se enviaria vacia y Meta rechaza el mensaje entero con un
   * error de cantidad de parametros que no dice cual falto.
   */
  private assertMappingCovers(
    needs: { header: number; body: number; buttons: { index: number; text: string }[] },
    mapping: VariableMappingDto[],
  ) {
    const has = (target: string, index: number) =>
      mapping.some((m) => m.target === target && m.index === index && (m.column || m.fixedValue));

    for (let i = 0; i < needs.header; i++) {
      if (!has('header', i)) throw new BadRequestException(`Falta indicar de dónde sale la variable del encabezado.`);
    }
    for (let i = 0; i < needs.body; i++) {
      if (!has('body', i)) throw new BadRequestException(`Falta indicar de dónde sale la variable {{${i + 1}}} del cuerpo.`);
    }
    for (const button of needs.buttons) {
      if (!has('button', button.index)) {
        throw new BadRequestException(`Falta indicar de dónde sale el enlace del botón "${button.text}".`);
      }
    }
  }

  /** Arma los valores de ESTE destinatario segun el mapeo elegido. */
  private valuesFor(candidate: Candidate, mapping: VariableMappingDto[]) {
    // Los campos del propio contacto se piden con un nombre reservado, para que no
    // choquen con una columna del Excel que se llame igual. Son los unicos que
    // existen cuando la campaña sale de los contactos del sistema y no de un archivo.
    const CONTACT_FIELDS: Record<string, (c: Candidate) => string> = {
      __name__: (c) => c.name ?? '',
      __phone__: (c) => c.phone,
      __email__: (c) => c.email ?? '',
      __company__: (c) => c.company ?? '',
    };

    const pick = (m: VariableMappingDto) => {
      if (m.fixedValue !== undefined && m.fixedValue !== '') return m.fixedValue;
      if (!m.column) return '';
      const field = CONTACT_FIELDS[m.column];
      if (field) return field(candidate);
      return candidate.extra[m.column] ?? '';
    };

    const header: string[] = [];
    const body: string[] = [];
    const buttons: { index: number; value: string }[] = [];

    for (const m of mapping) {
      if (m.target === 'header') header[m.index] = pick(m);
      else if (m.target === 'body') body[m.index] = pick(m);
      else buttons.push({ index: m.index, value: pick(m) });
    }

    return {
      header: Array.from(header, (v) => v ?? ''),
      body: Array.from(body, (v) => v ?? ''),
      buttons,
    };
  }

  /**
   * Devuelve un Contact por cada telefono, creando los que falten junto con su
   * identidad de WhatsApp. Sin la identidad, el envio despues fallaria con "ese
   * contacto no tiene un numero de WhatsApp".
   */
  private async ensureContacts(tenantId: string, candidates: Candidate[]) {
    const byPhone = new Map(
      candidates.filter((c) => c.contactId).map((c) => [c.phone, { id: c.contactId!, phone: c.phone, optedOutAt: c.optedOutAt ?? null }]),
    );

    const missing = candidates.filter((c) => !c.contactId);
    if (missing.length > 0) {
      await this.prisma.contact.createMany({
        data: missing.map((c) => ({ tenantId, phone: c.phone, name: c.name, email: c.email, company: c.company })),
        skipDuplicates: true,
      });
      const created = await this.prisma.contact.findMany({
        where: { tenantId, phone: { in: missing.map((c) => c.phone) } },
        select: { id: true, phone: true, optedOutAt: true },
      });
      await this.prisma.contactIdentity.createMany({
        data: created
          .filter((c): c is { id: string; phone: string; optedOutAt: Date | null } => c.phone !== null)
          .map((c) => ({ tenantId, contactId: c.id, channel: 'WHATSAPP' as const, externalId: c.phone })),
        skipDuplicates: true,
      });
      created.forEach((c) => c.phone && byPhone.set(c.phone, { id: c.id, phone: c.phone, optedOutAt: c.optedOutAt }));
    }

    // Se completa el id sobre el propio candidato: de ahi lo toma el armado de filas.
    for (const candidate of candidates) {
      const found = byPhone.get(candidate.phone);
      if (found) {
        candidate.contactId = found.id;
        candidate.optedOutAt = found.optedOutAt;
      }
    }
    return byPhone;
  }
}
