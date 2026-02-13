import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

@Injectable()
export class SpamService {
  private readonly logger = new Logger(SpamService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getSpamScore(phoneNumber: string): Promise<number> {
    const record = await this.prisma.spamScore.findUnique({
      where: { phoneNumber },
    });
    return record?.score ?? 0;
  }

  async reportSpam(reporterId: string, phoneNumber: string, reason?: string) {
    // Create the spam report
    const report = await this.prisma.spamReport.create({
      data: {
        reporterId,
        phoneNumber,
        reason,
      },
    });

    // Increment spam score
    await this.prisma.spamScore.upsert({
      where: { phoneNumber },
      update: { score: { increment: 1 } },
      create: { phoneNumber, score: 1 },
    });

    this.logger.log(`Spam reported for ${phoneNumber} by ${reporterId}`);
    return report;
  }

  async isLikelySpam(phoneNumber: string): Promise<boolean> {
    const score = await this.getSpamScore(phoneNumber);
    return score > 5;
  }

  async getTopSpamNumbers(limit = 20) {
    return this.prisma.spamScore.findMany({
      where: { score: { gt: 0 } },
      orderBy: { score: 'desc' },
      take: limit,
    });
  }

  async getSpamStats() {
    const totalReports = await this.prisma.spamReport.count();
    const flaggedNumbers = await this.prisma.spamScore.count({ where: { score: { gt: 5 } } });
    const blockedNumbers = await this.prisma.spamScore.count({ where: { score: { gt: 20 } } });
    return { totalReports, flaggedNumbers, blockedNumbers };
  }

  async getReportsForNumber(phoneNumber: string) {
    return this.prisma.spamReport.findMany({
      where: { phoneNumber },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }
}
