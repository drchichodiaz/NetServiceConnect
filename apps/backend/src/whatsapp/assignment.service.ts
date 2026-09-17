import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AssignmentService {
  constructor(private prisma: PrismaService) {}

  /**
   * Asigna al agente activo con menor cantidad de conversaciones abiertas/pendientes
   * en el tenant. Empate se resuelve por orden de creación del usuario (más antiguo primero).
   *
   * `channelAccountId` es la linea por la que entro la conversacion. Solo se consideran
   * los agentes que pueden ver esa linea: a uno limitado a otra sucursal la conversacion
   * le queda invisible, asi que asignarsela es dejarla sin atender sin que nadie lo note.
   * Un agente sin restricciones ve todas las lineas y siempre entra en el reparto.
   */
  async findLeastBusyAgent(tenantId: string, channelAccountId?: string | null): Promise<string | null> {
    const agents = await this.prisma.user.findMany({
      where: {
        tenantId,
        role: 'AGENT',
        isActive: true,
        // Sin linea (conversaciones previas al multi-numero) no hay a quien excluir:
        // esas son visibles para todos, misma regla que ChannelAccessService.
        ...(channelAccountId
          ? {
              OR: [
                { channelAccess: { none: {} } },
                { channelAccess: { some: { channelAccountId } } },
              ],
            }
          : {}),
      },
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
