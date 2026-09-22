import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ContactIdentityService } from './contact-identity.service';
import { ContactTagsService, slugifyTag, buildContactTagWhere } from '../contact-tags/contact-tags.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { parseWorkbookRows, ParsedContactRow } from './contacts-import.util';

const MAX_IMPORT_ROWS = 5000;
const MAX_REPORTED_ERRORS = 50;

export interface ImportContactsResult {
  totalRows: number;
  created: number;
  skippedDuplicate: number;
  skippedInvalid: number;
  /** Contactos que recibieron alguna etiqueta de la columna "Etiquetas". */
  tagged: number;
  errors: { row: number; reason: string }[];
  truncatedErrors: boolean;
}

/**
 * La ficha de un contacto sale con `tags: [{ id, name, color }]` y no con las filas de
 * la tabla puente. El panel no tiene por que saber que existe ContactTagLink, y asi la
 * forma es la misma en la lista, en la ficha y en la bandeja.
 */
function flattenTags<T extends { tags?: { tag: { id: string; name: string; color: string } }[] }>(contact: T) {
  return { ...contact, tags: (contact.tags ?? []).map((l) => l.tag) };
}

@Injectable()
export class ContactsService {
  constructor(
    private prisma: PrismaService,
    private identities: ContactIdentityService,
    private tags: ContactTagsService,
  ) {}

  async create(tenantId: string, dto: CreateContactDto) {
    const existing = await this.prisma.contact.findUnique({
      where: { tenantId_phone: { tenantId, phone: dto.phone } },
    });
    if (existing) throw new ConflictException('Contact with this phone already exists');

    const contact = await this.prisma.contact.create({ data: { tenantId, ...dto } });
    // Un contacto dado de alta a mano todavia no escribio nunca, asi que no tiene
    // identidad de canal. Se le crea la de WhatsApp con su telefono para que, cuando
    // escriba, el webhook lo reconozca en vez de abrir una ficha nueva.
    await this.identities.ensureWhatsAppIdentity(tenantId, contact.id, dto.phone);
    return contact;
  }

