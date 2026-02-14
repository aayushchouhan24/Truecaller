/**
 * STEP 2: Token Classifier
 *
 * Probabilistic token classification using dataset-level frequency patterns.
 * NO static keyword lists. Every decision is derived from global token statistics.
 *
 * Classification types:
 *   NAME_LIKELY   — Token behaves like a personal name (moderate spread, first-position dominant)
 *   RELATIONSHIP  — Token used by few numbers, high solo-frequency ("Papa", "Mom")
 *   ROLE          — Token appears across many unrelated numbers ("Doctor", "Plumber")
 *   ORGANIZATION  — Longer token, moderate spread, co-occurs with identifiers
 *   DESCRIPTOR    — Modifier token, often last position ("New", "Old", "Work")
 *   NOISE         — Numeric, very short, or random character sequences
 */

import type { ClassifiedToken, CleanedEntry, TokenFeatures, TokenStats, TokenType } from './types';
import { extractTokenFeatures } from './tokenizer';
import {
  isFirstName,
  isLastName,
  isMiddleName,
  isPrefix,
  isRelationshipTerm,
  isDescriptorTerm,
} from './name-data';

// ── Constants (thresholds, not keyword lists) ──────────────────────

const NUMERIC_NOISE_THRESHOLD = 0.5;
const SHORT_TOKEN_LENGTH = 2;
const LONG_TOKEN_LENGTH = 15;
const ALTERNATION_MIN = 3;

// ── Helpers ────────────────────────────────────────────────────────

function countAlternations(pattern: string): number {
  let count = 0;
  for (let i = 1; i < pattern.length; i++) {
    if (pattern[i] !== pattern[i - 1]) count++;
  }
  return count;
}

// ── Single-Token Classification ────────────────────────────────────

/**
 * Classify a single token based on its intrinsic features + global statistics.
 * Returns classification with probability (confidence in the assigned type).
 */
