import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateQuickReplyDto } from './dto/quick-reply.dto';

@Injectable()
export class QuickRepliesService {
  constructor(private prisma: PrismaService) {}

  findAll(tenantId: string) {
    return this.prisma.quickReply.findMany({
      where: { tenantId },
      orderBy: { shortcut: 'asc' },
    });
  }

  async create(tenantId: string, dto: CreateQuickReplyDto) {
    const shortcut = dto.shortcut.toLowerCase().replace(/\s+/g, '-');
    try {
      return await this.prisma.quickReply.create({
        data: { tenantId, shortcut, title: dto.title, body: dto.body },
      });
    } catch (err: any) {
      if (err.code === 'P2002') {
        throw new ConflictException(`El atajo "/${shortcut}" ya existe`);
      }
      throw err;
    }
  }

  async update(tenantId: string, id: string, dto: Partial<CreateQuickReplyDto>) {
    const existing = await this.prisma.quickReply.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Respuesta rápida no encontrada');
    return this.prisma.quickReply.update({
      where: { id },
      data: {
        ...(dto.shortcut && { shortcut: dto.shortcut.toLowerCase().replace(/\s+/g, '-') }),
        ...(dto.title && { title: dto.title }),
        ...(dto.body && { body: dto.body }),
      },
    });
  }

  async remove(tenantId: string, id: string) {
    const existing = await this.prisma.quickReply.findFirst({ where: { id, tenantId } });
    if (!existing) throw new NotFoundException('Respuesta rápida no encontrada');
    return this.prisma.quickReply.delete({ where: { id } });
  }
}
