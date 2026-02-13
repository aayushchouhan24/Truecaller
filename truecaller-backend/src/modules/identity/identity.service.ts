import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { SourceType } from '@prisma/client';

export interface IdentityResult {
  phoneNumber: string;
  bestName: string | null;
  confidenceScore: number;
  names: { name: string; weight: number; sourceType: string }[];
}

@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Normalize phone number to +91XXXXXXXXXX format */
  normalizePhone(phone: string): string {
    let c = phone.replace(/[\s\-()]/g, '');
    if (/^\d{10}$/.test(c)) c = '+91' + c;
    else if (c.startsWith('91') && c.length === 12) c = '+' + c;
    else if (c.startsWith('091') && c.length === 13) c = '+' + c.slice(1);
    else if (!c.startsWith('+') && c.length > 5) c = '+' + c;
    return c;
  }

  async findOrCreateIdentity(phoneNumber: string) {
    let identity = await this.prisma.numberIdentity.findFirst({
      where: { phoneNumber },
      include: { nameSignals: true },
    });

    if (!identity) {
      identity = await this.prisma.numberIdentity.create({
        data: { phoneNumber },
        include: { nameSignals: true },
      });
    }

    return identity;
  }

  async computeIdentity(phoneNumber: string): Promise<IdentityResult> {
    const normalized = this.normalizePhone(phoneNumber);

    // Try both original and normalized formats
    const phonesToTry = [...new Set([normalized, phoneNumber])];

    let identity = null;
    for (const phone of phonesToTry) {
      identity = await this.prisma.numberIdentity.findFirst({
        where: { phoneNumber: phone },
        include: {
          nameSignals: {
            orderBy: { weight: 'desc' },
          },
        },
      });
      if (identity && identity.nameSignals.length > 0) break;
    }

    // Fallback: check UserContact table for any user who has this number saved
    if (!identity || identity.nameSignals.length === 0) {
      const userContact = await this.prisma.userContact.findFirst({
        where: { phoneNumber: { in: phonesToTry } },
        orderBy: { updatedAt: 'desc' },
      });

      if (userContact) {
        return {
          phoneNumber,
          bestName: userContact.name,
          confidenceScore: 80,
          names: [{ name: userContact.name, weight: 0.8, sourceType: 'USER_UPLOAD' }],
        };
      }

      return {
        phoneNumber,
        bestName: null,
        confidenceScore: 0,
        names: [],
      };
    }

    // Aggregate signals: group by name, sum weighted scores
    const nameScores = new Map<string, number>();
    let totalWeight = 0;

    for (const signal of identity.nameSignals) {
      const current = nameScores.get(signal.name) || 0;
      nameScores.set(signal.name, current + signal.weight);
      totalWeight += signal.weight;
    }

    // Find the best name (highest weighted score)
    let bestName = '';
    let bestScore = 0;
    for (const [name, score] of nameScores) {
      if (score > bestScore) {
        bestName = name;
        bestScore = score;
      }
    }

    // Confidence = best name's weighted score / total weight
    const confidenceScore =
      totalWeight > 0 ? Math.round((bestScore / totalWeight) * 100) : 0;

    return {
      phoneNumber,
      bestName,
      confidenceScore,
      names: identity.nameSignals.map((s) => ({
        name: s.name,
        weight: s.weight,
        sourceType: s.sourceType,
      })),
    };
  }

  async addNameSignal(
    phoneNumber: string,
    name: string,
    sourceType: SourceType = SourceType.MANUAL,
    weight: number = 1.0,
  ) {
    const identity = await this.findOrCreateIdentity(phoneNumber);

    return this.prisma.nameSignal.create({
      data: {
        identityId: identity.id,
        name,
        sourceType,
        weight,
      },
    });
  }
}
