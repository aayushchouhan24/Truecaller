import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { IdentityService } from '../identity/identity.service';
import { IdentityIntelligenceService } from '../identity/identity-intelligence.service';
import { SpamService } from '../spam/spam.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { LookupDto } from './dto/lookup.dto';
import { ReportSpamDto } from './dto/report-spam.dto';
import { AddNameDto } from './dto/add-name.dto';

const CACHE_TTL = 300; // 5 minutes
const CACHE_PREFIX = 'lookup:';

export interface LookupResult {
  phoneNumber: string;
  name: string | null;
  confidence: number;
  sourceCount: number;
  isVerified: boolean;
  spamScore: number;
  isLikelySpam: boolean;
  spamCategory?: string;
  numberCategory?: string;
  tags: string[];
  probableRole: string | null;
  description: string | null;
  hasUserReportedSpam: boolean;
}

@Injectable()
export class NumbersService {
  private readonly logger = new Logger(NumbersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly identityService: IdentityService,
    private readonly intelligenceService: IdentityIntelligenceService,
    private readonly spamService: SpamService,
    @InjectQueue('numbers') private readonly numbersQueue: Queue,
  ) {}

  async lookup(lookupDto: LookupDto, userId?: string): Promise<LookupResult> {
    const phoneNumber = this.identityService.normalizePhone(lookupDto.phoneNumber);
    const cacheKey = `${CACHE_PREFIX}${phoneNumber}`;

    // Check Redis cache
    const cached = await this.redisService.get(cacheKey);
    if (cached) {
      this.logger.debug(`Cache hit for ${phoneNumber}`);
      const cachedResult: LookupResult = JSON.parse(cached);
      // Always compute hasUserReportedSpam per-user (not cached)
      if (userId) {
        const userReport = await this.prisma.spamReport.findFirst({
          where: { reporterId: userId, phoneNumber },
        });
        cachedResult.hasUserReportedSpam = !!userReport;
      } else {
        cachedResult.hasUserReportedSpam = false;
      }
      return cachedResult;
    }

    // ── New Intelligence Engine ─────────────────────────────────
    const profile = await this.intelligenceService.resolveIdentityProfile(phoneNumber);

    // Check verified name override
    const identity = await this.identityService.findOrCreateIdentity(phoneNumber);
    const isVerified = !!identity.verifiedName;
    const resolvedName = isVerified ? identity.verifiedName : (profile.name !== 'Unknown' ? profile.name : null);

    // Spam analysis
    const spamScore = await this.spamService.getSpamScore(phoneNumber);
    const uniqueReporters = await this.spamService.getUniqueReporterCount(phoneNumber);
    let spamCategory: string | undefined;
    let finalSpamScore = spamScore;
    // Require at least 3 unique reporters to flag as spam
    let isLikelySpam = uniqueReporters >= 3 && spamScore > 5;

    if (spamScore >= 2) {
      try {
        const aiSpam = await this.spamService.analyzeSpamWithAI(phoneNumber);
        finalSpamScore = Math.round(aiSpam.spamScore / 10);
        isLikelySpam = aiSpam.isSpam;
        spamCategory = aiSpam.category;
      } catch {
        // fallback already set
      }
    }

    // AI categorization for identified numbers
    let numberCategory: string | undefined;
    if (resolvedName) {
      try {
        const cat = await this.spamService.categorizeWithAI(phoneNumber, resolvedName);
        if (cat) numberCategory = cat.category;
      } catch {
        // ignore
      }
    }

    // Check if the requesting user has reported this number as spam
    let hasUserReportedSpam = false;
    if (userId) {
      const userReport = await this.prisma.spamReport.findFirst({
        where: { reporterId: userId, phoneNumber },
      });
      hasUserReportedSpam = !!userReport;
    }

    const result: LookupResult = {
      phoneNumber,
      name: resolvedName,
      confidence: isVerified ? 100 : Math.round(profile.confidence * 100),
      sourceCount: identity.sourceCount,
      isVerified,
      spamScore: finalSpamScore,
      isLikelySpam,
      spamCategory,
      numberCategory,
      tags: profile.tags,
      probableRole: profile.probable_role,
      description: profile.description,
      hasUserReportedSpam,
    };

    // Cache result
    await this.redisService.set(cacheKey, JSON.stringify(result), CACHE_TTL);

    return result;
  }

  async reportSpam(userId: string, reportSpamDto: ReportSpamDto) {
    const { phoneNumber, reason } = reportSpamDto;
    const normalized = this.identityService.normalizePhone(phoneNumber);

    const report = await this.spamService.reportSpam(userId, normalized, reason);

    // Invalidate cache
    await this.redisService.del(`${CACHE_PREFIX}${normalized}`);

    // Trigger background job
    await this.numbersQueue.add('update-confidence-after-spam', {
      phoneNumber: normalized,
      reportId: report.id,
    });

    return { message: 'Spam reported successfully', reportId: report.id };
  }

  async addName(userId: string, addNameDto: AddNameDto) {
    const { phoneNumber, name, sourceType, deviceFingerprint } = addNameDto;
    const normalized = this.identityService.normalizePhone(phoneNumber);

    const contribution = await this.identityService.addNameContribution(
      normalized,
      name,
      userId,
      sourceType || 'MANUAL',
      deviceFingerprint,
    );

    if (!contribution) {
      return { message: 'Name was filtered as junk', contributed: false };
    }

    // Invalidate cache
    await this.redisService.del(`${CACHE_PREFIX}${normalized}`);

    // Trigger background recalculation
    await this.numbersQueue.add('recalculate-identity', {
      phoneNumber: normalized,
      contributionId: contribution.id,
    });

    return { message: 'Name contribution added', contributionId: contribution.id, contributed: true };
  }

  async backfillUnresolvedNames(): Promise<number> {
    return this.identityService.resolveAllUnresolvedNames();
  }

  async removeSpamReport(userId: string, phoneNumber: string) {
    const normalized = this.identityService.normalizePhone(phoneNumber);
    const result = await this.spamService.removeSpamReport(userId, normalized);

    if (result.removed) {
      // Invalidate cache
      await this.redisService.del(`${CACHE_PREFIX}${normalized}`);
    }

    return result;
  }
}
