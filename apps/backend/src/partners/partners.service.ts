import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePartnerDto, UpdatePartnerDto } from './dto/partner.dto';

@Injectable()
export class PartnersService {
  constructor(private prisma: PrismaService) {}

  /**
   * Los partners con cuántas empresas trajo cada uno, separando activas de inactivas.
   *
   * La separación no es cosmética: es el número que hace falta para liquidar. Una
   * empresa dada de baja sigue siendo una venta del partner, pero no debería seguir
   * generando comisión, y un total único no deja distinguir esos dos casos.
   */
  async findAll() {
    const partners = await this.prisma.partner.findMany({
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      include: { tenants: { select: { isActive: true } } },
    });

    return partners.map(({ tenants, ...partner }) => ({
      ...partner,
      tenantCount: tenants.length,
      activeTenantCount: tenants.filter((t) => t.isActive).length,
    }));
  }

  /** Un partner con las empresas que vendió, para poder mirar su cartera. */
  async findOne(id: string) {
    const partner = await this.prisma.partner.findUnique({
      where: { id },
      include: {
        tenants: {
          orderBy: [{ soldAt: 'desc' }, { createdAt: 'desc' }],
          select: {
            id: true,
            name: true,
            slug: true,
            plan: true,
            isActive: true,
            soldAt: true,
            createdAt: true,
            partnerNote: true,
            _count: { select: { users: true, conversations: true } },
          },
        },
      },
    });
    if (!partner) throw new NotFoundException('Partner no encontrado');

    return {
      ...partner,
      tenantCount: partner.tenants.length,
      activeTenantCount: partner.tenants.filter((t) => t.isActive).length,
    };
  }

  create(dto: CreatePartnerDto) {
    return this.prisma.partner.create({ data: { ...dto, name: dto.name.trim() } });
  }

  async update(id: string, dto: UpdatePartnerDto) {
    await this.assertExists(id);

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    // Los opcionales se vacían a null en vez de guardar "": así "sin correo" es un solo
    // valor y no dos que se ven igual en pantalla pero no son iguales al filtrar.
    if (dto.email !== undefined) data.email = dto.email.trim() || null;
    if (dto.phone !== undefined) data.phone = dto.phone.trim() || null;
    if (dto.taxId !== undefined) data.taxId = dto.taxId.trim() || null;
    if (dto.agreement !== undefined) data.agreement = dto.agreement.trim() || null;
    if (dto.notes !== undefined) data.notes = dto.notes.trim() || null;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;

    return this.prisma.partner.update({ where: { id }, data });
  }

  /**
   * Borrar es la última opción y por eso se frena si tiene ventas: el partner es la
   * explicación de por qué esas empresas están atribuidas, y borrarlo las dejaría como
   * venta directa sin que nadie se entere. Para el que dejó de vender está desactivarlo,
   * que conserva el histórico.
   */
  async remove(id: string) {
    await this.assertExists(id);
    const sold = await this.prisma.tenant.count({ where: { partnerId: id } });
    if (sold > 0) {
      throw new BadRequestException(
        `Este partner tiene ${sold} empresa${sold === 1 ? '' : 's'} a su nombre. Desactivalo en vez de borrarlo, ` +
          `o reasigná esas empresas primero.`,
      );
    }
    await this.prisma.partner.delete({ where: { id } });
    return { ok: true };
  }

  /** Que el partner exista y esté en condiciones de recibir una venta nueva. */
  async assertUsableOrThrow(id: string) {
    const partner = await this.prisma.partner.findUnique({ where: { id } });
    if (!partner) throw new NotFoundException('Partner no encontrado');
    if (!partner.isActive) {
      throw new BadRequestException(`El partner "${partner.name}" está desactivado`);
    }
    return partner;
  }

  private async assertExists(id: string) {
    const partner = await this.prisma.partner.findUnique({ where: { id } });
    if (!partner) throw new NotFoundException('Partner no encontrado');
    return partner;
  }
}
