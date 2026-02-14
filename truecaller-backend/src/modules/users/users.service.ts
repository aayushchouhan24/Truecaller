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

  async getUserSpamReports(userId: string) {
    const reports = await this.prisma.spamReport.findMany({
      where: { reporterId: userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });

    // Group by phone number and get the latest report per number
    const grouped = new Map<string, { phoneNumber: string; reason: string | null; createdAt: Date; count: number }>();
    for (const r of reports) {
      const existing = grouped.get(r.phoneNumber);
      if (existing) {
        existing.count++;
      } else {
        grouped.set(r.phoneNumber, {
          phoneNumber: r.phoneNumber,
          reason: r.reason,
          createdAt: r.createdAt,
          count: 1,
        });
      }
    }

    return [...grouped.values()];
  }
}
