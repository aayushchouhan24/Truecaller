/**
 * STEP 5: Scoring Engine
 *
 * Assigns a composite score to each name cluster using five weighted signals.
 * All weights are tunable constants — no static keyword lists.
 *
 * Signals:
 *   frequency_weight  — What fraction of unique contributors saved this name?
 *   trust_weight      — Average contributor trust across the cluster.
 *   structural_score  — How well do the cluster's tokens classify as NAME_LIKELY?
 *   uniqueness_score  — Inverse of how generic / ubiquitous the name tokens are.
 *   noise_score       — Fraction of NOISE tokens in the cluster's source entries.
 *
 * Output: ScoredCluster (extends NameCluster with score + per-signal breakdown).
 */

import type {
  ClassifiedToken,
  NameCluster,
  ScoredCluster,
} from './types';

// ── Signal Weights ─────────────────────────────────────────────────

const W_FREQUENCY = 0.30;
const W_TRUST = 0.25;
const W_STRUCTURAL = 0.25;
const W_UNIQUENESS = 0.15;
const W_NOISE = 0.05; // subtracted

// ── Public API ─────────────────────────────────────────────────────

/**
 * Score all clusters and return them as ScoredCluster[].
 *
 * @param clusters          Name clusters from the cluster engine.
 * @param classifiedTokens  Map<token, ClassifiedToken> from the classifier.
 * @param totalContributors Total unique contributors for this phone number.
 */
export function scoreClusters(
  clusters: NameCluster[],
  classifiedTokens: Map<string, ClassifiedToken>,
  totalContributors: number,
): ScoredCluster[] {
  return clusters.map((c) =>
    scoreCluster(c, classifiedTokens, totalContributors),
  );
}

// ── Internal ───────────────────────────────────────────────────────

function scoreCluster(
  cluster: NameCluster,
  classifiedTokens: Map<string, ClassifiedToken>,
  totalContributors: number,
): ScoredCluster {
  // ───────────────────────────────────────────────────────────────
  // 1. Frequency weight (0-1)
  //    What share of all contributors for this number saved this name?
  // ───────────────────────────────────────────────────────────────
  const frequencyWeight =
    totalContributors > 0
      ? Math.min(cluster.frequency / totalContributors, 1.0)
      : 0;

  // ───────────────────────────────────────────────────────────────
  // 2. Trust weight (0-1)
  //    Average contributor trust within this cluster.
  // ───────────────────────────────────────────────────────────────
  const avgTrust =
    cluster.entries.length > 0
      ? cluster.totalTrustWeight / cluster.entries.length
      : 0;
  const trustWeight = Math.min(avgTrust, 1.0);

  // ───────────────────────────────────────────────────────────────
  // 3. Structural score (0-1)
  //    Average nameScore of the representative's tokens, with
  //    a bonus only when multiple NAME_LIKELY tokens are present
  //    (i.e. a proper first + last name combination).
  //    Penalise representatives that contain non-name tokens.
  // ───────────────────────────────────────────────────────────────
  const repTokens = cluster.representative.split(/\s+/);
  let totalNameScore = 0;
  let tokenCount = 0;
  let nameLikelyCount = 0;
  let nonNamePenalty = 0;

  for (const t of repTokens) {
    const classified = classifiedTokens.get(t.toLowerCase());
    if (classified) {
      totalNameScore += classified.nameScore;
      tokenCount++;
      if (classified.type === 'NAME_LIKELY') nameLikelyCount++;
      if (classified.type === 'RELATIONSHIP') nonNamePenalty += 0.15;
      if (classified.type === 'DESCRIPTOR') nonNamePenalty += 0.15;
      if (classified.type === 'ORGANIZATION') nonNamePenalty += 0.10;
    }
  }

  const avgNameScore = tokenCount > 0 ? totalNameScore / tokenCount : 0.5;
  // Completeness bonus: require ≥2 NAME_LIKELY tokens (e.g. first + last)
  const completenessBonus = nameLikelyCount >= 2 ? 0.15 : 0;
  const structuralScore = Math.max(
    0,
    Math.min(avgNameScore + completenessBonus - nonNamePenalty, 1.0),
  );

  // ───────────────────────────────────────────────────────────────
  // 4. Uniqueness score (0-1)
  //    Penalise names whose tokens are classified as ROLE / DESCRIPTOR
  //    (i.e. they appear across many unrelated numbers).
  // ───────────────────────────────────────────────────────────────
  let genericPenalty = 0;
  for (const t of repTokens) {
    const classified = classifiedTokens.get(t.toLowerCase());
    if (!classified) continue;
    if (classified.type === 'ROLE') genericPenalty += 0.3;
    else if (classified.type === 'DESCRIPTOR') genericPenalty += 0.2;
    else if (classified.type === 'ORGANIZATION') genericPenalty += 0.15;
  }
  const uniquenessScore = Math.max(
    0,
    1 - genericPenalty / Math.max(repTokens.length, 1),
  );

  // ───────────────────────────────────────────────────────────────
  // 5. Noise score (0-1)
  //    Fraction of NOISE-classified tokens across all source entries.
  // ───────────────────────────────────────────────────────────────
  let noiseTokenCount = 0;
  let totalTokens = 0;

  for (const entry of cluster.entries) {
    for (const ct of entry.tokens) {
      if (ct.type === 'NOISE') noiseTokenCount++;
      totalTokens++;
    }
  }

  const noiseScore = totalTokens > 0 ? noiseTokenCount / totalTokens : 0;

  // ───────────────────────────────────────────────────────────────
  // Composite score
  // ───────────────────────────────────────────────────────────────
  const score = Math.max(
    0,
    Math.min(
      frequencyWeight * W_FREQUENCY +
        trustWeight * W_TRUST +
        structuralScore * W_STRUCTURAL +
        uniquenessScore * W_UNIQUENESS -
        noiseScore * W_NOISE,
      1.0,
    ),
  );

  return {
    ...cluster,
    score,
    frequencyWeight,
    trustWeight,
    structuralScore,
    uniquenessScore,
    noiseScore,
  };
}
