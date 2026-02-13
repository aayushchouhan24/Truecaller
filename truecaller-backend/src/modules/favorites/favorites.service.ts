import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class FavoritesService {
  constructor(private readonly prisma: PrismaService) {}

  async getAll(userId: string) {
    return this.prisma.favorite.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async add(userId: string, phoneNumber: string, name: string) {
    return this.prisma.favorite.upsert({
      where: { userId_phoneNumber: { userId, phoneNumber } },
      update: { name },
      create: { userId, phoneNumber, name },
    });
  }

  async remove(userId: string, phoneNumber: string) {
    await this.prisma.favorite.deleteMany({
      where: { userId, phoneNumber },
    });
    return { message: 'Favorite removed' };
  }
}
