import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class TenantsService {
  constructor(private prisma: PrismaService) {}

  // Crea la empresa junto con su primer usuario (ADMIN) en una sola transaccion —
  // un tenant sin usuarios es inutilizable (nadie podria loguearse para administrarlo).
  async create(dto: CreateTenantDto) {
    const existingSlug = await this.prisma.tenant.findUnique({ where: { slug: dto.slug } });
    if (existingSlug) throw new ConflictException('Slug already taken');

    const passwordHash = await bcrypt.hash(dto.adminPassword, 10);

    return this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: { name: dto.name, slug: dto.slug, plan: dto.plan },
      });

      const admin = await tx.user.create({
        data: {
          tenantId: tenant.id,
          name: dto.adminName,
          email: dto.adminEmail,
          password: passwordHash,
          role: 'ADMIN',
        },
        select: { id: true, name: true, email: true, role: true },
      });

      return { tenant, admin };
    });
  }

  findAll() {
    return this.prisma.tenant.findMany({
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { users: true, conversations: true } } },
    });
  }

  async findOne(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: { _count: { select: { users: true, conversations: true, contacts: true } } },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async update(id: string, data: Partial<CreateTenantDto>) {
    await this.findOne(id);
    // Solo campos propios del tenant — adminName/adminEmail/adminPassword son
    // exclusivos de la creacion inicial, no se tocan desde aca.
    const { name, slug, plan } = data;
    return this.prisma.tenant.update({ where: { id }, data: { name, slug, plan } });
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.tenant.delete({ where: { id } });
  }
}
