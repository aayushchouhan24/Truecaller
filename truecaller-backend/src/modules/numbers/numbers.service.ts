import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import { IdentityService } from '../identity/identity.service';
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
  bestName: string | null;
  confidenceScore: number;
  spamScore: number;
  isLikelySpam: boolean;
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

  /** Normalize phone number to +91XXXXXXXXXX format */
  private normalizePhone(phone: string): string {
    let c = phone.replace(/[\s\-()]/g, '');
    if (/^\d{10}$/.test(c)) c = '+91' + c;
    else if (c.startsWith('91') && c.length === 12) c = '+' + c;
    else if (c.startsWith('091') && c.length === 13) c = '+' + c.slice(1);
    else if (!c.startsWith('+') && c.length > 5) c = '+' + c;
    return c;
  }

  async lookup(lookupDto: LookupDto): Promise<LookupResult> {
    const phoneNumber = this.normalizePhone(lookupDto.phoneNumber);
    const cacheKey = `${CACHE_PREFIX}${phoneNumber}`;

    // Check Redis cache
    const cached = await this.redisService.get(cacheKey);
    if (cached) {
      this.logger.debug(`Cache hit for ${phoneNumber}`);
      return JSON.parse(cached);
    }

    // Compute identity
    const identity = await this.identityService.computeIdentity(phoneNumber);
    const spamScore = await this.spamService.getSpamScore(phoneNumber);

    const result: LookupResult = {
      phoneNumber,
      bestName: identity.bestName,
      confidenceScore: identity.confidenceScore,
      spamScore,
      isLikelySpam: spamScore > 5,
    };

    // Cache result
    await this.redisService.set(cacheKey, JSON.stringify(result), CACHE_TTL);
    this.logger.debug(`Cached lookup result for ${phoneNumber}`);

    return result;
  }

  async reportSpam(userId: string, reportSpamDto: ReportSpamDto) {
    const { phoneNumber, reason } = reportSpamDto;

    const report = await this.spamService.reportSpam(
      userId,
      phoneNumber,
      reason,
    );

    // Invalidate cache
    await this.redisService.del(`${CACHE_PREFIX}${phoneNumber}`);

    // Trigger background job
    await this.numbersQueue.add('update-confidence-after-spam', {
      phoneNumber,
      reportId: report.id,
    });

    return { message: 'Spam reported successfully', reportId: report.id };
  }

  async addName(addNameDto: AddNameDto) {
    const { phoneNumber, name, sourceType, weight } = addNameDto;

    const signal = await this.identityService.addNameSignal(
      phoneNumber,
      name,
      sourceType,
      weight,
    );

    // Invalidate cache
    await this.redisService.del(`${CACHE_PREFIX}${phoneNumber}`);

    // Trigger background job to recalculate
    await this.numbersQueue.add('recalculate-confidence', {
      phoneNumber,
      signalId: signal.id,
    });

    return { message: 'Name signal added successfully', signalId: signal.id };
  }
}
