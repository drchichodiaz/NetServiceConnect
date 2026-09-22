import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AiGatewayService } from '../ai-usage/ai-gateway.service';

@Injectable()
export class AiService {
  constructor(
    private prisma: PrismaService,
    private ai: AiGatewayService,
  ) {}

  async suggestReply(tenantId: string, conversationId: string, userId?: string) {
    const conv = await this.prisma.conversation.findFirst({
      where: { id: conversationId, tenantId },
      include: { contact: { select: { name: true, phone: true } } },
    });
    if (!conv) throw new NotFoundException('Conversation not found');

    const messages = await this.prisma.message.findMany({
      where: { conversationId, tenantId, direction: { in: ['INBOUND', 'OUTBOUND'] } },
      orderBy: { createdAt: 'asc' },
      take: 20,
      include: { sender: { select: { name: true } } },
    });

    if (messages.length === 0) throw new BadRequestException('No messages in this conversation');

    const history: { role: 'user' | 'assistant'; content: string }[] = messages.map((m) => ({
      role: m.direction === 'INBOUND' ? 'user' : 'assistant',
      content: m.body || `[${m.type.toLowerCase()}]`,
    }));

    const contactName = conv.contact.name || conv.contact.phone;

    const systemPrompt = `You are a professional customer support agent.
The customer's name is ${contactName}.
Read the conversation below and write a concise, helpful, and friendly reply to the last customer message.
Reply in the same language the customer is using.
Keep the response under 200 words. Do not add any explanation, just the reply text.`;

    // Pasa por el gateway y no por OpenAI directo: asi el consumo del agente queda
    // medido igual que el del bot. Los mensajes de error son los mismos de antes.
    const result = await this.ai.chat(tenantId, {
      feature: 'agent_suggestion',
      messages: [{ role: 'system', content: systemPrompt }, ...history],
      maxTokens: 300,
      temperature: 0.7,
      conversationId,
      userId,
    });

    if (!result.ok) {
      if (result.reason === 'NOT_CONFIGURED') {
        throw new BadRequestException(
          'No hay una clave de OpenAI configurada. Agrégala en Configuración → IA.',
        );
      }
      if (result.reason === 'NO_CREDITS' || result.reason === 'AI_DISABLED') {
        // Acá sí se nombra: quien lo lee es un agente de la empresa con sesión
        // iniciada, no el cliente final de la conversación.
        throw new BadRequestException(
          'Se agotaron los créditos de IA de la empresa. Contacta al administrador para recargarlos.',
        );
      }
      if (result.reason === 'EMPTY_RESPONSE') {
        throw new BadRequestException('AI returned empty response');
      }
      throw new BadRequestException('Error al generar sugerencia con IA. Verifica tu clave de API.');
    }

    return { suggestion: result.text };
  }
}
