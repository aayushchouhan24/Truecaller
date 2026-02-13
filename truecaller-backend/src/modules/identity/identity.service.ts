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

  // ── STEP 5 & 7: Cluster Names & Resolve Best Name ──────────────────

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

    // ── STEP 7: Select winning cluster ──
    let winningCluster: NameClusterData | null = null;
    for (const cluster of clusters) {
      if (!winningCluster || cluster.totalWeight > winningCluster.totalWeight) {
        winningCluster = cluster;
      }
    }

    if (!winningCluster) {
      return {
        phoneNumber: normalized,
        name: null,
        confidence: 0,
        sourceCount: identity.sourceCount,
        isVerified: false,
      };
    }

    // ── STEP 8: Select best name inside cluster ──
    const bestName = this.selectBestNameInCluster(winningCluster);

    // ── STEP 9: Confidence calculation ──
    const totalAllWeights = clusters.reduce((sum, c) => sum + c.totalWeight, 0);
    const confidence =
      totalAllWeights > 0
        ? Math.round((winningCluster.totalWeight / totalAllWeights) * 100)
        : 0;

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
    contributions: { cleanedName: string; contributorTrustWeight: number }[],
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
    // Prefer names with more tokens (full name > first name only)
    // Among those, pick the most frequent variant
    let bestName = cluster.representativeName;
    let bestTokenCount = bestName.split(/\s+/).length;

    for (const variant of cluster.variants) {
      const tokenCount = variant.split(/\s+/).length;
      if (tokenCount > bestTokenCount) {
        bestName = variant;
        bestTokenCount = tokenCount;
      }
    }

    return capitalizeName(bestName);
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
