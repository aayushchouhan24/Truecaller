import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { SpamService } from '../spam/spam.service';
import { CreateCallDto } from './dto/create-call.dto';
import { CallType } from '@prisma/client';

@Injectable()
export class CallHistoryService {
  constructor(
    private prisma: PrismaService,
    private spamService: SpamService,
  ) {}

  async create(userId: string, dto: CreateCallDto) {
    const isSpam = await this.spamService.isLikelySpam(dto.phoneNumber);
    const spamLabel = isSpam ? 'Suspected spam' : null;

    return this.prisma.callHistory.create({
      data: {
        userId,
        phoneNumber: dto.phoneNumber,
        name: dto.name || null,
        type: dto.type,
        duration: dto.duration || 0,
        sim: dto.sim || 1,
        isSpam,
        spamLabel,
      },
    });
  }

  async findAll(userId: string, type?: CallType) {
    const where: any = { userId };
    if (type) where.type = type;

    return this.prisma.callHistory.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async deleteOne(userId: string, id: string) {
    return this.prisma.callHistory.deleteMany({
      where: { id, userId },
    });
  }

  async deleteAll(userId: string) {
    return this.prisma.callHistory.deleteMany({
      where: { userId },
    });
  }

  async getRecentContacts(userId: string) {
    // Get unique recent phone numbers with latest call
    const calls = await this.prisma.callHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    const seen = new Set<string>();
    const recent: typeof calls = [];
    for (const c of calls) {
      if (!seen.has(c.phoneNumber)) {
        seen.add(c.phoneNumber);
        recent.push(c);
        if (recent.length >= 10) break;
      }
    }
    return recent;
  }
}
