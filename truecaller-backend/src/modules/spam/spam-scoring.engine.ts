/**
 * Weighted Spam Scoring Engine
 *
 * Computes a 0-100 spam score from multiple weighted signals.
 * All computation happens in the WORKER — never during lookup.
 *
 * Signal weights (must sum to 1.0):
 *   UNIQUE_REPORTERS  0.35  — distinct users who reported the number
 *   REPORT_VELOCITY   0.20  — reports in the last 7 days
 *   NAME_SIGNALS      0.15  — how many users saved the name with spam keywords
 *   RECENCY           0.15  — time decay — recent reports weigh more
 *   AI_SIGNAL         0.15  — Ollama spam analysis (if available)
 *
 * The engine is pure: it takes signals in, returns a score + category.
 * Persistence is done by the caller (worker).
 */

export interface SpamSignals {
  uniqueReporters: number;
  totalReports: number;
  reportsLast7d: number;
  reportsLast24h: number;
  savedAsSpamByCount: number;  // users who saved the name with spam keywords
  totalNameSavers: number;     // total users who saved any name for this number
  newestReportAgeHours: number | null; // hours since most recent report
  aiSpamScore: number | null;  // 0-100 from Ollama, null if unavailable
  aiCategory: string | null;
}

export interface SpamResult {
  score: number;       // 0-100
  isSpam: boolean;     // score > 50
  category: string;    // scam|telemarketer|robocall|unknown|legitimate
  reasoning: string;
}

// ── Weights ───────────────────────────────────────────────────────

const W_REPORTERS = 0.35;
const W_VELOCITY  = 0.20;
const W_NAMES     = 0.15;
const W_RECENCY   = 0.15;
const W_AI        = 0.15;

// ── Thresholds ────────────────────────────────────────────────────

const SPAM_THRESHOLD = 50;        // score > this → isSpam = true
const REPORTER_CAP = 20;          // diminishing returns after 20 reporters
const VELOCITY_CAP = 50;          // 50 reports/week = max velocity signal
const RECENCY_HALFLIFE_HOURS = 72; // half-life decay for recency

// ── Public API ────────────────────────────────────────────────────

export function computeSpamScore(signals: SpamSignals): SpamResult {
  // ── 1. Unique reporters (0-100) ─────────────────────────────────
  const reporterSignal =
    Math.min(signals.uniqueReporters / REPORTER_CAP, 1.0) * 100;

  // ── 2. Report velocity (0-100) ──────────────────────────────────
  const velocitySignal =
    Math.min(signals.reportsLast7d / VELOCITY_CAP, 1.0) * 100;

  // ── 3. Name signals (0-100) ─────────────────────────────────────
  const nameRatio =
    signals.totalNameSavers > 0
      ? signals.savedAsSpamByCount / signals.totalNameSavers
      : 0;
  const nameSignal = Math.min(nameRatio * 2, 1.0) * 100; // 50% spam-named = max signal

  // ── 4. Recency (0-100) ─────────────────────────────────────────
  let recencySignal = 0;
  if (signals.newestReportAgeHours !== null) {
    // Exponential decay: score = 100 × 0.5^(age / halflife)
    recencySignal = 100 * Math.pow(0.5, signals.newestReportAgeHours / RECENCY_HALFLIFE_HOURS);
  }

  // ── 5. AI signal (0-100) ────────────────────────────────────────
  const aiSignal = signals.aiSpamScore ?? 0;

  // ── Composite ──────────────────────────────────────────────────
  const raw =
    reporterSignal * W_REPORTERS +
    velocitySignal * W_VELOCITY +
    nameSignal * W_NAMES +
    recencySignal * W_RECENCY +
    aiSignal * W_AI;

  const score = Math.round(Math.min(Math.max(raw, 0), 100));
  const isSpam = score > SPAM_THRESHOLD;

  // ── Category assignment ────────────────────────────────────────
  let category = signals.aiCategory || 'unknown';
  if (!signals.aiCategory) {
    if (score > 80) category = 'scam';
    else if (score > 60) category = 'telemarketer';
    else if (score > 40) category = 'suspected';
    else category = 'legitimate';
  }

  // ── Reasoning ──────────────────────────────────────────────────
  const parts: string[] = [];
  parts.push(`reporters=${signals.uniqueReporters}(${reporterSignal.toFixed(0)})`);
  parts.push(`velocity=${signals.reportsLast7d}/7d(${velocitySignal.toFixed(0)})`);
  parts.push(`names=${signals.savedAsSpamByCount}/${signals.totalNameSavers}(${nameSignal.toFixed(0)})`);
  if (signals.newestReportAgeHours !== null) {
    parts.push(`recency=${signals.newestReportAgeHours.toFixed(0)}h(${recencySignal.toFixed(0)})`);
  }
  if (signals.aiSpamScore !== null) {
    parts.push(`ai=${signals.aiSpamScore}(${aiSignal.toFixed(0)})`);
  }

  return {
    score,
    isSpam,
    category,
    reasoning: `Weighted: ${parts.join(', ')} → ${score}`,
  };
}