  /**
   * `tagIds` con match ALL pide los contactos que tienen TODAS esas etiquetas; con ANY,
   * los que tienen alguna. Los dos modos hacen falta: "mayorista Y moroso" es una lista
   * chica a la que hay que llamar, "mayorista O distribuidor" es una campaña.
   */
  async findAll(
    tenantId: string,
    search?: string,
    filter?: { tagIds?: string[]; tagMatch?: 'ANY' | 'ALL' },
  ) {
    const contacts = await this.prisma.contact.findMany({
      where: {
        tenantId,
        ...buildContactTagWhere(filter?.tagIds, filter?.tagMatch),
        ...(search && {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search } },
            { email: { contains: search, mode: 'insensitive' } },
          ],
        }),
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        _count: { select: { conversations: true } },
        tags: { include: { tag: true } },
      },
    });
    return contacts.map(flattenTags);
  }

  async findOne(tenantId: string, id: string) {
    const contact = await this.prisma.contact.findFirst({
      where: { id, tenantId },
      include: {
        conversations: {
          orderBy: { lastMessageAt: 'desc' },
          take: 5,
          select: { id: true, status: true, lastMessageAt: true, lastMessageText: true },
        },
        tags: { include: { tag: true } },
      },
    });
    if (!contact) throw new NotFoundException('Contact not found');
    return flattenTags(contact);
  }

  async update(tenantId: string, id: string, dto: Partial<CreateContactDto>) {
    await this.findOne(tenantId, id);
    return this.prisma.contact.update({ where: { id }, data: dto });
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    return this.prisma.contact.delete({ where: { id } });
  }

  // ─── Etiquetas ──────────────────────────────────────────────────────────────

  /** Deja al contacto exactamente con estas etiquetas. Reemplaza, no agrega. */
  async setTags(tenantId: string, contactId: string, tagIds: string[]) {
    await this.findOne(tenantId, contactId);
    const owned = await this.tags.assertOwnedOrThrow(tenantId, tagIds);

    // Borrar y volver a insertar mantiene esto en dos consultas en vez de calcular el
    // diff; son pocas filas por contacto y asi no hay estados intermedios raros.
    await this.prisma.$transaction([
      this.prisma.contactTagLink.deleteMany({ where: { contactId } }),
      ...(owned.length
        ? [this.prisma.contactTagLink.createMany({ data: owned.map((tagId) => ({ contactId, tagId })) })]
        : []),
    ]);

    return this.findOne(tenantId, contactId);
  }

  /**
   * Etiqueta y desetiqueta muchos contactos de una. Devuelve cuantos vinculos se
   * crearon y cuantos se borraron, no cuantos contactos se tocaron: es lo que deja
   * decir "ya la tenian" sin mentir.
   */
  async bulkTag(
    tenantId: string,
    contactIds: string[],
    addTagIds: string[] = [],
    removeTagIds: string[] = [],
  ) {
    const ids = [...new Set(contactIds.filter(Boolean))];
    if (ids.length === 0) throw new BadRequestException('No hay contactos seleccionados');

    // Solo los de este tenant: un id ajeno en la lista no puede terminar etiquetado.
    const contacts = await this.prisma.contact.findMany({
      where: { tenantId, id: { in: ids } },
      select: { id: true },
    });
    if (contacts.length === 0) throw new NotFoundException('Ningún contacto encontrado');

    const toAdd = await this.tags.assertOwnedOrThrow(tenantId, addTagIds);
    const toRemove = await this.tags.assertOwnedOrThrow(tenantId, removeTagIds);

    let added = 0;
    if (toAdd.length > 0) {
      const res = await this.prisma.contactTagLink.createMany({
        // Los que ya la tenian no son un error: se saltean y no cuentan como agregados.
        data: contacts.flatMap((c) => toAdd.map((tagId) => ({ contactId: c.id, tagId }))),
        skipDuplicates: true,
      });
      added = res.count;
    }

    let removed = 0;
    if (toRemove.length > 0) {
      const res = await this.prisma.contactTagLink.deleteMany({
        where: { contactId: { in: contacts.map((c) => c.id) }, tagId: { in: toRemove } },
      });
      removed = res.count;
    }

    return { contacts: contacts.length, added, removed };
  }

  // ─── Importación masiva ─────────────────────────────────────────────────────

  async importContacts(tenantId: string, buffer: Buffer, filename: string): Promise<ImportContactsResult> {
    let parsed;
    try {
      parsed = await parseWorkbookRows(buffer, filename);
    } catch (err: any) {
      throw new BadRequestException(err?.message || 'No pudimos leer el archivo');
    }

    if (parsed.rows.length + parsed.errors.length > MAX_IMPORT_ROWS) {
      throw new BadRequestException(`El archivo tiene más de ${MAX_IMPORT_ROWS} filas — dividilo en partes más chicas`);
    }

    const errors = [...parsed.errors];
    let skippedDuplicate = 0;

    // Dedupe dentro del propio archivo: se queda con la primera fila de cada teléfono.
    const seenPhones = new Map<string, ParsedContactRow>();
    for (const row of parsed.rows) {
      if (seenPhones.has(row.phone)) {
        skippedDuplicate += 1;
        errors.push({ row: row.row, reason: `Teléfono repetido en el archivo (ya está en la fila ${seenPhones.get(row.phone)!.row})` });
        continue;
      }
      seenPhones.set(row.phone, row);
    }

    const candidateRows = Array.from(seenPhones.values());
    const existing = candidateRows.length
      ? await this.prisma.contact.findMany({
          where: { tenantId, phone: { in: candidateRows.map((r) => r.phone) } },
          select: { phone: true },
        })
      : [];
    const existingPhones = new Set(existing.map((c) => c.phone));

    const newRows: ParsedContactRow[] = [];
    for (const row of candidateRows) {
      if (existingPhones.has(row.phone)) {
        skippedDuplicate += 1;
        errors.push({
          row: row.row,
          reason: row.tags.length
            ? 'Ya existe un contacto con ese teléfono — no se tocaron sus datos, solo se le sumaron las etiquetas'
            : 'Ya existe un contacto con ese teléfono',
        });
      } else {
        newRows.push(row);
      }
    }

    if (newRows.length > 0) {
      await this.prisma.contact.createMany({
        data: newRows.map((r) => ({ tenantId, phone: r.phone, name: r.name, email: r.email, company: r.company })),
        skipDuplicates: true,
      });

      // Mismo motivo que en el alta manual: sin identidad, el primer mensaje de un
      // contacto importado abriria una ficha duplicada. createMany no devuelve los ids,
      // asi que se releen por telefono — son los que acabamos de insertar.
      const created = await this.prisma.contact.findMany({
        where: { tenantId, phone: { in: newRows.map((r) => r.phone) } },
        select: { id: true, phone: true },
      });
      await this.prisma.contactIdentity.createMany({
        data: created
          .filter((c): c is { id: string; phone: string } => c.phone !== null)
          .map((c) => ({ tenantId, contactId: c.id, channel: 'WHATSAPP' as const, externalId: c.phone })),
        skipDuplicates: true,
      });
    }

    // Las etiquetas se aplican a TODAS las filas validas, no solo a los contactos
    // nuevos: subir la lista de mayoristas para etiquetar gente que ya esta cargada es
    // el caso mas comun, y saltear los repetidos tambien aca dejaria el archivo sin
    // efecto. Agregar una etiqueta no pisa ningun dato de la ficha.
    const tagged = await this.applyImportedTags(tenantId, candidateRows);

    const skippedInvalid = parsed.errors.length;
    const truncatedErrors = errors.length > MAX_REPORTED_ERRORS;

    return {
      totalRows: parsed.rows.length + parsed.errors.length,
      created: newRows.length,
      skippedDuplicate,
      skippedInvalid,
      tagged,
      errors: errors.slice(0, MAX_REPORTED_ERRORS),
      truncatedErrors,
    };
  }

  /**
   * Crea las etiquetas que el archivo nombra y las engancha a los contactos de cada
   * fila. Devuelve a cuantos contactos les toco alguna.
   */
  private async applyImportedTags(tenantId: string, rows: ParsedContactRow[]): Promise<number> {
    const rowsWithTags = rows.filter((r) => r.tags.length > 0);
    if (rowsWithTags.length === 0) return 0;

    const idBySlug = await this.tags.resolveOrCreateByName(
      tenantId,
      rowsWithTags.flatMap((r) => r.tags),
    );

    const contacts = await this.prisma.contact.findMany({
      where: { tenantId, phone: { in: rowsWithTags.map((r) => r.phone) } },
      select: { id: true, phone: true },
    });
    const idByPhone = new Map(contacts.map((c) => [c.phone, c.id]));

    const links: { contactId: string; tagId: string }[] = [];
    const touched = new Set<string>();
    for (const row of rowsWithTags) {
      const contactId = idByPhone.get(row.phone);
      if (!contactId) continue; // fila invalida que no llego a ser contacto
      for (const name of row.tags) {
        const tagId = idBySlug.get(slugifyTag(name));
        if (!tagId) continue;
        links.push({ contactId, tagId });
        touched.add(contactId);
      }
    }
    if (links.length === 0) return 0;

    await this.prisma.contactTagLink.createMany({ data: links, skipDuplicates: true });
    return touched.size;
  }
}
