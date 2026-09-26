import { Injectable, Logger, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { UpdateTenantDto } from './dto/update-tenant.dto';
import { PartnersService } from '../partners/partners.service';
import { AiWalletService } from '../ai-usage/ai-wallet.service';
import * as bcrypt from 'bcryptjs';
import { isValidTimeZone } from '../agenda/agenda-time';

@Injectable()
export class TenantsService {
  private readonly logger = new Logger(TenantsService.name);

  constructor(
    private prisma: PrismaService,
    private partners: PartnersService,
    private aiWallet: AiWalletService,
  ) {}

  // Crea la empresa junto con su primer usuario (ADMIN) en una sola transaccion —
  // un tenant sin usuarios es inutilizable (nadie podria loguearse para administrarlo).
  async create(dto: CreateTenantDto) {
    const existingSlug = await this.prisma.tenant.findUnique({ where: { slug: dto.slug } });
    if (existingSlug) throw new ConflictException('Slug already taken');

    // El flujo real: el partner vende, nos avisa, y la empresa la damos de alta
    // nosotros anotando quien la trajo. Si se nombra a un partner, tiene que existir y
    // estar activo — una venta atribuida a alguien dado de baja es un error de carga.
    if (dto.partnerId) await this.partners.assertUsableOrThrow(dto.partnerId);

    const passwordHash = await bcrypt.hash(dto.adminPassword, 10);

    const created = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          name: dto.name,
          slug: dto.slug,
          plan: dto.plan,
          partnerId: dto.partnerId || null,
          // Sin fecha de venta declarada se toma la del alta: es lo mas cerca que
          // estamos, y dejarla vacia complicaria cualquier corte por periodo.
          soldAt: dto.partnerId ? (dto.soldAt ? new Date(dto.soldAt) : new Date()) : null,
          partnerNote: dto.partnerNote || null,
        },
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

    await this.grantTrialCredits(created.tenant.id, created.tenant.name);
    return created;
  }

  /**
   * Acredita los creditos de prueba de una empresa recien creada.
   *
   * Va por fuera de la transaccion del alta a proposito: si esto falla, la empresa
   * igual queda creada y usable, y los creditos se cargan a mano desde el panel. Al
   * reves seria peor — perder el alta entera por no haber podido regalar saldo.
   */
  private async grantTrialCredits(tenantId: string, tenantName: string) {
    const config = await this.prisma.systemConfig.findUnique({ where: { id: '1' } });
    const credits = config?.aiTrialCredits ?? 0;
    if (credits <= 0) return;

    try {
      await this.aiWallet.grant(tenantId, {
        kind: 'BONUS',
        credits,
        note: 'Créditos de prueba del alta',
      });
      this.logger.log(`${tenantName} nace con ${credits} creditos de IA de prueba.`);
    } catch (err) {
      this.logger.error(`No se pudieron acreditar los creditos de prueba de ${tenantName}`, err as any);
    }
  }

  findAll() {
    return this.prisma.tenant.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { users: true, conversations: true } },
        partner: { select: { id: true, name: true, isActive: true } },
        agendaSettings: { select: { enabled: true } },
      },
    });
  }

  async findOne(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      include: {
        _count: { select: { users: true, conversations: true, contacts: true } },
        partner: { select: { id: true, name: true, isActive: true } },
        agendaSettings: { select: { enabled: true } },
      },
    });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async update(id: string, dto: UpdateTenantDto) {
    const current = await this.findOne(id);

    // El slug es unique: chocarlo daba un P2002 crudo que en pantalla se leia como un
    // error del sistema y no como "ese identificador ya lo usa otra empresa".
    if (dto.slug && dto.slug !== current.slug) {
      const taken = await this.prisma.tenant.findUnique({ where: { slug: dto.slug } });
      if (taken) throw new ConflictException('Ya hay una empresa con ese identificador');
    }

    const data: any = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.slug !== undefined) data.slug = dto.slug;
    if (dto.plan !== undefined) data.plan = dto.plan.trim() || 'starter';
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.partnerNote !== undefined) data.partnerNote = dto.partnerNote.trim() || null;

    if (dto.partnerId !== undefined) {
      // Vacio = venta directa. Corregir la atribucion tiene que ser posible: el primer
      // tiempo se carga a mano y equivocarse una vez no puede quedar para siempre.
      if (!dto.partnerId) {
        data.partnerId = null;
        data.soldAt = null;
      } else {
        // Reasignar a un partner desactivado si se permite: pasa al corregir una venta
        // vieja de alguien que ya no vende. Lo que se frena es estrenar una venta con
        // el, que es lo que hace el alta.
        const partner = await this.prisma.partner.findUnique({ where: { id: dto.partnerId } });
        if (!partner) throw new NotFoundException('Partner no encontrado');
        data.partnerId = partner.id;
        if (!current.soldAt) data.soldAt = dto.soldAt ? new Date(dto.soldAt) : new Date();
      }
    }
    if (dto.soldAt !== undefined && data.soldAt === undefined) data.soldAt = new Date(dto.soldAt);

    if (dto.timezone !== undefined) {
      // Una zona mal escrita no falla aca: falla despues, en cada calculo de la agenda.
      if (!isValidTimeZone(dto.timezone)) throw new BadRequestException('Zona horaria desconocida');
      data.timezone = dto.timezone;
    }

    // La fila de configuracion se crea la primera vez que se prende, con los defaults.
    if (dto.agendaEnabled !== undefined) {
      await this.prisma.agendaSettings.upsert({
        where: { tenantId: id },
        create: { tenantId: id, enabled: dto.agendaEnabled },
        update: { enabled: dto.agendaEnabled },
      });
    }

    await this.prisma.tenant.update({ where: { id }, data });
    return this.findOne(id);
  }

  async remove(id: string) {
    await this.findOne(id);
    return this.prisma.tenant.delete({ where: { id } });
  }
}
