import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class FavoritesService {
  constructor(private prisma: PrismaService) {}

  async add(userId: string, phoneNumber: string, name: string) {
    return this.prisma.favorite.upsert({
      where: { userId_phoneNumber: { userId, phoneNumber } },
      update: { name },
      create: { userId, phoneNumber, name },
    });
  }

  async findAll(userId: string) {
    return this.prisma.favorite.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async remove(userId: string, phoneNumber: string) {
    const fav = await this.prisma.favorite.findUnique({
      where: { userId_phoneNumber: { userId, phoneNumber } },
    });
    if (!fav) throw new NotFoundException('Favorite not found');
    return this.prisma.favorite.delete({ where: { id: fav.id } });
  }
}
