/**
 * Identity Intelligence Service
 *
 * NestJS service that orchestrates the 10-step identity intelligence pipeline.
 * Reads crowdsourced data from Prisma, runs the engine modules, persists results.
 *
 * Pipeline:
 *   1. Gather raw NameContributions + UserContacts for the phone number
 *   2. Tokenize & normalise
 *   3. Classify tokens probabilistically (using cached global stats)
 *   4. Extract name candidates
 *   5. Cluster candidates by similarity
 *   6. Score clusters (frequency × trust × structure × uniqueness − noise)
 *   7. Mine context (roles, relationships, descriptors)
 *   8-10. Resolve final identity (select winner, generate description, compute confidence)
 *
 * Also provides a periodic stats-refresh method that rebuilds
 * the global TokenStatistic table from all contributions.
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import {
  type CrowdEntry,
  type CleanedEntry,
  type TokenStats,
  type IdentityProfile,
  type PipelineLog,
  normalizeEntries,
  classifyEntryTokens,
  buildGlobalTokenStats,
  extractNameCandidates,
  clusterCandidates,
  scoreClusters,
  mineContext,
  resolveIdentity,
  loadFromDatabase,
  isLoaded,
  getSeedEntries,
  learnToken,
  getRefCounts,
} from './engine';

@Injectable()
export class IdentityIntelligenceService implements OnModuleInit {
  private readonly logger = new Logger(IdentityIntelligenceService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.loadNameReferences();
  }

  // ═══════════════════════════════════════════════════════════════════
  // Name Reference Data — DB Loading & Auto-Learning
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Load name reference data from DB into memory.
   * Seeds the DB on first run if NameReference table is empty.
   */
  async loadNameReferences(): Promise<void> {
    try {
      let refs = await this.prisma.nameReference.findMany({
        select: { token: true, category: true },
      });

      // If DB is empty, seed it with hardcoded data
      if (refs.length === 0) {
        this.logger.log('NameReference table is empty — seeding with initial data…');
        const seeds = getSeedEntries();
        const batchSize = 100;
        for (let i = 0; i < seeds.length; i += batchSize) {
          const batch = seeds.slice(i, i + batchSize);
          await this.prisma.nameReference.createMany({
            data: batch.map((s) => ({
              token: s.token,
              category: s.category as any,
              source: 'SEED' as any,
              confidence: 1.0,
              frequency: 0,
            })),
            skipDuplicates: true,
          });
        }
        this.logger.log(`Seeded ${seeds.length} name references`);
        refs = await this.prisma.nameReference.findMany({
          select: { token: true, category: true },
        });
      }

      loadFromDatabase(refs);
      const counts = getRefCounts();
      this.logger.log(
        `Name references loaded: ${refs.length} from DB | ` +
        `FN=${counts.firstNames} LN=${counts.lastNames} MN=${counts.middleNames} ` +
        `PFX=${counts.prefixes} REL=${counts.relationships} DESC=${counts.descriptors}`,
      );
    } catch (err) {
      this.logger.warn(`Failed to load name references from DB, using seeds only: ${err}`);
    }
  }

  /**
   * Auto-learn name tokens after a successful identity resolution.
   * Tokens classified as NAME_LIKELY with high confidence that are NOT
   * already in the reference data get added as LEARNED.
   */
  private async autoLearnTokens(
    classifiedTokens: Map<string, { type: string; probability: number; positionFirstPct: number; positionLastPct: number; numberCount: number }>,
  ): Promise<void> {
    const toLearn: { token: string; category: string }[] = [];

    for (const [token, info] of classifiedTokens) {
      if (info.type !== 'NAME_LIKELY' || info.probability < 0.5) continue;
      if (token.length < 3) continue;

      // Determine category based on position
      let category: string;
      if (info.positionFirstPct > 0.6) {
        category = 'FIRST_NAME';
      } else if (info.positionLastPct > 0.5) {
        category = 'LAST_NAME';
      } else {
        category = 'MIDDLE_NAME';
      }

      // Only learn if token isn't already known
      const wasNew = learnToken(token, category);
      if (wasNew) {
        toLearn.push({ token: token.toLowerCase(), category });
      }
    }

    // Persist to DB
    if (toLearn.length > 0) {
      try {
        await this.prisma.nameReference.createMany({
          data: toLearn.map((t) => ({
            token: t.token,
            category: t.category as any,
            source: 'LEARNED' as any,
            confidence: 0.7,
            frequency: 1,
          })),
          skipDuplicates: true,
        });
        this.logger.log(`Auto-learned ${toLearn.length} new name token(s): ${toLearn.map((t) => t.token).join(', ')}`);
      } catch (err) {
        this.logger.debug(`Failed to persist learned tokens: ${err}`);
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Public: Full Resolution Pipeline
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Run the complete identity intelligence pipeline for a phone number.
   */
  async resolveIdentityProfile(phoneNumber: string): Promise<IdentityProfile> {
    const logs: PipelineLog[] = [];
    const log = (step: string, detail: string) => {
      logs.push({ step, detail, timestamp: Date.now() });
      this.logger.debug(`[${step}] ${detail}`);
    };

    // ── Step 0: Gather raw data ─────────────────────────────────
    const [contributions, contacts] = await Promise.all([
      this.prisma.nameContribution.findMany({
        where: { identity: { phoneNumber } },
        include: { contributor: true },
      }),
      this.prisma.userContact.findMany({
        where: { phoneNumber },
        include: { user: true },
      }),
    ]);

    log('GATHER', `${contributions.length} contributions, ${contacts.length} contacts`);

    if (contributions.length === 0 && contacts.length === 0) {
      return emptyProfile('No data available for this number.');
    }

    // ── Build CrowdEntries ──────────────────────────────────────
    const crowdEntries: CrowdEntry[] = [];

    for (const c of contributions) {
      crowdEntries.push({
        savedName: c.rawName,
        userId: c.contributorId ?? 'anon',
        timestamp: c.createdAt.getTime(),
        country: 'IN',
        trustScore: c.contributorTrustWeight,
      });
    }

    for (const c of contacts) {
      crowdEntries.push({
        savedName: c.name,
        userId: c.userId,
        timestamp: c.updatedAt.getTime(),
        country: 'IN',
        trustScore: c.user?.trustScore ?? 1.0,
      });
    }

    // ── Step 1: Tokenize ────────────────────────────────────────
    const cleanedEntries = normalizeEntries(crowdEntries);
    log('TOKENIZE', `${cleanedEntries.length}/${crowdEntries.length} entries survived cleaning`);

    if (cleanedEntries.length === 0) {
      return emptyProfile('All entries filtered out during normalisation.');
    }

    // ── Step 2: Classify tokens ─────────────────────────────────
    const globalStats = await this.loadGlobalTokenStats(cleanedEntries);
    const totalNumbers = await this.prisma.numberIdentity.count();
    const classifiedTokens = classifyEntryTokens(cleanedEntries, globalStats, totalNumbers);
    log('CLASSIFY', `${classifiedTokens.size} unique tokens classified`);

    // ── Step 3: Extract name candidates ─────────────────────────
    const candidates = extractNameCandidates(cleanedEntries, classifiedTokens);
    log('EXTRACT', `${candidates.length} name candidates`);

    // ── Step 4: Cluster candidates ──────────────────────────────
    const clusters = clusterCandidates(candidates);
    log('CLUSTER', `${clusters.length} clusters formed`);

    // ── Step 5: Score clusters ──────────────────────────────────
    const uniqueContributors = new Set(crowdEntries.map((e) => e.userId)).size;
    const scoredClusters = scoreClusters(clusters, classifiedTokens, uniqueContributors);
    log('SCORE', `${scoredClusters.length} clusters scored`);

    // ── Steps 6-7: Mine context ─────────────────────────────────
    const context = mineContext(cleanedEntries, classifiedTokens);
    log(
      'CONTEXT',
      `tags=[${context.tags.join(',')}] role=${context.probableRole ?? 'none'}`,
    );

    // ── Steps 8-10: Resolve identity ────────────────────────────
    const profile = resolveIdentity(scoredClusters, context, cleanedEntries.length, logs);
    log('RESOLVE', `"${profile.name}" confidence=${profile.confidence}`);

    // ── Persist ─────────────────────────────────────────────────
    await this.persistProfile(phoneNumber, profile);

    // ── Auto-learn name tokens ──────────────────────────────────
    if (profile.name !== 'Unknown' && profile.confidence > 0.3) {
      await this.autoLearnTokens(classifiedTokens as any);
    }

    return profile;
  }

  // ═══════════════════════════════════════════════════════════════════
  // Public: Refresh Global Token Statistics
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Recompute global token statistics from ALL contributions/contacts
   * and persist them to the TokenStatistic table.
   *
   * Should be invoked periodically (e.g. cron, admin endpoint).
   */
  async refreshGlobalStats(): Promise<{ processed: number }> {
    this.logger.log('Refreshing global token statistics…');

    const allContributions = await this.prisma.nameContribution.findMany({
      select: {
        cleanedName: true,
        identityId: true,
        contributorTrustWeight: true,
        identity: { select: { phoneNumber: true } },
      },
    });

    // Build entries with phone context
    const entriesWithPhone = allContributions.map((c) => ({
      phoneNumber: c.identity.phoneNumber,
      entry: {
        raw: c.cleanedName,
        cleaned: c.cleanedName.toLowerCase(),
        tokens: c.cleanedName
          .toLowerCase()
          .split(/\s+/)
          .filter((t) => t.length > 0),
        userId: '',
        trustScore: c.contributorTrustWeight,
        timestamp: 0,
        country: 'IN',
      } as CleanedEntry,
    }));

    const globalStats = buildGlobalTokenStats(entriesWithPhone);

    // Batch upsert
    let processed = 0;
    const batchSize = 100;
    const entries = [...globalStats.entries()];

    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, i + batchSize);
      await Promise.all(
        batch.map(([token, stats]) =>
          this.prisma.tokenStatistic.upsert({
            where: { token },
            create: {
              token,
              globalFrequency: stats.globalFrequency,
              numberCount: stats.numberCount,
              positionFirstPct: stats.positionFirstPct,
              positionLastPct: stats.positionLastPct,
              soloFrequency: stats.soloFrequency,
              avgTrustWeight: stats.avgTrustWeight,
              nameScore: 0,
            },
            update: {
              globalFrequency: stats.globalFrequency,
              numberCount: stats.numberCount,
              positionFirstPct: stats.positionFirstPct,
              positionLastPct: stats.positionLastPct,
              soloFrequency: stats.soloFrequency,
              avgTrustWeight: stats.avgTrustWeight,
            },
          }),
        ),
      );
      processed += batch.length;
    }

    this.logger.log(`Refreshed stats for ${processed} tokens`);
    return { processed };
  }

  // ═══════════════════════════════════════════════════════════════════
  // Private Helpers
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Load global token statistics for all unique tokens in the entries.
   * Uses cached values from the TokenStatistic table where available;
   * computes and caches missing ones on-the-fly.
   */
  private async loadGlobalTokenStats(
    entries: CleanedEntry[],
  ): Promise<Map<string, TokenStats>> {
    // Collect unique tokens
    const uniqueTokens = new Set<string>();
    for (const entry of entries) {
      for (const token of entry.tokens) uniqueTokens.add(token);
    }

    // Fetch cached stats
    const cached = await this.prisma.tokenStatistic.findMany({
      where: { token: { in: [...uniqueTokens] } },
    });

    const statsMap = new Map<string, TokenStats>();
    const cachedSet = new Set<string>();

    for (const row of cached) {
      statsMap.set(row.token, {
        token: row.token,
        globalFrequency: row.globalFrequency,
        numberCount: row.numberCount,
        positionFirstPct: row.positionFirstPct,
        positionLastPct: row.positionLastPct,
        soloFrequency: row.soloFrequency,
        avgTrustWeight: row.avgTrustWeight,
      });
      cachedSet.add(row.token);
    }

    // Compute missing tokens
    const missing = [...uniqueTokens].filter((t) => !cachedSet.has(t));
    if (missing.length > 0) {
      this.logger.debug(`Computing stats for ${missing.length} uncached token(s)`);

      // Process in parallel batches
      const batchSize = 50;
      for (let i = 0; i < missing.length; i += batchSize) {
        const batch = missing.slice(i, i + batchSize);
        const results = await Promise.all(
          batch.map((token) => this.computeAndCacheTokenStat(token)),
        );

        for (const stats of results) {
          if (stats) statsMap.set(stats.token, stats);
        }
      }
    }

    return statsMap;
  }

  /**
   * Compute statistics for a single token by scanning all contributions
   * that contain it, then cache the result.
   */
  private async computeAndCacheTokenStat(
    token: string,
  ): Promise<TokenStats | null> {
    const contributions = await this.prisma.nameContribution.findMany({
      where: {
        cleanedName: { contains: token, mode: 'insensitive' },
      },
      select: {
        cleanedName: true,
        identityId: true,
        contributorTrustWeight: true,
      },
    });

    if (contributions.length === 0) return null;

    const numberIds = new Set<string>();
    let positionFirstCount = 0;
    let positionLastCount = 0;
    let soloCount = 0;
    let totalTrust = 0;
    let matchCount = 0;

    for (const contrib of contributions) {
      const tokens = contrib.cleanedName.toLowerCase().split(/\s+/);
      const idx = tokens.indexOf(token.toLowerCase());
      if (idx === -1) continue; // false positive from LIKE query

      matchCount++;
      numberIds.add(contrib.identityId);
      totalTrust += contrib.contributorTrustWeight;
      if (idx === 0) positionFirstCount++;
      if (idx === tokens.length - 1) positionLastCount++;
      if (tokens.length === 1) soloCount++;
    }

    if (matchCount === 0) return null;

    const stats: TokenStats = {
      token,
      globalFrequency: matchCount,
      numberCount: numberIds.size,
      positionFirstPct: positionFirstCount / matchCount,
      positionLastPct: positionLastCount / matchCount,
      soloFrequency: soloCount,
      avgTrustWeight: totalTrust / matchCount,
    };

    // Persist
    try {
      await this.prisma.tokenStatistic.upsert({
        where: { token },
        create: {
          token,
          globalFrequency: stats.globalFrequency,
          numberCount: stats.numberCount,
          positionFirstPct: stats.positionFirstPct,
          positionLastPct: stats.positionLastPct,
          soloFrequency: stats.soloFrequency,
          avgTrustWeight: stats.avgTrustWeight,
          nameScore: 0,
        },
        update: {
          globalFrequency: stats.globalFrequency,
          numberCount: stats.numberCount,
          positionFirstPct: stats.positionFirstPct,
          positionLastPct: stats.positionLastPct,
          soloFrequency: stats.soloFrequency,
          avgTrustWeight: stats.avgTrustWeight,
        },
      });
    } catch (err) {
      this.logger.warn(`Failed to cache token stat for "${token}": ${err}`);
    }

    return stats;
  }

  /**
   * Persist the resolved identity profile back to the NumberIdentity row.
   */
  private async persistProfile(
    phoneNumber: string,
    profile: IdentityProfile,
  ): Promise<void> {
    try {
      await this.prisma.numberIdentity.updateMany({
        where: { phoneNumber },
        data: {
          resolvedName: profile.name !== 'Unknown' ? profile.name : null,
          confidence: profile.confidence,
          tags: profile.tags,
          probableRole: profile.probable_role,
          description: profile.description,
          reasoning: profile.reasoning,
          lastResolvedAt: new Date(),
        },
      });
    } catch (err) {
      this.logger.error(`Failed to persist profile for ${phoneNumber}`, err);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Public: Migrate All Existing Data
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Reprocess ALL existing NumberIdentity records through the intelligence
   * pipeline. This is a migration tool to apply the new engine to old data.
   *
   * Steps:
   *   1. Refresh global token stats
   *   2. Reload name reference data (picks up any DB-learned tokens)
   *   3. Iterate over ALL phone numbers that have contributions/contacts
   *   4. Run resolveIdentityProfile on each in batches
   */
  async migrateAll(): Promise<{
    total: number;
    resolved: number;
    failed: number;
    skipped: number;
  }> {
    this.logger.log('Starting full database migration…');

    // Step 1: Refresh global stats
    await this.refreshGlobalStats();

    // Step 2: Reload name references
    await this.loadNameReferences();

    // Step 3: Get all unique phone numbers with data
    const identities = await this.prisma.numberIdentity.findMany({
      select: { phoneNumber: true },
    });

    const total = identities.length;
    let resolved = 0;
    let failed = 0;
    let skipped = 0;

    this.logger.log(`Migrating ${total} phone numbers…`);

    // Step 4: Process in batches
    const batchSize = 10;
    for (let i = 0; i < identities.length; i += batchSize) {
      const batch = identities.slice(i, i + batchSize);

      const results = await Promise.allSettled(
        batch.map(async (identity) => {
          try {
            const profile = await this.resolveIdentityProfile(identity.phoneNumber);
            if (profile.name !== 'Unknown') {
              resolved++;
            } else {
              skipped++;
            }
          } catch (err) {
            this.logger.warn(`Migration failed for ${identity.phoneNumber}: ${err}`);
            failed++;
          }
        }),
      );

      // Log progress
      const processed = Math.min(i + batchSize, total);
      if (processed % 50 === 0 || processed === total) {
        this.logger.log(`Migration progress: ${processed}/${total} (resolved=${resolved}, failed=${failed}, skipped=${skipped})`);
      }
    }

    this.logger.log(`Migration complete: ${total} total, ${resolved} resolved, ${failed} failed, ${skipped} skipped`);
    return { total, resolved, failed, skipped };
  }
}

// ── Utility ──────────────────────────────────────────────────────────

function emptyProfile(reason: string): IdentityProfile {
  return {
    name: 'Unknown',
    confidence: 0,
    tags: [],
    probable_role: null,
    description: reason,
    reasoning: reason,
  };
}
