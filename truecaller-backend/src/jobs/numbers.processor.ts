/**
 * Profile Worker — event-driven processor that writes to number_profiles.
 *
 * Consumes domain events from the `profile-events` BullMQ queue:
 *   • contact-sync         → rebuild profiles for all synced numbers
 *   • spam-report          → recompute spam score for that number
 *   • name-contribution    → re-resolve identity for that number
 *   • profile-edit         → set verified name immediately
 *   • batch-rebuild        → reprocess a set of numbers (admin/migration)
 *
 * After every write to number_profiles, the worker invalidates
 * both Redis and in-process L1 caches via ProfileCacheService.
 *
 * The API process NEVER runs identity computation.
 */

import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../database/prisma.service';
import { ProfileCacheService } from '../cache/profile-cache.service';
import { IdentityIntelligenceService } from '../modules/identity/identity-intelligence.service';
import { SpamService } from '../modules/spam/spam.service';
import {
  EventTypes,
  type ContactSyncEvent,
  type SpamReportEvent,
  type NameContributionEvent,
  type ProfileEditEvent,
  type BatchRebuildEvent,
} from '../events/event-types';
import {
  computeSpamScore,
  type SpamSignals,
} from '../modules/spam/spam-scoring.engine';

const SPAM_NAME_KEYWORDS = [
  'spam', 'fraud', 'fake', 'scam', 'loan', 'insurance',
  'agent', 'block', 'do not pick', 'telecaller', 'marketing',
];

