import { Injectable, UnauthorizedException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findFirst({
      where: { email: dto.email, isActive: true },
      include: { tenant: { select: { id: true, name: true, slug: true, isActive: true } } },
    });

    if (!user) throw new UnauthorizedException('Invalid credentials');
    if (!user.tenant.isActive) throw new UnauthorizedException('Tenant is inactive');

    const valid = await bcrypt.compare(dto.password, user.password);
    if (!valid) throw new UnauthorizedException('Invalid credentials');

    return this.signToken(user);
  }

  // Registro publico: solo sirve para crear el PRIMER usuario de un tenant recien
  // creado (bootstrap). Si el tenant ya tiene usuarios, hay que pedirle a un
  // ADMIN/SUPERVISOR de esa empresa que te cree la cuenta via POST /users.
  async register(dto: RegisterDto) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: dto.tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');

    const existingUsers = await this.prisma.user.count({ where: { tenantId: dto.tenantId } });
    if (existingUsers > 0) {
      throw new ForbiddenException('This tenant already has an admin — ask them to invite you');
    }

    const hash = await bcrypt.hash(dto.password, 10);

    const user = await this.prisma.user.create({
      data: {
        tenantId: dto.tenantId,
        email: dto.email,
        password: hash,
        name: dto.name,
        role: 'ADMIN',
      },
      include: { tenant: { select: { id: true, name: true, slug: true } } },
    });

    return this.signToken(user);
  }

  async me(userId: string) {
    return this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isSuperAdmin: true,
        tenantId: true,
        tenant: { select: { id: true, name: true, slug: true } },
      },
    });
  }

  private signToken(user: any) {
    const payload = {
      sub: user.id,
      email: user.email,
      tenantId: user.tenantId,
      role: user.role,
    };

    return {
      access_token: this.jwt.sign(payload),
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        isSuperAdmin: user.isSuperAdmin,
        tenantId: user.tenantId,
        tenant: user.tenant,
      },
    };
  }
}
