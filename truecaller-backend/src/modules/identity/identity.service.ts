import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { OllamaService } from '../ollama/ollama.service';
import { SourceType } from '@prisma/client';
import {
  cleanName,
  nameSimilarity,
  capitalizeName,
} from './name-cleaner';

// ── Types ──────────────────────────────────────────────────────────────

export interface IdentityResult {
  phoneNumber: string;
  name: string | null;
  confidence: number;
  sourceCount: number;
  isVerified: boolean;
}

interface NameClusterData {
  representativeName: string;
  variants: string[];
  totalWeight: number;
  frequency: number;
}

// Similarity threshold for clustering
const CLUSTER_THRESHOLD = 0.55;

// Minimum new contributions before re-resolving
const RECALC_THRESHOLD = 3;

// ── AI Scoring Weights ─────────────────────────────────────────────
const SCORE_WEIGHTS = {
  frequency: 0.20,       // How many people contributed this name
  trustWeight: 0.25,     // Sum of contributor trust scores
  nameCompleteness: 0.15, // Full names score higher than single tokens
  sourceDiversity: 0.15,  // Multiple source types (contact, manual, verified) = better
  recency: 0.10,         // Recent contributions score higher
  consistency: 0.15,     // How consistent names are within the cluster
};

@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ollamaService: OllamaService,
  ) {}

  // ── Phone Normalization ─────────────────────────────────────────────

  normalizePhone(phone: string): string {
    let c = phone.replace(/[\s\-()]/g, '');
    if (/^\d{10}$/.test(c)) c = '+91' + c;
    else if (c.startsWith('91') && c.length === 12) c = '+' + c;
    else if (c.startsWith('091') && c.length === 13) c = '+' + c.slice(1);
    else if (!c.startsWith('+') && c.length > 5) c = '+' + c;
    return c;
  }

  // ── STEP 1 & 2: Find or Create Identity ─────────────────────────────

  async findOrCreateIdentity(phoneNumber: string) {
    const normalized = this.normalizePhone(phoneNumber);

    let identity = await this.prisma.numberIdentity.findUnique({
      where: { phoneNumber: normalized },
    });

    if (!identity) {
      identity = await this.prisma.numberIdentity.create({
        data: { phoneNumber: normalized },
      });
    }

    return identity;
  }

  // ── STEP 3 & 4: Add Name Contribution ───────────────────────────────

  async addNameContribution(
    phoneNumber: string,
    rawName: string,
    contributorId?: string,
    sourceType: SourceType = SourceType.CONTACT_UPLOAD,
    deviceFingerprint?: string,
  ) {
    const identity = await this.findOrCreateIdentity(phoneNumber);

    // Step 3: Clean the name
    const { cleanedName, isJunk } = cleanName(rawName);
    if (isJunk || !cleanedName) {
      this.logger.debug(`Junk name skipped: "${rawName}"`);
      return null;
    }

    // Step 4: Calculate contributor weight
    let contributorTrustWeight = 1.0;

    if (contributorId) {
      const contributor = await this.prisma.user.findUnique({
        where: { id: contributorId },
      });

      if (contributor) {
        // Verified users get higher weight
        if (contributor.verificationLevel === 'OTP_VERIFIED') contributorTrustWeight += 0.3;
        if (contributor.verificationLevel === 'ID_VERIFIED') contributorTrustWeight += 0.6;

        // Account age bonus (months since creation, max 0.5)
        const ageMonths = (Date.now() - contributor.createdAt.getTime()) / (30 * 24 * 60 * 60 * 1000);
        contributorTrustWeight += Math.min(ageMonths * 0.05, 0.5);

        // Trust score from user profile
        contributorTrustWeight *= contributor.trustScore;

        // Suspicious penalty
        if (contributor.isSuspicious) contributorTrustWeight *= 0.1;
      }
    }

    // Check for duplicate contribution (same contributor, same cleaned name)
    if (contributorId) {
      const existing = await this.prisma.nameContribution.findFirst({
        where: {
          identityId: identity.id,
          contributorId,
          cleanedName,
        },
      });

      if (existing) {
        this.logger.debug(`Duplicate contribution skipped: "${cleanedName}" for ${phoneNumber}`);
        return existing;
      }
    }

    const contribution = await this.prisma.nameContribution.create({
      data: {
        identityId: identity.id,
        contributorId,
        rawName,
        cleanedName,
        sourceType,
        contributorTrustWeight,
        deviceFingerprint,
      },
    });

    // Update source count
    await this.prisma.numberIdentity.update({
      where: { id: identity.id },
      data: {
        sourceCount: { increment: 1 },
      },
    });

    return contribution;
  }

  // ── BULK: Add Name Contributions in Batch ───────────────────────────

  async addNameContributionsBatch(
    contacts: { phoneNumber: string; name: string }[],
    contributorId: string,
    sourceType: SourceType = SourceType.CONTACT_UPLOAD,
    deviceFingerprint?: string,
  ): Promise<{ created: number; skipped: number; junk: number }> {
    if (contacts.length === 0) return { created: 0, skipped: 0, junk: 0 };

    const startTime = Date.now();

    // ── Step 1: Normalize phones & clean names (CPU only, instant) ──
    const cleaned: { phone: string; rawName: string; cleanedName: string }[] = [];
    let junk = 0;

    for (const c of contacts) {
      const phone = this.normalizePhone(c.phoneNumber);
      const { cleanedName, isJunk } = cleanName(c.name);
      if (isJunk || !cleanedName) {
        junk++;
        continue;
      }
      cleaned.push({ phone, rawName: c.name, cleanedName });
    }

    if (cleaned.length === 0) {
      this.logger.log(`Batch: all ${junk} names were junk, nothing to contribute`);
      return { created: 0, skipped: 0, junk };
    }

    // ── Step 2: Get unique phone numbers & fetch existing identities ──
    const uniquePhones = [...new Set(cleaned.map((c) => c.phone))];

    const existingIdentities = await this.prisma.numberIdentity.findMany({
      where: { phoneNumber: { in: uniquePhones } },
      select: { id: true, phoneNumber: true },
    });

    const identityMap = new Map(existingIdentities.map((i) => [i.phoneNumber, i.id]));

    // ── Step 3: Create missing identities in bulk ──
    const missingPhones = uniquePhones.filter((p) => !identityMap.has(p));

    if (missingPhones.length > 0) {
      await this.prisma.numberIdentity.createMany({
        data: missingPhones.map((p) => ({ phoneNumber: p })),
        skipDuplicates: true,
      });

      // Fetch newly created to get their IDs
      const newIdentities = await this.prisma.numberIdentity.findMany({
        where: { phoneNumber: { in: missingPhones } },
        select: { id: true, phoneNumber: true },
      });
      for (const ni of newIdentities) {
        identityMap.set(ni.phoneNumber, ni.id);
      }
    }

    // ── Step 4: Get contributor trust weight ONCE ──
    let contributorTrustWeight = 1.0;

    if (contributorId) {
      const contributor = await this.prisma.user.findUnique({
        where: { id: contributorId },
      });

      if (contributor) {
        if (contributor.verificationLevel === 'OTP_VERIFIED') contributorTrustWeight += 0.3;
        if (contributor.verificationLevel === 'ID_VERIFIED') contributorTrustWeight += 0.6;
        const ageMonths = (Date.now() - contributor.createdAt.getTime()) / (30 * 24 * 60 * 60 * 1000);
        contributorTrustWeight += Math.min(ageMonths * 0.05, 0.5);
        contributorTrustWeight *= contributor.trustScore;
        if (contributor.isSuspicious) contributorTrustWeight *= 0.1;
      }
    }

    // ── Step 5: Find all existing contributions for dedup (single query) ──
    const identityIds = [...new Set([...identityMap.values()])];

    const existingContribs = await this.prisma.nameContribution.findMany({
      where: {
        identityId: { in: identityIds },
        contributorId,
      },
      select: { identityId: true, cleanedName: true },
    });

    // Build a fast dedup set: "identityId::cleanedName"
    const dedupSet = new Set(existingContribs.map((c) => `${c.identityId}::${c.cleanedName}`));

    // ── Step 6: Filter out duplicates, build create payload ──
    const toCreate: {
      identityId: string;
      contributorId: string | null;
      rawName: string;
      cleanedName: string;
      sourceType: SourceType;
      contributorTrustWeight: number;
      deviceFingerprint: string | null;
    }[] = [];

    const identityIdsToIncrement = new Map<string, number>();

    for (const c of cleaned) {
      const identityId = identityMap.get(c.phone);
      if (!identityId) continue;

      const dedupKey = `${identityId}::${c.cleanedName}`;
      if (dedupSet.has(dedupKey)) continue;
      dedupSet.add(dedupKey); // prevent intra-batch duplicates

      toCreate.push({
        identityId,
        contributorId: contributorId || null,
        rawName: c.rawName,
        cleanedName: c.cleanedName,
        sourceType,
        contributorTrustWeight,
        deviceFingerprint: deviceFingerprint || null,
      });

      identityIdsToIncrement.set(identityId, (identityIdsToIncrement.get(identityId) || 0) + 1);
    }

    const skipped = cleaned.length - toCreate.length;

    // ── Step 7: Bulk create contributions ──
    if (toCreate.length > 0) {
      const BULK_SIZE = 500;
      for (let i = 0; i < toCreate.length; i += BULK_SIZE) {
        const chunk = toCreate.slice(i, i + BULK_SIZE);
        await this.prisma.nameContribution.createMany({
          data: chunk,
          skipDuplicates: true,
        });
      }

      // ── Step 8: Batch update source counts using raw query ──
      const updates = [...identityIdsToIncrement.entries()];
      const UPDT_SIZE = 200;
      for (let i = 0; i < updates.length; i += UPDT_SIZE) {
        const batch = updates.slice(i, i + UPDT_SIZE);
        await this.prisma.$transaction(
          batch.map(([id, count]) =>
            this.prisma.numberIdentity.update({
              where: { id },
              data: { sourceCount: { increment: count } },
            }),
          ),
        );
      }
    }

    // ── Step 9: Bulk-resolve names for identities that still have NULL resolvedName ──
    await this.bulkResolveNamesFromContacts(uniquePhones);

    const elapsed = Date.now() - startTime;
    this.logger.log(
      `Batch contributions: ${toCreate.length} created, ${skipped} duplicates skipped, ${junk} junk, ` +
      `${uniquePhones.length} identities — ${elapsed}ms`,
    );

    return { created: toCreate.length, skipped, junk };
  }

  // ── Bulk Resolve Names from UserContacts ──────────────────────────────

  /**
   * For each phone number where resolvedName is still NULL, find the most
   * common name from ALL users' contacts and set it as the resolvedName.
   * This ensures that if ANY user has saved a name for a number, it gets used.
   */
  async bulkResolveNamesFromContacts(phoneNumbers: string[]): Promise<number> {
    if (phoneNumbers.length === 0) return 0;

    // Find identities that still have NULL resolvedName AND no verifiedName
    const unresolvedIdentities = await this.prisma.numberIdentity.findMany({
      where: {
        phoneNumber: { in: phoneNumbers },
        resolvedName: null,
        verifiedName: null,
      },
      select: { id: true, phoneNumber: true },
    });

    if (unresolvedIdentities.length === 0) return 0;

    const unresolvedPhones = unresolvedIdentities.map((i) => i.phoneNumber);
    const phoneToIdMap = new Map(unresolvedIdentities.map((i) => [i.phoneNumber, i.id]));

    // Query all contact names across ALL users for these phone numbers
    // Group by phone_number and name, count occurrences, pick the most common
    const contactNames = await this.prisma.userContact.groupBy({
      by: ['phoneNumber', 'name'],
      where: { phoneNumber: { in: unresolvedPhones } },
      _count: { name: true },
      orderBy: { _count: { name: 'desc' } },
    });

    // Build a map: phoneNumber -> all name variants with counts
    const namesByPhone = new Map<string, { name: string; count: number }[]>();
    for (const row of contactNames) {
      const { cleanedName, isJunk } = cleanName(row.name);
      if (isJunk || !cleanedName) continue;
      const existing = namesByPhone.get(row.phoneNumber) || [];
      existing.push({ name: capitalizeName(cleanedName), count: row._count.name });
      namesByPhone.set(row.phoneNumber, existing);
    }

    if (namesByPhone.size === 0) return 0;

    // For numbers with multiple name variants, try AI resolution
    const bestNameMap = new Map<string, { name: string; count: number }>();

    for (const [phone, variants] of namesByPhone) {
      if (variants.length === 1) {
        // Only one name variant — use it directly
        bestNameMap.set(phone, variants[0]);
      } else if (variants.length >= 2 && this.ollamaService.isReady()) {
        // Multiple variants — try AI to pick/combine the best name
        try {
          const aiVariants = variants.map(v => ({
            name: v.name,
            frequency: v.count,
            trustWeight: v.count * 0.8,
            sources: ['CONTACT_SYNC'],
          }));
          const aiResult = await this.ollamaService.analyzeBestName(phone, aiVariants);
          if (aiResult) {
            const totalCount = variants.reduce((s, v) => s + v.count, 0);
            bestNameMap.set(phone, { name: capitalizeName(aiResult.bestName), count: totalCount });
          } else {
            // Fallback to highest count
            const best = variants.sort((a, b) => b.count - a.count)[0];
            bestNameMap.set(phone, best);
          }
        } catch {
          // Fallback to highest count
          const best = variants.sort((a, b) => b.count - a.count)[0];
          bestNameMap.set(phone, best);
        }
      } else {
        // Multiple variants but no AI — use highest count
        const best = variants.sort((a, b) => b.count - a.count)[0];
        bestNameMap.set(phone, best);
      }
    }

    if (bestNameMap.size === 0) return 0;

    // Batch update identities with resolved names
    const BATCH = 200;
    const entries = [...bestNameMap.entries()];
    let resolved = 0;

    for (let i = 0; i < entries.length; i += BATCH) {
      const batch = entries.slice(i, i + BATCH);
      await this.prisma.$transaction(
        batch
          .filter(([phone]) => phoneToIdMap.has(phone))
          .map(([phone, { name, count }]) =>
            this.prisma.numberIdentity.update({
              where: { id: phoneToIdMap.get(phone)! },
              data: {
                resolvedName: name,
                confidence: Math.min(count * 30, 90), // 1 user=30%, 2=60%, 3+=90%
                lastResolvedAt: new Date(),
              },
            }),
          ),
      );
      resolved += batch.length;
    }

    this.logger.log(`Bulk-resolved ${resolved} names from user contacts`);
    return resolved;
  }

  /**
   * Resolve ALL identities that have NULL resolvedName across the entire DB
   * by checking user_contacts. This is meant for a one-time backfill or cron.
   */
  async resolveAllUnresolvedNames(): Promise<number> {
    const unresolved = await this.prisma.numberIdentity.findMany({
      where: { resolvedName: null, verifiedName: null },
      select: { phoneNumber: true },
    });

    if (unresolved.length === 0) return 0;

    const phones = unresolved.map((i) => i.phoneNumber);
    this.logger.log(`Found ${phones.length} unresolved identities, resolving from contacts...`);
    return this.bulkResolveNamesFromContacts(phones);
  }

  // ── STEP 6: Set Verified Name (self-declared by OTP-verified user) ──

  async setVerifiedName(phoneNumber: string, name: string, verificationLevel: 'OTP_VERIFIED' | 'ID_VERIFIED' = 'OTP_VERIFIED') {
    const identity = await this.findOrCreateIdentity(phoneNumber);
    const { cleanedName } = cleanName(name);

    return this.prisma.numberIdentity.update({
      where: { id: identity.id },
      data: {
        verifiedName: cleanedName || name,
        verificationLevel: verificationLevel,
      },
    });
  }

  // ── STEP 5 & 7: Cluster Names & Resolve Best Name (AI Scoring) ──────

  async resolveIdentity(phoneNumber: string): Promise<IdentityResult> {
    const normalized = this.normalizePhone(phoneNumber);

    // Try both formats
    const phonesToTry = [...new Set([normalized, phoneNumber])];

    let identity = null;
    for (const phone of phonesToTry) {
      identity = await this.prisma.numberIdentity.findUnique({
        where: { phoneNumber: phone },
        include: { contributions: true },
      });
      if (identity) break;
    }

    // No identity found at all
    if (!identity) {
      // Fallback: check UserContact table across ALL users
      const contactName = await this.getBestContactName(phonesToTry);

      if (contactName) {
        // Also create the identity and set the name so future lookups are fast
        const newIdentity = await this.prisma.numberIdentity.upsert({
          where: { phoneNumber: normalized },
          create: {
            phoneNumber: normalized,
            resolvedName: contactName.name,
            confidence: contactName.confidence,
            sourceCount: contactName.count,
            lastResolvedAt: new Date(),
          },
          update: {
            resolvedName: contactName.name,
            confidence: contactName.confidence,
            lastResolvedAt: new Date(),
          },
        });

        return {
          phoneNumber: normalized,
          name: contactName.name,
          confidence: contactName.confidence,
          sourceCount: contactName.count,
          isVerified: false,
        };
      }

      return {
        phoneNumber: normalized,
        name: null,
        confidence: 0,
        sourceCount: 0,
        isVerified: false,
      };
    }

    // ── STEP 6: Check verified profile first ──
    if (identity.verifiedName) {
      return {
        phoneNumber: normalized,
        name: capitalizeName(identity.verifiedName),
        confidence: 100,
        sourceCount: identity.sourceCount,
        isVerified: true,
      };
    }

    // No contributions yet
    if (!identity.contributions || identity.contributions.length === 0) {
      // Check UserContact across ALL users as fallback
      const contactName = await this.getBestContactName(phonesToTry);

      if (contactName) {
        // Save to identity so name persists
        await this.prisma.numberIdentity.update({
          where: { id: identity.id },
          data: {
            resolvedName: contactName.name,
            confidence: contactName.confidence,
            lastResolvedAt: new Date(),
          },
        });
      }

      return {
        phoneNumber: normalized,
        name: contactName?.name ?? null,
        confidence: contactName?.confidence ?? 0,
        sourceCount: contactName?.count ?? 0,
        isVerified: false,
      };
    }

    // ── Gather ALL name sources ──
    // Also fetch names from UserContact table (how other users saved this number)
    const allContactNames = await this.prisma.userContact.groupBy({
      by: ['name'],
      where: { phoneNumber: { in: phonesToTry } },
      _count: { name: true },
      orderBy: { _count: { name: 'desc' } },
      take: 20,
    });

    // Add contact names as virtual contributions for clustering
    const virtualContribs = allContactNames
      .map(row => {
        const { cleanedName, isJunk } = cleanName(row.name);
        if (isJunk || !cleanedName) return null;
        return {
          cleanedName: cleanedName,
          contributorTrustWeight: Math.min(row._count.name * 0.8, 3),
          sourceType: 'CONTACT_SYNC' as const,
          createdAt: new Date(),
        };
      })
      .filter(Boolean) as { cleanedName: string; contributorTrustWeight: number; sourceType: string; createdAt: Date }[];

    const allContribs = [...identity.contributions, ...virtualContribs];

    // ── STEP 5: Cluster similar names ──
    const clusters = this.clusterNames(allContribs);

    // ── STEP 7: AI Score each cluster ──
    const scoredClusters = this.scoreClustersByAI(clusters, allContribs);
    scoredClusters.sort((a, b) => b.aiScore - a.aiScore);

    const winner = scoredClusters[0];
    if (!winner) {
      return {
        phoneNumber: normalized,
        name: null,
        confidence: 0,
        sourceCount: identity.sourceCount,
        isVerified: false,
      };
    }

    // ── STEP 8: Select best name — try Ollama LLM first, fallback to heuristic ──
    let bestName: string;
    let confidence: number;

    const aiResult = await this.resolveNameWithAI(normalized, scoredClusters, allContribs);

    if (aiResult) {
      bestName = capitalizeName(aiResult.bestName);
      confidence = aiResult.confidence;
      this.logger.log(
        `LLM resolved "${bestName}" for ${normalized} (confidence=${confidence}, ` +
        `reason: ${aiResult.reasoning})`,
      );
    } else {
      // Fallback to heuristic
      bestName = this.selectBestNameInCluster(winner);
      const totalAIScore = scoredClusters.reduce((s, c) => s + c.aiScore, 0);
      confidence = totalAIScore > 0
        ? Math.round((winner.aiScore / totalAIScore) * 100)
        : 0;
      this.logger.log(
        `Heuristic resolved "${bestName}" for ${normalized} (confidence=${confidence}, ` +
        `clusters=${scoredClusters.length}, contributions=${identity.contributions.length})`,
      );
    }

    // Update the resolved name in DB
    await this.prisma.numberIdentity.update({
      where: { id: identity.id },
      data: {
        resolvedName: bestName,
        confidence,
        lastResolvedAt: new Date(),
      },
    });

    // Persist clusters
    await this.persistClusters(identity.id, clusters);

    return {
      phoneNumber: normalized,
      name: bestName,
      confidence,
      sourceCount: identity.sourceCount,
      isVerified: false,
    };
  }

  // ── LLM-Powered Name Resolution ────────────────────────────────────

  private async resolveNameWithAI(
    phoneNumber: string,
    scoredClusters: (NameClusterData & { aiScore: number })[],
    contributions: { cleanedName: string; contributorTrustWeight: number; sourceType: string; createdAt: Date }[],
  ) {
    if (!this.ollamaService.isReady()) {
      // Try to reconnect if Ollama wasn't ready at startup
      await this.ollamaService.tryReconnect();
      if (!this.ollamaService.isReady()) return null;
    }
    // Even with 1 cluster, AI can validate or pick the best variant
    if (scoredClusters.length === 0) return null;

    try {
      const nameVariants = scoredClusters.map((cluster) => {
        const clusterContribs = contributions.filter((c) =>
          cluster.variants.some((v) => nameSimilarity(c.cleanedName, v) >= CLUSTER_THRESHOLD),
        );
        const sourceTypes = [...new Set(clusterContribs.map((c) => c.sourceType))];

        return {
          name: capitalizeName(cluster.representativeName),
          frequency: cluster.frequency,
          trustWeight: cluster.totalWeight,
          sources: sourceTypes,
        };
      });

      return await this.ollamaService.analyzeBestName(phoneNumber, nameVariants);
    } catch (err) {
      this.logger.warn(`LLM name resolution failed, falling back to heuristic: ${err.message}`);
      return null;
    }
  }

  // ── Clustering Logic ────────────────────────────────────────────────

  private clusterNames(
    contributions: { cleanedName: string; contributorTrustWeight: number; sourceType?: string; createdAt?: Date }[],
  ): NameClusterData[] {
    const clusters: NameClusterData[] = [];

    for (const contrib of contributions) {
      const name = contrib.cleanedName;
      if (!name) continue;

      let bestCluster: NameClusterData | null = null;
      let bestSim = 0;

      // Find the most similar existing cluster
      for (const cluster of clusters) {
        const sim = nameSimilarity(name, cluster.representativeName);
        if (sim > bestSim && sim >= CLUSTER_THRESHOLD) {
          bestSim = sim;
          bestCluster = cluster;
        }
      }

      if (bestCluster) {
        // Add to existing cluster
        if (!bestCluster.variants.includes(name)) {
          bestCluster.variants.push(name);
        }
        bestCluster.totalWeight += contrib.contributorTrustWeight;
        bestCluster.frequency += 1;
      } else {
        // Create new cluster
        clusters.push({
          representativeName: name,
          variants: [name],
          totalWeight: contrib.contributorTrustWeight,
          frequency: 1,
        });
      }
    }

    return clusters;
  }

  private selectBestNameInCluster(cluster: NameClusterData): string {
    // AI-powered selection: prefer the most "complete" and frequent variant
    let bestName = cluster.representativeName;
    let bestScore = 0;

    for (const variant of cluster.variants) {
      const tokens = variant.split(/\s+/);
      let score = 0;

      // More tokens = more complete name
      score += tokens.length * 2;

      // Longer names are generally better (but not too long)
      const len = variant.length;
      score += Math.min(len / 5, 4);

      // Penalize names that look like abbreviations
      const hasShortTokens = tokens.some((t) => t.length <= 1);
      if (hasShortTokens) score -= 1;

      // Prefer proper capitalizable names (all-caps or all-lower gets small penalty)
      const isProperCase = tokens.every((t) => /^[A-Z][a-z]/.test(t));
      if (isProperCase) score += 1;

      if (score > bestScore) {
        bestScore = score;
        bestName = variant;
      }
    }

    return capitalizeName(bestName);
  }

  // ── AI Scoring Engine ──────────────────────────────────────────────

  /**
   * Scores each cluster using multiple weighted signals to determine
   * the most likely real name for a phone number.
   */
  private scoreClustersByAI(
    clusters: NameClusterData[],
    contributions: { cleanedName: string; contributorTrustWeight: number; sourceType: string; createdAt: Date }[],
  ): (NameClusterData & { aiScore: number })[] {
    const now = Date.now();
    const maxContributions = Math.max(...clusters.map((c) => c.frequency), 1);
    const maxWeight = Math.max(...clusters.map((c) => c.totalWeight), 1);

    return clusters.map((cluster) => {

      // 1. FREQUENCY SCORE — how many people contributed names in this cluster
      const frequencyScore = cluster.frequency / maxContributions;

      // 2. TRUST WEIGHT SCORE — aggregate trust from contributors
      const trustScore = cluster.totalWeight / maxWeight;

      // 3. NAME COMPLETENESS — full names score higher
      const repTokens = cluster.representativeName.split(/\s+/).length;
      const completenessScore = Math.min(repTokens / 3, 1); // 3+ tokens = full score

      // 4. SOURCE DIVERSITY — names from multiple source types are more reliable
      const clusterContribs = contributions.filter((c) =>
        cluster.variants.some((v) => nameSimilarity(c.cleanedName, v) >= CLUSTER_THRESHOLD),
      );
      const sourceTypes = new Set(clusterContribs.map((c) => c.sourceType));
      const diversityScore = Math.min(sourceTypes.size / 3, 1); // 3+ types = full score

      // 5. RECENCY SCORE — newer contributions are more relevant
      const clusterDates = clusterContribs.map((c) => new Date(c.createdAt).getTime());
      const avgAge = clusterDates.length > 0
        ? clusterDates.reduce((s, d) => s + (now - d), 0) / clusterDates.length
        : Infinity;
      const daysSinceAvg = avgAge / (24 * 60 * 60 * 1000);
      const recencyScore = Math.max(0, 1 - daysSinceAvg / 365); // decays over a year

      // 6. CONSISTENCY SCORE — how similar are the variants within the cluster
      let consistencyScore = 1;
      if (cluster.variants.length > 1) {
        let totalSim = 0;
        let pairs = 0;
        for (let i = 0; i < cluster.variants.length; i++) {
          for (let j = i + 1; j < cluster.variants.length; j++) {
            totalSim += nameSimilarity(cluster.variants[i], cluster.variants[j]);
            pairs++;
          }
        }
        consistencyScore = pairs > 0 ? totalSim / pairs : 1;
      }

      // Weighted combination
      const aiScore =
        SCORE_WEIGHTS.frequency * frequencyScore +
        SCORE_WEIGHTS.trustWeight * trustScore +
        SCORE_WEIGHTS.nameCompleteness * completenessScore +
        SCORE_WEIGHTS.sourceDiversity * diversityScore +
        SCORE_WEIGHTS.recency * recencyScore +
        SCORE_WEIGHTS.consistency * consistencyScore;

      return { ...cluster, aiScore };
    });
  }

  private async persistClusters(identityId: string, clusters: NameClusterData[]) {
    // Delete old clusters for this identity
    await this.prisma.nameCluster.deleteMany({ where: { identityId } });

    // Create new clusters
    for (const cluster of clusters) {
      await this.prisma.nameCluster.create({
        data: {
          identityId,
          representativeName: cluster.representativeName,
          variants: cluster.variants,
          totalWeight: cluster.totalWeight,
          frequency: cluster.frequency,
        },
      });
    }
  }

  // ── Check if recalculation is needed ────────────────────────────────

  async needsRecalculation(phoneNumber: string): Promise<boolean> {
    const normalized = this.normalizePhone(phoneNumber);
    const identity = await this.prisma.numberIdentity.findUnique({
      where: { phoneNumber: normalized },
      include: { _count: { select: { contributions: true } } },
    });

    if (!identity) return false;
    if (!identity.lastResolvedAt) return true;

    // Count contributions since last resolution
    const newContribs = await this.prisma.nameContribution.count({
      where: {
        identityId: identity.id,
        createdAt: { gt: identity.lastResolvedAt },
      },
    });

    return newContribs >= RECALC_THRESHOLD;
  }

  // ── Helper: Get best contact name across ALL users ────────────────

  /**
   * Looks up a phone number in ALL users' contacts and returns the most
   * common name. This is the core logic for "if ANY user has saved this
   * number with a name, use that name".
   */
  private async getBestContactName(
    phoneNumbers: string[],
  ): Promise<{ name: string; confidence: number; count: number } | null> {
    const contacts = await this.prisma.userContact.groupBy({
      by: ['name'],
      where: { phoneNumber: { in: phoneNumbers } },
      _count: { name: true },
      orderBy: { _count: { name: 'desc' } },
      take: 5,
    });

    for (const row of contacts) {
      const { cleanedName, isJunk } = cleanName(row.name);
      if (!isJunk && cleanedName) {
        const count = row._count.name;
        return {
          name: capitalizeName(cleanedName),
          confidence: Math.min(count * 30, 90),
          count,
        };
      }
    }

    return null;
  }
}
