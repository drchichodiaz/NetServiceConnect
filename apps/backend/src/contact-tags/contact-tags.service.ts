import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateContactTagDto, UpdateContactTagDto } from './dto/contact-tag.dto';

/** Tope por tenant. Pasado esto la lista deja de ser util y conviene repensarla. */
const MAX_TAGS_PER_TENANT = 200;

/**
 * Colores que se van repartiendo a las etiquetas creadas al vuelo, para que dos
 * etiquetas seguidas no salgan iguales. Se puede cambiar despues a mano.
 */
const PALETTE = ['#6366f1', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#a855f7', '#ec4899', '#14b8a6'];

/**
 * El nombre reducido a su forma comparable: sin mayusculas, sin tildes y sin espacios
 * de sobra. Es lo que hace que "Cliente VIP", "cliente vip" y "  Cliente  VIP " sean
 * la misma etiqueta, que es el unico motivo por el que un sistema de etiquetas sigue
 * sirviendo despues de que lo usan cinco personas distintas.
 */
export function slugifyTag(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * El `where` de Prisma para filtrar contactos por etiquetas. Vive aca y no en cada
 * modulo porque la lista de contactos y el armado de campañas tienen que entender
 * exactamente lo mismo por "mayorista Y moroso": si se separan, el "ver a cuántos" de
 * la campaña deja de coincidir con lo que muestra la lista.
 *
 * Las tres condiciones van dentro de un `AND` y no sueltas en el objeto: incluir y
 * excluir escriben las dos la clave `tags`, y una pisaria a la otra en silencio.
 */
export function buildContactTagWhere(
  tagIds?: string[],
  match: 'ANY' | 'ALL' = 'ANY',
  excludeTagIds?: string[],
) {
  const include = [...new Set((tagIds ?? []).filter(Boolean))];
  const exclude = [...new Set((excludeTagIds ?? []).filter(Boolean))];
  const conditions: any[] = [];

  if (include.length > 0) {
    // Con ALL hace falta un `some` por etiqueta: un solo `some: { in: [...] }` devuelve
    // a los que tienen CUALQUIERA, que es justo el otro modo.
    if (match === 'ALL') conditions.push(...include.map((tagId) => ({ tags: { some: { tagId } } })));
    else conditions.push({ tags: { some: { tagId: { in: include } } } });
  }
  // Excluir gana sobre incluir: quien tiene las dos etiquetas no entra.
  if (exclude.length > 0) conditions.push({ tags: { none: { tagId: { in: exclude } } } });

  return conditions.length > 0 ? { AND: conditions } : {};
}

@Injectable()
export class ContactTagsService {
  constructor(private prisma: PrismaService) {}

  /** Las etiquetas del tenant con cuantos contactos lleva cada una. */
  async findAll(tenantId: string) {
    const tags = await this.prisma.contactTag.findMany({
      where: { tenantId },
      orderBy: { name: 'asc' },
      include: { _count: { select: { contacts: true } } },
    });
    return tags.map((t) => ({
      id: t.id,
      name: t.name,
      slug: t.slug,
      color: t.color,
      contactCount: t._count.contacts,
    }));
  }

  async create(tenantId: string, dto: CreateContactTagDto) {
    const name = dto.name.trim();
    const slug = slugifyTag(name);
    if (!slug) throw new BadRequestException('La etiqueta necesita un nombre');

    // Crear una que ya existe no es un error para quien la escribe: quiso tener esa
    // etiqueta y la tiene. Se devuelve la existente y el panel la marca igual.
    const existing = await this.prisma.contactTag.findUnique({
      where: { tenantId_slug: { tenantId, slug } },
    });
    if (existing) return existing;

    const count = await this.prisma.contactTag.count({ where: { tenantId } });
    if (count >= MAX_TAGS_PER_TENANT) {
      throw new BadRequestException(`No se pueden tener más de ${MAX_TAGS_PER_TENANT} etiquetas`);
    }

    return this.prisma.contactTag.create({
      data: { tenantId, name, slug, color: dto.color ?? PALETTE[count % PALETTE.length] },
    });
  }

  async update(tenantId: string, id: string, dto: UpdateContactTagDto) {
    await this.findOneOrThrow(tenantId, id);

    const name = dto.name?.trim();
    const slug = name ? slugifyTag(name) : undefined;
    if (name !== undefined && !slug) throw new BadRequestException('La etiqueta necesita un nombre');

    if (slug) {
      const clash = await this.prisma.contactTag.findUnique({
        where: { tenantId_slug: { tenantId, slug } },
      });
      // Renombrar "VIP" a "Vip" es valido: cambia como se muestra y el slug no se mueve.
      if (clash && clash.id !== id) throw new ConflictException(`Ya existe una etiqueta "${clash.name}"`);
    }

    return this.prisma.contactTag.update({
      where: { id },
      data: { ...(name !== undefined && { name, slug }), ...(dto.color && { color: dto.color }) },
    });
  }

  /** Borra la etiqueta y sus vinculos. Los contactos no se tocan. */
  async remove(tenantId: string, id: string) {
    await this.findOneOrThrow(tenantId, id);
    await this.prisma.contactTag.delete({ where: { id } });
    return { ok: true };
  }

  /**
   * Devuelve un mapa slug → id de esas etiquetas, creando las que no existan. Es lo que
   * hace que etiquetar sea escribir: el que carga contactos no tiene que ir antes a
   * ninguna pantalla de administracion a dar de alta nada.
   *
   * Devuelve un mapa y no una lista para que quien llama pueda volver del texto de una
   * celda al id sin depender del orden en que se devolvieron.
   */
  async resolveOrCreateByName(tenantId: string, names: string[]): Promise<Map<string, string>> {
    const wanted = new Map<string, string>(); // slug -> nombre como lo escribieron
    for (const raw of names) {
      const name = (raw ?? '').trim();
      const slug = slugifyTag(name);
      if (slug && !wanted.has(slug)) wanted.set(slug, name);
    }
    if (wanted.size === 0) return new Map();

    const existing = await this.prisma.contactTag.findMany({
      where: { tenantId, slug: { in: [...wanted.keys()] } },
    });
    const bySlug = new Map(existing.map((t) => [t.slug, t]));

    const missing = [...wanted.entries()].filter(([slug]) => !bySlug.has(slug));
    if (missing.length > 0) {
      const count = await this.prisma.contactTag.count({ where: { tenantId } });
      if (count + missing.length > MAX_TAGS_PER_TENANT) {
        throw new BadRequestException(
          `El archivo crearía ${missing.length} etiquetas nuevas y se pasaría del máximo de ${MAX_TAGS_PER_TENANT}`,
        );
      }
      await this.prisma.contactTag.createMany({
        data: missing.map(([slug, name], i) => ({
          tenantId,
          name,
          slug,
          color: PALETTE[(count + i) % PALETTE.length],
        })),
        // Dos importaciones a la vez pueden pedir la misma etiqueta nueva; la que
        // pierde se queda con la que creo la otra en vez de reventar.
        skipDuplicates: true,
      });
      const created = await this.prisma.contactTag.findMany({
        where: { tenantId, slug: { in: missing.map(([slug]) => slug) } },
      });
      for (const t of created) bySlug.set(t.slug, t);
    }

    return new Map([...wanted.keys()].filter((slug) => bySlug.has(slug)).map((slug) => [slug, bySlug.get(slug)!.id]));
  }

  /** Que los ids sean de este tenant. Sin esto, un id ajeno etiquetaría contactos. */
  async assertOwnedOrThrow(tenantId: string, tagIds: string[]): Promise<string[]> {
    const ids = [...new Set(tagIds)].filter(Boolean);
    if (ids.length === 0) return [];
    const found = await this.prisma.contactTag.findMany({
      where: { tenantId, id: { in: ids } },
      select: { id: true },
    });
    if (found.length !== ids.length) throw new NotFoundException('Alguna etiqueta no existe');
    return found.map((t) => t.id);
  }

  private async findOneOrThrow(tenantId: string, id: string) {
    const tag = await this.prisma.contactTag.findFirst({ where: { id, tenantId } });
    if (!tag) throw new NotFoundException('Etiqueta no encontrada');
    return tag;
  }
}
