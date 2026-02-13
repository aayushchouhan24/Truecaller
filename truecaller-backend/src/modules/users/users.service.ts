import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(private readonly prisma: PrismaService) {}

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        phoneNumber: true,
        name: true,
        verificationLevel: true,
        trustScore: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async findByPhoneNumber(phoneNumber: string) {
    return this.prisma.user.findUnique({ where: { phoneNumber } });
  }

  async updateName(id: string, name: string) {
    return this.prisma.user.update({
      where: { id },
      data: { name },
    });
  }

  async getUserStats(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    const [contactsCount, spamReportsCount, contributionsCount] = await Promise.all([
      this.prisma.userContact.count({ where: { userId } }),
      this.prisma.spamReport.count({ where: { reporterId: userId } }),
      this.prisma.nameContribution.count({ where: { contributorId: userId } }),
    ]);

    return {
      contactsSynced: contactsCount,
      spamReported: spamReportsCount,
      nameContributions: contributionsCount,
      trustScore: user.trustScore,
      verificationLevel: user.verificationLevel,
    };
  }
}
