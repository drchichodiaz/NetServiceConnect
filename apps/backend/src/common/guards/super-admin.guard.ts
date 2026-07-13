import { Injectable, CanActivate, ExecutionContext, ForbiddenException } from '@nestjs/common';

/**
 * Distinto de RolesGuard/@Roles: esto no es sobre el rol dentro de un tenant
 * (ADMIN/SUPERVISOR/AGENT), es sobre ser el operador de la plataforma. Un ADMIN
 * de una empresa cliente nunca deberia pasar este guard.
 */
@Injectable()
export class SuperAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest();
    if (!user?.isSuperAdmin) {
      throw new ForbiddenException('Requires platform super-admin access');
    }
    return true;
  }
}
