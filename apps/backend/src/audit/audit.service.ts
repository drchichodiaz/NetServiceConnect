import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuditService {
  constructor(private prisma: PrismaService) {}

  async findByTenant(tenantId: string, conversationId?: string) {
    return this.prisma.auditLog.findMany({
      where: {
        tenantId,
        ...(conversationId && { conversationId }),
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        user: { select: { id: true, name: true } },
      },
    });
  }

  async log(
    tenantId: string,
    action: string,
    opts?: { userId?: string; conversationId?: string; metadata?: any },
  ) {
    return this.prisma.auditLog.create({
      data: {
        tenantId,
        action,
        userId: opts?.userId,
        conversationId: opts?.conversationId,
        metadata: opts?.metadata,
      },
    });
  }
}
