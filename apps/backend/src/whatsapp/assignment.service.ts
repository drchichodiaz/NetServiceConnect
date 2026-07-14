import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AssignmentService {
  constructor(private prisma: PrismaService) {}

  /**
   * Asigna al agente activo con menor cantidad de conversaciones abiertas/pendientes
   * en el tenant. Empate se resuelve por orden de creación del usuario (más antiguo primero).
   */
  async findLeastBusyAgent(tenantId: string): Promise<string | null> {
    const agents = await this.prisma.user.findMany({
      where: { tenantId, role: 'AGENT', isActive: true },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    if (agents.length === 0) return null;

    const workload = await this.prisma.conversation.groupBy({
      by: ['assignedUserId'],
      where: {
        tenantId,
        assignedUserId: { in: agents.map((a) => a.id) },
        status: { in: ['OPEN', 'PENDING'] },
      },
      _count: { _all: true },
    });

    const loadByAgent = new Map(agents.map((a) => [a.id, 0]));
    for (const row of workload) {
      if (row.assignedUserId) loadByAgent.set(row.assignedUserId, row._count._all);
    }

    let bestAgentId = agents[0].id;
    let bestLoad = loadByAgent.get(bestAgentId) ?? 0;
    for (const agent of agents) {
      const load = loadByAgent.get(agent.id) ?? 0;
      if (load < bestLoad) {
        bestLoad = load;
        bestAgentId = agent.id;
      }
    }
    return bestAgentId;
  }
}
