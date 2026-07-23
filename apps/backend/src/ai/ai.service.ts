import { Injectable, BadRequestException, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { OpenAiClientService } from '../common/openai-client.service';
import OpenAI from 'openai';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private prisma: PrismaService,
    private openaiClient: OpenAiClientService,
  ) {}

  private async getOpenAI(tenantId: string): Promise<{ client: OpenAI; model: string }> {
    const resolved = await this.openaiClient.getClient(tenantId);
    if (!resolved) {
      throw new BadRequestException(
        'No hay una clave de OpenAI configurada. Agrégala en Configuración → IA.',
      );
    }
    return resolved;
  }

  async suggestReply(tenantId: string, conversationId: string) {
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

    try {
      const { client, model } = await this.getOpenAI(tenantId);

      const completion = await client.chat.completions.create({
        model,
        messages: [{ role: 'system', content: systemPrompt }, ...history],
        max_tokens: 300,
        temperature: 0.7,
      });

      const suggestion = completion.choices[0]?.message?.content?.trim();
      if (!suggestion) throw new BadRequestException('AI returned empty response');

      return { suggestion };
    } catch (err) {
      if (err instanceof BadRequestException) throw err;
      this.logger.error('OpenAI error', err);
      throw new BadRequestException('Error al generar sugerencia con IA. Verifica tu clave de API.');
    }
  }
}
