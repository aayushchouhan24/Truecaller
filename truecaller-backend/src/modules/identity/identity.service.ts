import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
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

  constructor(private readonly prisma: PrismaService) {}

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

    const elapsed = Date.now() - startTime;
    this.logger.log(
      `Batch contributions: ${toCreate.length} created, ${skipped} duplicates skipped, ${junk} junk, ` +
      `${uniquePhones.length} identities — ${elapsed}ms`,
    );

    return { created: toCreate.length, skipped, junk };
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
      // Fallback: check UserContact table
      const contact = await this.prisma.userContact.findFirst({
        where: { phoneNumber: { in: phonesToTry } },
        orderBy: { updatedAt: 'desc' },
      });

      if (contact) {
        const { cleanedName } = cleanName(contact.name);
        return {
          phoneNumber: normalized,
          name: capitalizeName(cleanedName || contact.name),
          confidence: 50,
          sourceCount: 1,
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
      // Check UserContact as fallback
      const contact = await this.prisma.userContact.findFirst({
        where: { phoneNumber: { in: phonesToTry } },
        orderBy: { updatedAt: 'desc' },
      });

      return {
        phoneNumber: normalized,
        name: contact ? capitalizeName(cleanName(contact.name).cleanedName || contact.name) : null,
        confidence: contact ? 50 : 0,
        sourceCount: contact ? 1 : 0,
        isVerified: false,
      };
    }

    // ── STEP 5: Cluster similar names ──
    const clusters = this.clusterNames(identity.contributions);

    // ── STEP 7: AI Score each cluster ──
    const scoredClusters = this.scoreClustersByAI(clusters, identity.contributions);
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

    // ── STEP 8: Select best name inside winning cluster ──
    const bestName = this.selectBestNameInCluster(winner);

    // ── STEP 9: Confidence = weighted AI score (0-100) ──
    const totalAIScore = scoredClusters.reduce((s, c) => s + c.aiScore, 0);
    const confidence = totalAIScore > 0
      ? Math.round((winner.aiScore / totalAIScore) * 100)
      : 0;

    this.logger.log(
      `AI resolved "${bestName}" for ${normalized} (confidence=${confidence}, ` +
      `clusters=${scoredClusters.length}, contributions=${identity.contributions.length})`,
    );

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
}
