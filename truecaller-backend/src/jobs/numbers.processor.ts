import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';

@Processor('numbers')
export class NumbersProcessor extends WorkerHost {
  private readonly logger = new Logger(NumbersProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case 'recalculate-confidence':
        await this.handleRecalculateConfidence(job.data);
        break;
      case 'update-confidence-after-spam':
        await this.handleUpdateConfidenceAfterSpam(job.data);
        break;
      default:
        this.logger.warn(`Unknown job: ${job.name}`);
    }
  }

  private async handleRecalculateConfidence(data: {
    phoneNumber: string;
    signalId: string;
  }) {
    this.logger.log(
      `Recalculating confidence for ${data.phoneNumber} (signal: ${data.signalId})`,
    );

    // Invalidate any related caches
    await this.redisService.del(`lookup:${data.phoneNumber}`);

    this.logger.log(`Confidence recalculation complete for ${data.phoneNumber}`);
  }

  private async handleUpdateConfidenceAfterSpam(data: {
    phoneNumber: string;
    reportId: string;
  }) {
    this.logger.log(
      `Updating confidence after spam report for ${data.phoneNumber}`,
    );

    // Get current spam score
    const spamScore = await this.prisma.spamScore.findUnique({
      where: { phoneNumber: data.phoneNumber },
    });

    if (spamScore && spamScore.score > 5) {
      this.logger.warn(
        `${data.phoneNumber} is now flagged as likely spam (score: ${spamScore.score})`,
      );
    }

    // Invalidate cache
    await this.redisService.del(`lookup:${data.phoneNumber}`);

    this.logger.log(`Spam confidence update complete for ${data.phoneNumber}`);
  }
}
