import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../database/prisma.service';
import { RedisService } from '../redis/redis.service';
import { IdentityIntelligenceService } from '../modules/identity/identity-intelligence.service';
import { SpamService } from '../modules/spam/spam.service';

@Processor('numbers')
export class NumbersProcessor extends WorkerHost {
  private readonly logger = new Logger(NumbersProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly intelligenceService: IdentityIntelligenceService,
    private readonly spamService: SpamService,
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
      case 'ai-spam-analysis':
        await this.handleAISpamAnalysis(job.data);
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
      // Re-resolve the identity using the new intelligence engine
      const result = await this.intelligenceService.resolveIdentityProfile(data.phoneNumber);
      this.logger.log(
        `Identity resolved: ${data.phoneNumber} → "${result.name}" (${result.confidence} confidence)`,
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

    // Run AI-enhanced spam analysis
    try {
      const aiSpam = await this.spamService.analyzeSpamWithAI(data.phoneNumber);
      this.logger.log(
        `AI spam result for ${data.phoneNumber}: score=${aiSpam.spamScore}, ` +
        `category=${aiSpam.category}, isSpam=${aiSpam.isSpam}`,
      );

      if (aiSpam.isSpam) {
        // Mark clusters as spam-tagged
        await this.prisma.nameCluster.updateMany({
          where: {
            identity: { phoneNumber: data.phoneNumber },
          },
          data: { isSpamTagged: true },
        });
      }
    } catch (err) {
      this.logger.warn(`AI spam analysis failed, using fallback: ${err.message}`);

      // Fallback: basic threshold check
      const spamScore = await this.prisma.spamScore.findUnique({
        where: { phoneNumber: data.phoneNumber },
      });

      if (spamScore && spamScore.score > 5) {
        this.logger.warn(
          `${data.phoneNumber} flagged as likely spam (score: ${spamScore.score})`,
        );
        await this.prisma.nameCluster.updateMany({
          where: {
            identity: { phoneNumber: data.phoneNumber },
          },
          data: { isSpamTagged: true },
        });
      }
    }

    // Invalidate cache
    await this.redisService.del(`lookup:${data.phoneNumber}`);

    this.logger.log(`Spam update complete for ${data.phoneNumber}`);
  }

  private async handleAISpamAnalysis(data: { phoneNumber: string }) {
    this.logger.log(`Running AI spam analysis for ${data.phoneNumber}`);

    try {
      const result = await this.spamService.analyzeSpamWithAI(data.phoneNumber);
      this.logger.log(
        `AI spam analysis complete: ${data.phoneNumber} → score=${result.spamScore}, ` +
        `category=${result.category}`,
      );
    } catch (err) {
      this.logger.error(`AI spam analysis failed for ${data.phoneNumber}: ${err.message}`);
    }

    await this.redisService.del(`lookup:${data.phoneNumber}`);
  }
}
