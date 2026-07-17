import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { parseWorkbookRows, ParsedContactRow } from './contacts-import.util';

const MAX_IMPORT_ROWS = 5000;
const MAX_REPORTED_ERRORS = 50;

export interface ImportContactsResult {
  totalRows: number;
  created: number;
  skippedDuplicate: number;
  skippedInvalid: number;
  errors: { row: number; reason: string }[];
  truncatedErrors: boolean;
}

@Injectable()
export class ContactsService {
  constructor(private prisma: PrismaService) {}

  async create(tenantId: string, dto: CreateContactDto) {
    const existing = await this.prisma.contact.findUnique({
      where: { tenantId_phone: { tenantId, phone: dto.phone } },
    });
    if (existing) throw new ConflictException('Contact with this phone already exists');

    return this.prisma.contact.create({ data: { tenantId, ...dto } });
  }

  async findAll(tenantId: string, search?: string) {
    return this.prisma.contact.findMany({
      where: {
        tenantId,
        ...(search && {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { phone: { contains: search } },
            { email: { contains: search, mode: 'insensitive' } },
          ],
        }),
      },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { conversations: true } } },
    });
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
      },
    });
    if (!contact) throw new NotFoundException('Contact not found');
    return contact;
  }

  async update(tenantId: string, id: string, dto: Partial<CreateContactDto>) {
    await this.findOne(tenantId, id);
    return this.prisma.contact.update({ where: { id }, data: dto });
  }

  async remove(tenantId: string, id: string) {
    await this.findOne(tenantId, id);
    return this.prisma.contact.delete({ where: { id } });
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
        errors.push({ row: row.row, reason: 'Ya existe un contacto con ese teléfono' });
      } else {
        newRows.push(row);
      }
    }

    if (newRows.length > 0) {
      await this.prisma.contact.createMany({
        data: newRows.map((r) => ({ tenantId, phone: r.phone, name: r.name, email: r.email, company: r.company })),
        skipDuplicates: true,
      });
    }

    const skippedInvalid = parsed.errors.length;
    const truncatedErrors = errors.length > MAX_REPORTED_ERRORS;

    return {
      totalRows: parsed.rows.length + parsed.errors.length,
      created: newRows.length,
      skippedDuplicate,
      skippedInvalid,
      errors: errors.slice(0, MAX_REPORTED_ERRORS),
      truncatedErrors,
    };
  }
}
