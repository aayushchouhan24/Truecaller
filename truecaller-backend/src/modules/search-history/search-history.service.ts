import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class SearchHistoryService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, query: string, phoneNumber?: string, resultName?: string) {
    return this.prisma.searchHistory.create({
      data: { userId, query, phoneNumber, resultName },
    });
  }

  async findAll(userId: string) {
    return this.prisma.searchHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
  }

  async clear(userId: string) {
    return this.prisma.searchHistory.deleteMany({
      where: { userId },
    });
  }
}
