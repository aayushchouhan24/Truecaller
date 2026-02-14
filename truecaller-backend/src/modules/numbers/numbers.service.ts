import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { IdentityService } from '../identity/identity.service';
import { SpamService } from '../spam/spam.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { LookupDto } from './dto/lookup.dto';
import { ReportSpamDto } from './dto/report-spam.dto';
import { AddNameDto } from './dto/add-name.dto';

const CACHE_TTL = 86400; // 24 hours — names are resolved on sync, not on lookup
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
    private readonly spamService: SpamService,
    @InjectQueue('numbers') private readonly numbersQueue: Queue,
  ) {}

  async lookup(lookupDto: LookupDto, userId?: string): Promise<LookupResult> {
    const phoneNumber = this.identityService.normalizePhone(lookupDto.phoneNumber);
    const cacheKey = `${CACHE_PREFIX}${phoneNumber}`;

    // Check Redis cache first (fast path)
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

    // ── Read pre-computed data from DB (no AI — names resolved on contact sync) ──
    const identity = await this.identityService.findOrCreateIdentity(phoneNumber);
    const isVerified = !!identity.verifiedName;
    const resolvedName = isVerified
      ? identity.verifiedName
      : (identity.resolvedName || null);

    // Use pre-computed tags/role/description from the NumberIdentity row
    const tags: string[] = (identity as any).tags ?? [];
    const probableRole: string | null = (identity as any).probableRole ?? null;
    const description: string | null = (identity as any).description ?? null;

    // Spam: only read from DB, no AI calls during lookup
    const spamScore = await this.spamService.getSpamScore(phoneNumber);
    const uniqueReporters = await this.spamService.getUniqueReporterCount(phoneNumber);
    const isLikelySpam = uniqueReporters >= 3 && spamScore > 5;

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
      confidence: isVerified ? 100 : Math.round((identity.confidence ?? 0)),
      sourceCount: identity.sourceCount,
      isVerified,
      spamScore,
      isLikelySpam,
      tags,
      probableRole,
      description,
      hasUserReportedSpam,
    };

    // Cache for 24 hours (names update on contact sync, not on lookup)
    await this.redisService.set(cacheKey, JSON.stringify(result), CACHE_TTL);

    // If identity has no resolvedName yet but has contributions, queue a background resolve
    if (!resolvedName && identity.sourceCount > 0) {
      this.numbersQueue.add('recalculate-identity', {
        phoneNumber,
        contributionId: 'lookup-trigger',
      }).catch(() => {});
    }

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