@Processor('profile-events')
export class ProfileWorker extends WorkerHost {
  private readonly logger = new Logger(ProfileWorker.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: ProfileCacheService,
    private readonly intelligence: IdentityIntelligenceService,
    private readonly spamService: SpamService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    try {
      switch (job.name) {
        case EventTypes.CONTACT_SYNC:
          await this.handleContactSync(job.data as ContactSyncEvent);
          break;
        case EventTypes.SPAM_REPORT:
          await this.handleSpamReport(job.data as SpamReportEvent);
          break;
        case EventTypes.NAME_CONTRIBUTION:
          await this.handleNameContribution(job.data as NameContributionEvent);
          break;
        case EventTypes.PROFILE_EDIT:
          await this.handleProfileEdit(job.data as ProfileEditEvent);
          break;
        case EventTypes.BATCH_REBUILD:
          await this.handleBatchRebuild(job.data as BatchRebuildEvent);
          break;
        default:
          this.logger.warn(`Unknown event type: ${job.name}`);
      }
    } catch (err: any) {
      this.logger.error(`Worker failed on ${job.name}: ${err.message}`, err.stack);
      throw err; // let BullMQ retry
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Event Handlers
  // ═══════════════════════════════════════════════════════════════════

  /**
   * CONTACT_SYNC — rebuild profiles for every synced phone number.
   * Processes in batches of 10 with parallel resolution.
   */
  private async handleContactSync(data: ContactSyncEvent): Promise<void> {
    const { phoneNumbers, userId } = data;
    this.logger.log(
      `Processing contact-sync: ${phoneNumbers.length} numbers (user: ${userId})`,
    );

    const BATCH = 10;
    let resolved = 0;
    let failed = 0;

    for (let i = 0; i < phoneNumbers.length; i += BATCH) {
      const batch = phoneNumbers.slice(i, i + BATCH);

      const results = await Promise.allSettled(
        batch.map((phone) => this.rebuildProfile(phone)),
      );

      for (const r of results) {
        if (r.status === 'fulfilled') resolved++;
        else failed++;
      }

      // Log progress every 50
      const processed = Math.min(i + BATCH, phoneNumbers.length);
      if (processed % 50 === 0 || processed === phoneNumbers.length) {
        this.logger.log(
          `Contact-sync progress: ${processed}/${phoneNumbers.length} ` +
          `(resolved=${resolved}, failed=${failed})`,
        );
      }
    }

    this.logger.log(
      `Contact-sync complete: ${phoneNumbers.length} total, ` +
      `${resolved} resolved, ${failed} failed`,
    );
  }

  /**
   * SPAM_REPORT — recompute spam score using weighted engine.
   */
  private async handleSpamReport(data: SpamReportEvent): Promise<void> {
    const { phoneNumber, action } = data;
    this.logger.log(`Processing spam-report: ${phoneNumber} (${action})`);

    await this.rebuildSpamScore(phoneNumber);
    await this.cache.invalidate(phoneNumber);
  }

  /**
   * NAME_CONTRIBUTION — re-resolve identity + update profile.
   */
  private async handleNameContribution(data: NameContributionEvent): Promise<void> {
    const { phoneNumber } = data;
    this.logger.log(`Processing name-contribution: ${phoneNumber}`);

    await this.rebuildProfile(phoneNumber);
  }

  /**
   * PROFILE_EDIT — user set their verified name. High priority.
   */
  private async handleProfileEdit(data: ProfileEditEvent): Promise<void> {
    const { phoneNumber, verifiedName } = data;
    this.logger.log(`Processing profile-edit: ${phoneNumber} → "${verifiedName}"`);

    // Direct write — no need to run the full pipeline
    await this.prisma.numberProfile.upsert({
      where: { phoneNumber },
      update: {
        resolvedName: verifiedName,
        confidence: 1.0,
        isVerified: true,
        version: { increment: 1 },
      },
      create: {
        phoneNumber,
        resolvedName: verifiedName,
        confidence: 1.0,
        isVerified: true,
        sourceCount: 1,
      },
    });

    await this.cache.invalidate(phoneNumber);
  }

  /**
   * BATCH_REBUILD — admin/migration tool.
   */
  private async handleBatchRebuild(data: BatchRebuildEvent): Promise<void> {
    const { phoneNumbers, triggeredBy } = data;
    this.logger.log(
      `Processing batch-rebuild: ${phoneNumbers.length} numbers (by: ${triggeredBy})`,
    );

    for (const phone of phoneNumbers) {
      try {
        await this.rebuildProfile(phone);
      } catch (err: any) {
        this.logger.warn(`Batch rebuild failed for ${phone}: ${err.message}`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Core: Rebuild a single number_profile row
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Full rebuild: identity pipeline + spam scoring → upsert number_profiles → invalidate cache.
   */
  private async rebuildProfile(phoneNumber: string): Promise<void> {
    // ── 1. Run identity intelligence pipeline ───────────────────
    const identityProfile = await this.intelligence.resolveIdentityProfile(phoneNumber);

    // ── 2. Compute spam score ──────────────────────────────────
    const spamResult = await this.rebuildSpamScore(phoneNumber);

    // ── 3. Count sources ───────────────────────────────────────
    const sourceCount = await this.prisma.nameContribution.count({
      where: { identity: { phoneNumber } },
    });

    // ── 4. Write to number_profiles (single upsert) ───────────
    await this.prisma.numberProfile.upsert({
      where: { phoneNumber },
      update: {
        resolvedName: identityProfile.name !== 'Unknown' ? identityProfile.name : null,
        description: identityProfile.description,
        confidence: identityProfile.confidence,
        spamScore: spamResult.score,
        spamCategory: spamResult.category,
        tags: identityProfile.tags,
        relationshipHint: identityProfile.probable_role,
        sourceCount,
        version: { increment: 1 },
      },
      create: {
        phoneNumber,
        resolvedName: identityProfile.name !== 'Unknown' ? identityProfile.name : null,
        description: identityProfile.description,
        confidence: identityProfile.confidence,
        spamScore: spamResult.score,
        spamCategory: spamResult.category,
        tags: identityProfile.tags,
        relationshipHint: identityProfile.probable_role,
        sourceCount,
      },
    });

    // ── 5. Invalidate cache ────────────────────────────────────
    await this.cache.invalidate(phoneNumber);
  }

  /**
   * Compute weighted spam score and persist to both spam_scores and number_profiles.
   */
  private async rebuildSpamScore(phoneNumber: string): Promise<{
    score: number;
    category: string;
  }> {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Gather all signals in parallel
    const [
      allReports,
      reportsLast7d,
      reportsLast24h,
      nameContribs,
      totalNameSavers,
      newestReport,
    ] = await Promise.all([
      this.prisma.spamReport.findMany({
        where: { phoneNumber },
        select: { reporterId: true },
        distinct: ['reporterId'],
      }),
      this.prisma.spamReport.count({
        where: { phoneNumber, createdAt: { gte: sevenDaysAgo } },
      }),
      this.prisma.spamReport.count({
        where: { phoneNumber, createdAt: { gte: oneDayAgo } },
      }),
      this.prisma.nameContribution.findMany({
        where: { identity: { phoneNumber } },
        select: { cleanedName: true },
      }),
      this.prisma.userContact.count({
        where: { phoneNumber },
      }),
      this.prisma.spamReport.findFirst({
        where: { phoneNumber },
        orderBy: { createdAt: 'desc' },
        select: { createdAt: true },
      }),
    ]);

    const savedAsSpamByCount = nameContribs.filter((c) =>
      SPAM_NAME_KEYWORDS.some((kw) =>
        c.cleanedName.toLowerCase().includes(kw),
      ),
    ).length;

    const newestReportAgeHours = newestReport
      ? (now.getTime() - newestReport.createdAt.getTime()) / (1000 * 60 * 60)
      : null;

    // Try AI analysis (non-blocking — fallback to null)
    let aiSpamScore: number | null = null;
    let aiCategory: string | null = null;
    try {
      const aiResult = await this.spamService.analyzeSpamWithAI(phoneNumber);
      aiSpamScore = aiResult.spamScore;
      aiCategory = aiResult.category;
    } catch {
      // AI unavailable — use heuristic only
    }

    const signals: SpamSignals = {
      uniqueReporters: allReports.length,
      totalReports: allReports.length,
      reportsLast7d,
      reportsLast24h,
      savedAsSpamByCount,
      totalNameSavers: totalNameSavers,
      newestReportAgeHours,
      aiSpamScore,
      aiCategory,
    };

    const result = computeSpamScore(signals);

    // Persist to spam_scores table too (for backwards compat)
    await this.prisma.spamScore.upsert({
      where: { phoneNumber },
      update: { score: result.score },
      create: { phoneNumber, score: result.score },
    });

    // Update number_profiles spam fields
    await this.prisma.numberProfile.upsert({
      where: { phoneNumber },
      update: {
        spamScore: result.score,
        spamCategory: result.category,
        version: { increment: 1 },
      },
      create: {
        phoneNumber,
        spamScore: result.score,
        spamCategory: result.category,
      },
    });

    return { score: result.score, category: result.category };
  }
}
