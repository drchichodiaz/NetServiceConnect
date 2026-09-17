import { Injectable, UnauthorizedException, ConflictException, ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { RegisterDto } from './dto/register.dto';
import * as bcrypt from 'bcryptjs';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
  ) {}

  async login(dto: LoginDto) {
    // findUnique y no findFirst: el email es unico en todo el sistema desde la
    // migracion 20260914020000. Antes esto era findFirst sin filtrar por empresa y se
    // quedaba con el primer usuario que encontrara, asi que con el email repetido entre
    // empresas una de las dos personas no podia entrar.
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { tenant: { select: { id: true, name: true, slug: true, isActive: true } } },
    });

    // Un usuario desactivado da el mismo error que uno inexistente: si dijera algo
    // distinto, serviria para averiguar que direcciones existen en el sistema.
    if (!user || !user.isActive) throw new UnauthorizedException('Email o contraseña incorrectos');
    if (!user.tenant.isActive) throw new UnauthorizedException('Esta empresa está desactivada. Contacta al administrador.');

    const valid = await bcrypt.compare(dto.password, user.password);
    if (!valid) throw new UnauthorizedException('Email o contraseña incorrectos');

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

  /**
   * Cambio de contrasena por el propio usuario. Pide la actual a proposito: una sesion
   * abierta no deberia alcanzar para quedarse con la cuenta.
   *
   * No invalida el token en curso — este proyecto usa JWT sin lista de revocacion, asi
   * que las sesiones ya emitidas siguen valiendo hasta que expiren (JWT_EXPIRES_IN).
   * Vale la pena saberlo: cambiar la contrasena NO echa a quien ya este adentro.
   */
  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new UnauthorizedException('No pudimos identificar tu sesión. Vuelve a entrar.');

    const valid = await bcrypt.compare(dto.currentPassword, user.password);
    if (!valid) throw new BadRequestException('La contraseña actual no es correcta');

    if (await bcrypt.compare(dto.newPassword, user.password)) {
      throw new BadRequestException('La contraseña nueva tiene que ser distinta de la actual');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { password: await bcrypt.hash(dto.newPassword, 10) },
    });

    return { ok: true };
  }

  /** Edicion del propio perfil. Solo el nombre: el email es la credencial de acceso y
   *  el rol lo decide un administrador. */
  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { ...(dto.name !== undefined && { name: dto.name.trim() }) },
      select: { id: true, email: true, name: true, role: true, isSuperAdmin: true, tenantId: true },
    });
    return user;
  }

}
