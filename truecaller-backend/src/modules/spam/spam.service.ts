import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { OllamaService } from '../ollama/ollama.service';

@Injectable()
export class SpamService {
  private readonly logger = new Logger(SpamService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ollamaService: OllamaService,
  ) {}

  async getSpamScore(phoneNumber: string): Promise<number> {
    const record = await this.prisma.spamScore.findUnique({
      where: { phoneNumber },
    });
    return record?.score ?? 0;
  }

  async reportSpam(reporterId: string, phoneNumber: string, reason?: string) {
    // Create the spam report
    const report = await this.prisma.spamReport.create({
      data: {
        reporterId,
        phoneNumber,
        reason,
      },
    });

    // Increment spam score
    await this.prisma.spamScore.upsert({
      where: { phoneNumber },
      update: { score: { increment: 1 } },
      create: { phoneNumber, score: 1 },
    });

    this.logger.log(`Spam reported for ${phoneNumber} by ${reporterId}`);
    return report;
  }

  async isLikelySpam(phoneNumber: string): Promise<boolean> {
    const score = await this.getSpamScore(phoneNumber);
    const reporters = await this.getUniqueReporterCount(phoneNumber);
    return reporters >= 3 && score > 5;
  }

  /**
   * Count unique reporters for a phone number.
   */
  async getUniqueReporterCount(phoneNumber: string): Promise<number> {
    const reports = await this.prisma.spamReport.findMany({
      where: { phoneNumber },
      select: { reporterId: true },
      distinct: ['reporterId'],
    });
    return reports.length;
  }

  /**
   * Remove a user's spam report and decrement the score.
   */
  async removeSpamReport(
    reporterId: string,
    phoneNumber: string,
  ): Promise<{ removed: boolean; message: string }> {
    // Find user's report(s) for this number
    const reports = await this.prisma.spamReport.findMany({
      where: { reporterId, phoneNumber },
    });

    if (reports.length === 0) {
      return { removed: false, message: 'No spam report found for this number from this user' };
    }

    // Delete the reports
    await this.prisma.spamReport.deleteMany({
      where: { reporterId, phoneNumber },
    });

    // Decrement the spam score
    const currentScore = await this.getSpamScore(phoneNumber);
    const newScore = Math.max(0, currentScore - reports.length);

    if (newScore === 0) {
      await this.prisma.spamScore.deleteMany({
        where: { phoneNumber },
      });
    } else {
      await this.prisma.spamScore.updateMany({
        where: { phoneNumber },
        data: { score: newScore },
      });
    }

    this.logger.log(
      `Spam report removed for ${phoneNumber} by ${reporterId} (score: ${currentScore} → ${newScore})`,
    );

    return { removed: true, message: 'Spam report removed successfully' };
  }

  async getTopSpamNumbers(limit = 20) {
    return this.prisma.spamScore.findMany({
      where: { score: { gt: 0 } },
      orderBy: { score: 'desc' },
      take: limit,
    });
  }

  async getSpamStats() {
    const totalReports = await this.prisma.spamReport.count();
    const flaggedNumbers = await this.prisma.spamScore.count({ where: { score: { gt: 5 } } });
    const blockedNumbers = await this.prisma.spamScore.count({ where: { score: { gt: 20 } } });
    return { totalReports, flaggedNumbers, blockedNumbers };
  }

