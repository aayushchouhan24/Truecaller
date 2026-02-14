/**
 * STEPS 3 & 4: Cluster Engine
 *
 * Step 3 — Extract name candidates from classified tokens.
 *   For each cleaned entry, collect consecutive NAME_LIKELY tokens
 *   (or tokens whose nameScore exceeds a threshold) to form candidate names.
 *
 * Step 4 — Cluster candidates using fuzzy string matching.
 *   Combines normalised edit-distance with token-level Jaccard similarity
 *   so that "Rahul Sharma" and "Rahul K Sharma" land in the same cluster.
 */

import type {
  ClassifiedToken,
  CleanedEntry,
  NameCandidate,
  NameCluster,
} from './types';

// ── Thresholds ─────────────────────────────────────────────────────

const NAME_SCORE_FALLBACK = 0.35; // accept token as name-part even if not classified NAME_LIKELY
const CLUSTER_SIMILARITY = 0.55;  // minimum similarity to merge two candidates

// ── Step 3: Name Candidate Extraction ──────────────────────────────

/**
 * Extract name candidates from a set of classified/cleaned entries.
 *
 * For each entry the function walks through its tokens and groups
 * consecutive name-like tokens into a single candidate string.
 * Tokens classified as RELATIONSHIP, DESCRIPTOR, or NOISE are excluded.
 */
export function extractNameCandidates(
  entries: CleanedEntry[],
  classifiedTokens: Map<string, ClassifiedToken>,
): NameCandidate[] {
  const candidates: NameCandidate[] = [];

  for (const entry of entries) {
    const nameTokens: ClassifiedToken[] = [];

    for (const token of entry.tokens) {
      const classified = classifiedTokens.get(token);
      if (!classified) continue;

      // Exclude tokens that are clearly not name parts
      if (
        classified.type === 'RELATIONSHIP' ||
        classified.type === 'DESCRIPTOR' ||
        classified.type === 'NOISE'
      ) {
        continue;
      }

      // Accept the token if it is NAME_LIKELY *or* has a decent nameScore
      if (
        classified.type === 'NAME_LIKELY' ||
        classified.nameScore > NAME_SCORE_FALLBACK
      ) {
        nameTokens.push(classified);
      }
    }

    if (nameTokens.length === 0) continue;

    const name = nameTokens.map((t) => t.token).join(' ');
    candidates.push({ name, tokens: nameTokens, sourceEntry: entry });
  }

  return candidates;
}

// ── Step 4: Fuzzy Clustering ───────────────────────────────────────

/**
 * Cluster name candidates by string similarity.
 *
 * Uses a single-pass greedy algorithm:
 *   1. For each unassigned candidate, start a new cluster.
 *   2. Pull in every other unassigned candidate whose similarity
 *      to the cluster seed is ≥ `CLUSTER_SIMILARITY`.
 *   3. Pick the most complete (longest) variant as the representative.
 */
export function clusterCandidates(
  candidates: NameCandidate[],
  similarityThreshold: number = CLUSTER_SIMILARITY,
): NameCluster[] {
  const clusters: NameCluster[] = [];
  const assigned = new Set<number>();

  for (let i = 0; i < candidates.length; i++) {
    if (assigned.has(i)) continue;

    const seed = candidates[i];
    const cluster: NameCluster = {
      representative: seed.name,
      variants: [seed.name],
      entries: [seed],
      frequency: 1,
      totalTrustWeight: seed.sourceEntry.trustScore,
      userIds: new Set([seed.sourceEntry.userId]),
    };
    assigned.add(i);

    for (let j = i + 1; j < candidates.length; j++) {
      if (assigned.has(j)) continue;

      const sim = nameSimilarity(seed.name, candidates[j].name);
      if (sim >= similarityThreshold) {
        cluster.variants.push(candidates[j].name);
        cluster.entries.push(candidates[j]);

        if (!cluster.userIds.has(candidates[j].sourceEntry.userId)) {
          cluster.userIds.add(candidates[j].sourceEntry.userId);
          cluster.frequency++;
        }
        cluster.totalTrustWeight += candidates[j].sourceEntry.trustScore;
        assigned.add(j);
      }
    }

    // Representative = longest (most complete) variant
    cluster.representative = cluster.variants.reduce(
      (best, v) => (v.length > best.length ? v : best),
      cluster.variants[0],
    );

    // De-duplicate variants
    cluster.variants = [...new Set(cluster.variants)];

    clusters.push(cluster);
  }

  return clusters;
}

// ── Similarity Helpers ─────────────────────────────────────────────

/**
 * Composite name similarity: 40 % normalised edit-distance + 60 % token Jaccard.
 * Also detects token-subset relationships (e.g. "Patel" ⊂ "Harsh Patel").
 */
export function nameSimilarity(a: string, b: string): number {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  if (la === lb) return 1.0;

  const tokA = new Set(la.split(/\s+/));
  const tokB = new Set(lb.split(/\s+/));

  // Token-subset detection:
  // If all tokens of A appear in B (or vice versa), they are the same person.
  // e.g. "patel" ⊂ "harsh patel" → should merge.
  const aSubsetOfB = [...tokA].every((t) => tokB.has(t));
  const bSubsetOfA = [...tokB].every((t) => tokA.has(t));
  if (aSubsetOfB || bSubsetOfA) {
    return 0.85;
  }

  // Normalised edit-distance similarity
  const maxLen = Math.max(la.length, lb.length);
  const editDist = levenshtein(la, lb);
  const editSim = maxLen > 0 ? 1 - editDist / maxLen : 0;

  // Token-level Jaccard
  const intersection = [...tokA].filter((t) => tokB.has(t)).length;
  const union = new Set([...tokA, ...tokB]).size;
  const jaccard = union > 0 ? intersection / union : 0;

  return editSim * 0.4 + jaccard * 0.6;
}

/**
 * Standard Levenshtein edit distance (dynamic programming).
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0),
  );

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  return dp[m][n];
}
