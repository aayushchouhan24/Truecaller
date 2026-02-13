import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';
import { IdentityService } from '../modules/identity/identity.service';

@Processor('numbers')
export class NumbersProcessor extends WorkerHost {
  private readonly logger = new Logger(NumbersProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly identityService: IdentityService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case 'recalculate-identity':
        await this.handleRecalculateIdentity(job.data);
        break;
      case 'update-confidence-after-spam':
        await this.handleUpdateConfidenceAfterSpam(job.data);
        break;
      default:
        this.logger.warn(`Unknown job: ${job.name}`);
    }
  }

  private async handleRecalculateIdentity(data: {
    phoneNumber: string;
    contributionId: string;
  }) {
    this.logger.log(
      `Recalculating identity for ${data.phoneNumber} (contribution: ${data.contributionId})`,
    );

    try {
      // Re-resolve the identity (triggers clustering + best name selection)
      const result = await this.identityService.resolveIdentity(data.phoneNumber);
      this.logger.log(
        `Identity resolved: ${data.phoneNumber} → "${result.name}" (${result.confidence}% confidence)`,
      );
    } catch (error) {
      this.logger.error(`Failed to recalculate identity for ${data.phoneNumber}`, error);
    }

    // Invalidate cache
    await this.redisService.del(`lookup:${data.phoneNumber}`);
  }

  private async handleUpdateConfidenceAfterSpam(data: {
    phoneNumber: string;
    reportId: string;
  }) {
    this.logger.log(
      `Updating after spam report for ${data.phoneNumber}`,
    );

    // Get current spam score
    const spamScore = await this.prisma.spamScore.findUnique({
      where: { phoneNumber: data.phoneNumber },
    });

    if (spamScore && spamScore.score > 5) {
      this.logger.warn(
        `${data.phoneNumber} flagged as likely spam (score: ${spamScore.score})`,
      );

      // Mark clusters as spam-tagged if score is high
      await this.prisma.nameCluster.updateMany({
        where: {
          identity: { phoneNumber: data.phoneNumber },
        },
        data: { isSpamTagged: true },
      });
    }

    // Invalidate cache
    await this.redisService.del(`lookup:${data.phoneNumber}`);

    this.logger.log(`Spam update complete for ${data.phoneNumber}`);
  }
}