  async getReportsForNumber(phoneNumber: string) {
    return this.prisma.spamReport.findMany({
      where: { phoneNumber },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  // ── AI-Powered Spam Analysis ────────────────────────────────────────

  /**
   * Run a full AI-powered spam analysis combining reports, call patterns,
   * and name signals. Falls back to heuristic if Ollama is unavailable.
   */
  async analyzeSpamWithAI(phoneNumber: string): Promise<{
    spamScore: number;
    isSpam: boolean;
    category: string;
    reasoning: string;
  }> {
    // 1. Gather all signals
    const [reportData, spamRecord, nameContribs] = await Promise.all([
      this.getSpamSignals(phoneNumber),
      this.prisma.spamScore.findUnique({ where: { phoneNumber } }),
      this.prisma.nameContribution.findMany({
        where: { identity: { phoneNumber } },
        select: { cleanedName: true },
      }),
    ]);

    const nameVariants = [...new Set(nameContribs.map((c) => c.cleanedName).filter(Boolean))];

    // Detect spam-like names
    const spamNameKeywords = ['spam', 'fraud', 'fake', 'scam', 'loan', 'insurance', 'agent', 'block', 'do not pick'];
    const savedAsSpamByCount = nameVariants.filter((n) =>
      spamNameKeywords.some((kw) => n.toLowerCase().includes(kw)),
    ).length;

    // 2. Try AI analysis
    if (this.ollamaService.isReady()) {
      try {
        const aiResult = await this.ollamaService.analyzeSpamPatterns({
          phoneNumber,
          reportCount: reportData.reportCount,
          uniqueReporters: reportData.uniqueReporters,
          avgCallDurationSec: reportData.avgCallDurationSec,
          callsLast24h: reportData.callsLast24h,
          callsLast7d: reportData.callsLast7d,
          shortCallRatio: reportData.shortCallRatio,
          savedAsSpamByCount,
          nameVariants,
        });

        if (aiResult) {
          this.logger.log(
            `AI spam analysis for ${phoneNumber}: score=${aiResult.spamScore}, ` +
            `category=${aiResult.category}, reason=${aiResult.reasoning}`,
          );

          // Update the stored spam score with AI-enhanced value
          const finalScore = Math.round(aiResult.spamScore / 10); // normalize to ~0-10 scale
          await this.prisma.spamScore.upsert({
            where: { phoneNumber },
            update: { score: Math.max(spamRecord?.score ?? 0, finalScore) },
            create: { phoneNumber, score: finalScore },
          });

          return aiResult;
        }
      } catch (err) {
        this.logger.warn(`AI spam analysis failed: ${err.message}`);
      }
    }

    // 3. Fallback to heuristic
    return this.heuristicSpamAnalysis(phoneNumber, reportData, savedAsSpamByCount);
  }

  /**
   * Gather spam signals from database for a phone number.
   */
  private async getSpamSignals(phoneNumber: string) {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [reports, recentReports24h, recentReports7d] = await Promise.all([
      this.prisma.spamReport.findMany({
        where: { phoneNumber },
        select: { reporterId: true, createdAt: true },
      }),
      this.prisma.spamReport.count({
        where: { phoneNumber, createdAt: { gte: oneDayAgo } },
      }),
      this.prisma.spamReport.count({
        where: { phoneNumber, createdAt: { gte: sevenDaysAgo } },
      }),
    ]);

    const uniqueReporters = new Set(reports.map((r) => r.reporterId)).size;

    return {
      reportCount: reports.length,
      uniqueReporters,
      avgCallDurationSec: null as number | null, // extend when call logs exist
      callsLast24h: recentReports24h,
      callsLast7d: recentReports7d,
      shortCallRatio: 0, // extend when call duration data is available
    };
  }

  /**
   * Heuristic fallback when AI is unavailable.
   */
  private heuristicSpamAnalysis(
    phoneNumber: string,
    signals: { reportCount: number; uniqueReporters: number; callsLast24h: number; callsLast7d: number; shortCallRatio: number },
    savedAsSpamByCount: number,
  ) {
    let score = 0;

    // Reports from unique users
    score += Math.min(signals.uniqueReporters * 12, 50);

    // Volume spikes
    if (signals.callsLast24h > 5) score += 15;
    if (signals.callsLast7d > 20) score += 10;

    // Short call ratio
    score += Math.round(signals.shortCallRatio * 20);

    // Spam-named
    score += Math.min(savedAsSpamByCount * 8, 20);

    score = Math.min(score, 100);

    const isSpam = score > 50;
    let category = 'unknown';
    if (score > 70) category = 'scam';
    else if (score > 50) category = 'telemarketer';
    else if (score > 30) category = 'unknown';
    else category = 'legitimate';

    return {
      spamScore: score,
      isSpam,
      category,
      reasoning: `Heuristic: ${signals.uniqueReporters} reporters, ${signals.callsLast7d} calls/7d, ${savedAsSpamByCount} spam-names`,
    };
  }

  // ── AI Number Categorization ────────────────────────────────────────

  async categorizeWithAI(phoneNumber: string, resolvedName: string | null) {
    const [spamRecord, nameContribs] = await Promise.all([
      this.prisma.spamScore.findUnique({ where: { phoneNumber } }),
      this.prisma.nameContribution.findMany({
        where: { identity: { phoneNumber } },
        select: { cleanedName: true },
      }),
    ]);

    const nameVariants = [...new Set(nameContribs.map((c) => c.cleanedName).filter(Boolean))];

    return this.ollamaService.categorizeNumber({
      phoneNumber,
      resolvedName,
      nameVariants,
      spamScore: spamRecord?.score ?? 0,
      callVolume7d: 0, // extend when call log data is available
    });
  }
}