export function classifyToken(
  features: TokenFeatures,
  globalStats: TokenStats | undefined,
  totalNumbersInDataset: number,
): ClassifiedToken {
  const scores: Record<TokenType, number> = {
    NAME_LIKELY: 0,
    RELATIONSHIP: 0,
    ROLE: 0,
    ORGANIZATION: 0,
    DESCRIPTOR: 0,
    NOISE: 0,
  };

  // ═══════════════════════════════════════════════════════════════════
  // A. Intrinsic features (character-level, no data needed)
  // ═══════════════════════════════════════════════════════════════════

  // Heavy numeric content → NOISE
  if (features.numericRatio > NUMERIC_NOISE_THRESHOLD) scores.NOISE += 0.6;
  if (features.numericRatio > 0.8) scores.NOISE += 0.3;

  // Very short tokens (1-2 chars) → NOISE or DESCRIPTOR
  if (features.length <= SHORT_TOKEN_LENGTH) {
    scores.NOISE += 0.3;
    scores.DESCRIPTOR += 0.15;
  }

  // Abnormally long → could be org name or garbage
  if (features.length > LONG_TOKEN_LENGTH) {
    scores.ORGANIZATION += 0.1;
    scores.NOISE += 0.1;
  }

  // High alphabet ratio → favours NAME / ROLE
  if (features.alphabetRatio > 0.9) {
    scores.NAME_LIKELY += 0.15;
    scores.ROLE += 0.05;
  }

  // Capitalised in source → mild name bias
  if (features.isCapitalized) {
    scores.NAME_LIKELY += 0.05;
  }

  // Consonant-vowel alternation → natural human name pattern
  const alternations = countAlternations(features.charPattern);
  if (alternations >= ALTERNATION_MIN && features.length >= 3) {
    scores.NAME_LIKELY += 0.1;
  }

  // ═══════════════════════════════════════════════════════════════════
  // A2. Name reference data signals (probabilistic boosters)
  // ═══════════════════════════════════════════════════════════════════

  const lowerToken = features.token.toLowerCase();

  // Known first name → strong NAME_LIKELY boost
  if (isFirstName(lowerToken)) {
    scores.NAME_LIKELY += 0.45;
  }

  // Known last name → NAME_LIKELY boost
  if (isLastName(lowerToken)) {
    scores.NAME_LIKELY += 0.35;
  }

  // Known middle name → mild NAME_LIKELY boost
  if (isMiddleName(lowerToken)) {
    scores.NAME_LIKELY += 0.20;
  }

  // Known prefix/title → not a name part, boost DESCRIPTOR
  if (isPrefix(lowerToken)) {
    scores.DESCRIPTOR += 0.30;
    scores.NOISE += 0.10;
  }

  // Known relationship term → strong RELATIONSHIP boost, penalise NAME_LIKELY
  if (isRelationshipTerm(lowerToken)) {
    scores.RELATIONSHIP += 0.55;
    scores.NAME_LIKELY = Math.max(0, scores.NAME_LIKELY - 0.25);
  }

  // Known descriptor term → strong DESCRIPTOR boost, penalise NAME_LIKELY
  if (isDescriptorTerm(lowerToken)) {
    scores.DESCRIPTOR += 0.55;
    scores.NAME_LIKELY = Math.max(0, scores.NAME_LIKELY - 0.25);
  }

  // ═══════════════════════════════════════════════════════════════════
  // B. Statistical features (dataset-driven)
  // ═══════════════════════════════════════════════════════════════════

  if (globalStats && totalNumbersInDataset > 0) {
    const {
      globalFrequency,
      numberCount,
      positionFirstPct,
      positionLastPct,
      soloFrequency,
      avgTrustWeight,
    } = globalStats;

    // Number penetration: fraction of all phone numbers containing this token
    const penetration = numberCount / totalNumbersInDataset;

    // Solo ratio: how often is this token the ENTIRE saved name?
    const soloRatio = globalFrequency > 0 ? soloFrequency / globalFrequency : 0;

    // ── NAME_LIKELY ──
    // Moderate penetration (not generic, not unique to one number)
    // First-position dominant
    // Rarely saved alone (names usually have first + last)
    if (penetration > 0.001 && penetration < 0.05) {
      scores.NAME_LIKELY += 0.25;
    } else if (penetration >= 0.05 && penetration < 0.10) {
      // Common first names (like "Raj") can still be names at higher penetration
      scores.NAME_LIKELY += 0.10;
    }
    if (positionFirstPct > 0.6) scores.NAME_LIKELY += 0.20;
    if (positionFirstPct > 0.8) scores.NAME_LIKELY += 0.10;
    if (soloRatio < 0.3) scores.NAME_LIKELY += 0.10;

    // Trust signal: contributors with high trust use this as a name
    if (avgTrustWeight > 0.7) scores.NAME_LIKELY += 0.05;

    // ── ROLE ──
    // Very high penetration: the token appears across MANY different numbers
    // Often occupies last position (e.g. "Doctor Sharma" → "doctor" is role)
    if (penetration > 0.05) scores.ROLE += 0.25;
    if (penetration > 0.10) scores.ROLE += 0.20;
    if (penetration > 0.20) scores.ROLE += 0.10;
    if (positionLastPct > 0.5 && penetration > 0.02) scores.ROLE += 0.15;

    // ── RELATIONSHIP ──
    // Very few numbers (1-5), but high solo frequency
    // "Papa", "Mom" etc. — people save just one word for close contacts
    if (numberCount <= 5 && soloRatio > 0.5) scores.RELATIONSHIP += 0.40;
    if (numberCount <= 3 && soloRatio > 0.3) scores.RELATIONSHIP += 0.20;
    if (numberCount === 1 && soloFrequency > 0) scores.RELATIONSHIP += 0.10;

    // ── DESCRIPTOR ──
    // Moderate penetration, last-position dominant, not the only token
    if (penetration > 0.02 && penetration < 0.15 && positionLastPct > 0.4) {
      scores.DESCRIPTOR += 0.30;
    }
    if (soloRatio < 0.1 && positionLastPct > 0.6) {
      scores.DESCRIPTOR += 0.10;
    }

    // ── ORGANIZATION ──
    // Longer tokens at moderate penetration, not usually first
    if (features.length > 6 && penetration > 0.01 && penetration < 0.08) {
      scores.ORGANIZATION += 0.15;
    }
    if (features.length > 8 && positionFirstPct < 0.3 && penetration > 0.005) {
      scores.ORGANIZATION += 0.10;
    }

    // ── NOISE ──
    // Very rare globally AND short → random fragments
    if (globalFrequency <= 2 && features.length <= 3) scores.NOISE += 0.30;
    // Extremely rare with no pattern
    if (globalFrequency === 1 && features.alphabetRatio < 0.5) scores.NOISE += 0.20;
  } else {
    // ── Fallback: no global stats available, classify by features alone ──
    if (features.alphabetRatio > 0.8 && features.length >= 3) {
      scores.NAME_LIKELY += 0.30;
    }
    if (features.length <= SHORT_TOKEN_LENGTH || features.numericRatio > NUMERIC_NOISE_THRESHOLD) {
      scores.NOISE += 0.30;
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // C. Select highest-scoring type & normalise probability
  // ═══════════════════════════════════════════════════════════════════

  let bestType: TokenType = 'NAME_LIKELY';
  let bestScore = -1;
  let totalScore = 0;

  for (const [type, score] of Object.entries(scores) as [TokenType, number][]) {
    totalScore += score;
    if (score > bestScore) {
      bestScore = score;
      bestType = type;
    }
  }

  const probability = totalScore > 0 ? bestScore / totalScore : 0.5;
  const nameScore = totalScore > 0 ? scores.NAME_LIKELY / totalScore : 0.5;

  return {
    ...features,
    type: bestType,
    probability,
    globalFrequency: globalStats?.globalFrequency ?? 0,
    numberCount: globalStats?.numberCount ?? 0,
    positionFirstPct: globalStats?.positionFirstPct ?? 0,
    positionLastPct: globalStats?.positionLastPct ?? 0,
    soloFrequency: globalStats?.soloFrequency ?? 0,
    nameScore,
  };
}

// ── Batch Classification ───────────────────────────────────────────

/**
 * Classify every unique token across all cleaned entries for a phone number.
 * Returns a Map<token, ClassifiedToken> for downstream modules.
 */
export function classifyEntryTokens(
  entries: CleanedEntry[],
  globalStatsMap: Map<string, TokenStats>,
  totalNumbersInDataset: number,
): Map<string, ClassifiedToken> {
  const classified = new Map<string, ClassifiedToken>();

  for (const entry of entries) {
    for (const token of entry.tokens) {
      if (classified.has(token)) continue;

      const features = extractTokenFeatures(token);
      const globalStats = globalStatsMap.get(token);
      classified.set(
        token,
        classifyToken(features, globalStats, totalNumbersInDataset),
      );
    }
  }

  return classified;
}

// ── Global Stats Builder ───────────────────────────────────────────

/**
 * Build global token statistics from a batch of entries across ALL phone numbers.
 * Called by the service layer during periodic stats refresh.
 *
 * @param entriesWithPhone Each entry tagged with the phone number it belongs to.
 * @returns Map<token, TokenStats> ready to persist to TokenStatistic table.
 */
export function buildGlobalTokenStats(
  entriesWithPhone: Array<{ phoneNumber: string; entry: CleanedEntry }>,
): Map<string, TokenStats> {
  const statsMap = new Map<
    string,
    {
      globalFrequency: number;
      numberSet: Set<string>;
      positionFirstCount: number;
      positionLastCount: number;
      soloCount: number;
      totalTrustWeight: number;
      trustCount: number;
    }
  >();

  for (const { phoneNumber, entry } of entriesWithPhone) {
    const { tokens, trustScore } = entry;

    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];

      let stat = statsMap.get(token);
      if (!stat) {
        stat = {
          globalFrequency: 0,
          numberSet: new Set(),
          positionFirstCount: 0,
          positionLastCount: 0,
          soloCount: 0,
          totalTrustWeight: 0,
          trustCount: 0,
        };
        statsMap.set(token, stat);
      }

      stat.globalFrequency++;
      stat.numberSet.add(phoneNumber);
      if (i === 0) stat.positionFirstCount++;
      if (i === tokens.length - 1) stat.positionLastCount++;
      if (tokens.length === 1) stat.soloCount++;
      stat.totalTrustWeight += trustScore;
      stat.trustCount++;
    }
  }

  // Convert to TokenStats
  const result = new Map<string, TokenStats>();

  for (const [token, stat] of statsMap) {
    result.set(token, {
      token,
      globalFrequency: stat.globalFrequency,
      numberCount: stat.numberSet.size,
      positionFirstPct:
        stat.globalFrequency > 0
          ? stat.positionFirstCount / stat.globalFrequency
          : 0,
      positionLastPct:
        stat.globalFrequency > 0
          ? stat.positionLastCount / stat.globalFrequency
          : 0,
      soloFrequency: stat.soloCount,
      avgTrustWeight:
        stat.trustCount > 0 ? stat.totalTrustWeight / stat.trustCount : 0,
    });
  }

  return result;
}
