import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import { IdentityService, IdentityResult } from '../identity/identity.service';
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
}

@Injectable()
export class NumbersService {
  private readonly logger = new Logger(NumbersService.name);

  constructor(
    private readonly redisService: RedisService,
    private readonly identityService: IdentityService,
    private readonly spamService: SpamService,
    @InjectQueue('numbers') private readonly numbersQueue: Queue,
  ) {}

  async lookup(lookupDto: LookupDto): Promise<LookupResult> {
    const phoneNumber = this.identityService.normalizePhone(lookupDto.phoneNumber);
    const cacheKey = `${CACHE_PREFIX}${phoneNumber}`;

    // Check Redis cache
    const cached = await this.redisService.get(cacheKey);
    if (cached) {
      this.logger.debug(`Cache hit for ${phoneNumber}`);
      return JSON.parse(cached);
    }

    // Resolve identity using the full pipeline
    const identity: IdentityResult = await this.identityService.resolveIdentity(phoneNumber);
    const spamScore = await this.spamService.getSpamScore(phoneNumber);

    // Run AI-enhanced spam analysis if score is ambiguous (between 2-15)
    let spamCategory: string | undefined;
    let finalSpamScore = spamScore;
    let isLikelySpam = spamScore > 5;

    if (spamScore >= 2) {
      try {
        const aiSpam = await this.spamService.analyzeSpamWithAI(phoneNumber);
        finalSpamScore = Math.round(aiSpam.spamScore / 10); // normalize
        isLikelySpam = aiSpam.isSpam;
        spamCategory = aiSpam.category;
      } catch {
        // fallback already set above
      }
    }

    // AI categorization for identified numbers
    let numberCategory: string | undefined;
    if (identity.name) {
      try {
        const cat = await this.spamService.categorizeWithAI(phoneNumber, identity.name);
        if (cat) numberCategory = cat.category;
      } catch {
        // ignore
      }
    }

    const result: LookupResult = {
      phoneNumber,
      name: identity.name,
      confidence: identity.confidence,
      sourceCount: identity.sourceCount,
      isVerified: identity.isVerified,
      spamScore: finalSpamScore,
      isLikelySpam,
      spamCategory,
      numberCategory,
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
}
