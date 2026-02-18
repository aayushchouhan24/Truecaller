/**
 * Numbers Service — ZERO-COMPUTE lookup path.
 *
 * Lookup flow:
 *   Client → L1 (LRU) → L2 (Redis) → L3 (PostgreSQL indexed read) → return
 *
 * Rules:
 *   ✗ No AI calls
 *   ✗ No joins
 *   ✗ No loops
 *   ✗ No extra queries
 *   ✗ No runtime scoring
 *
 * All intelligence is precomputed by the worker and stored in number_profiles.
 * The only per-user query is hasUserReportedSpam (1 indexed read).
 */

import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { ProfileCacheService, type CachedProfile } from '../../cache/profile-cache.service';
import { EventBusService } from '../../events/event-bus.service';
import { IdentityService } from '../identity/identity.service';
import { SpamService } from '../spam/spam.service';
import { LookupDto } from './dto/lookup.dto';
import { ReportSpamDto } from './dto/report-spam.dto';
import { AddNameDto } from './dto/add-name.dto';

export interface LookupResult {
  phoneNumber: string;
  name: string | null;
  confidence: number;
  sourceCount: number;
  isVerified: boolean;
  spamScore: number;
  isLikelySpam: boolean;
  spamCategory: string | null;
  category: string | null;
  tags: string[];
  relationshipHint: string | null;
  description: string | null;
  hasUserReportedSpam: boolean;
}

@Injectable()
export class NumbersService {
  private readonly logger = new Logger(NumbersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: ProfileCacheService,
    private readonly eventBus: EventBusService,
    private readonly identityService: IdentityService,
    private readonly spamService: SpamService,
  ) {}

  /**
   * LOOKUP — the hot path.
   *
   * Single read from cache/DB → shape → return.
   * No compute. No AI. No joins. Target: p50 < 20 ms.
   */
  async lookup(lookupDto: LookupDto, userId?: string): Promise<LookupResult> {
    const phoneNumber = this.identityService.normalizePhone(lookupDto.phoneNumber);

    // ── Single cache read (L1 → L2 → L3) ─────────────────────────
    const profile: CachedProfile | null = await this.cache.get(phoneNumber);

    // ── Per-user spam flag (1 indexed read using composite index) ──
    let hasUserReportedSpam = false;
    if (userId) {
      const report = await this.prisma.spamReport.findFirst({
        where: { reporterId: userId, phoneNumber },
        select: { id: true },
      });
      hasUserReportedSpam = !!report;
    }

    // ── Shape response ─────────────────────────────────────────────
    if (!profile) {
      return {
        phoneNumber,
        name: null,
        confidence: 0,
        sourceCount: 0,
        isVerified: false,
        spamScore: 0,
        isLikelySpam: false,
        spamCategory: null,
        category: null,
        tags: [],
        relationshipHint: null,
        description: null,
        hasUserReportedSpam,
      };
    }

    return {
      phoneNumber,
      name: profile.resolvedName,
      confidence: profile.confidence,
      sourceCount: profile.sourceCount,
      isVerified: profile.isVerified,
      spamScore: profile.spamScore,
      isLikelySpam: profile.spamScore > 50,
      spamCategory: profile.spamCategory,
      category: profile.category,
      tags: profile.tags,
      relationshipHint: profile.relationshipHint,
      description: profile.description,
      hasUserReportedSpam,
    };
  }

  /**
   * Report a phone number as spam.
   * Writes to DB immediately, then emits event for worker to recompute score.
   */
  async reportSpam(userId: string, reportSpamDto: ReportSpamDto) {
    const { phoneNumber, reason } = reportSpamDto;
    const normalized = this.identityService.normalizePhone(phoneNumber);

    const report = await this.spamService.reportSpam(userId, normalized, reason);

    // Emit event — worker will recompute spam score + update number_profiles
    await this.eventBus.emitSpamReport({
      userId,
      phoneNumber: normalized,
      action: 'REPORTED',
      reason,
      reportId: report.id,
      timestamp: Date.now(),
    });

    return { message: 'Spam reported successfully', reportId: report.id };
  }

  /**
   * Add a name contribution for a phone number.
   * Writes to DB immediately, then emits event for worker to re-resolve.
   */
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

    // Emit event — worker will re-resolve identity + update number_profiles
    await this.eventBus.emitNameContribution({
      userId,
      phoneNumber: normalized,
      contributionId: contribution.id,
      name,
      sourceType: sourceType || 'MANUAL',
      timestamp: Date.now(),
    });

    return { message: 'Name contribution added', contributionId: contribution.id, contributed: true };
  }

  /**
   * Remove a user's spam report.
   */
  async removeSpamReport(userId: string, phoneNumber: string) {
    const normalized = this.identityService.normalizePhone(phoneNumber);
    const result = await this.spamService.removeSpamReport(userId, normalized);

    if (result.removed) {
      await this.eventBus.emitSpamReport({
        userId,
        phoneNumber: normalized,
        action: 'REMOVED',
        timestamp: Date.now(),
      });
    }

    return result;
  }
}
