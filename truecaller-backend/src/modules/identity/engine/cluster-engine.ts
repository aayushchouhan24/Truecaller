/**
 * STEPS 3 & 4: Cluster Engine
 *
 * Step 3 — Extract name candidates from classified tokens.
 *   For each cleaned entry, collect consecutive NAME_LIKELY tokens
 *   (or tokens whose nameScore exceeds a threshold) to form candidate names.
 *
 * Step 4 — Cluster candidates using CANONICAL-KEY GROUPING.
 *   ╔══════════════════════════════════════════════════════════════╗
 *   ║  Complexity: O(n log n) — sort tokens → build key → Map    ║
 *   ║  Replaces the old O(n²) pairwise Levenshtein comparison.   ║
 *   ╚══════════════════════════════════════════════════════════════╝
 *
 *   For each candidate:
 *     1. Normalise & lowercase
 *     2. Split into tokens
 *     3. Sort tokens alphabetically
 *     4. Join as canonical key  (e.g. "patel rahul" ← "Rahul Patel")
 *     5. Group by key using a Map (O(1) per insert)
 *
 *   Additionally, single-token candidates are merged into any
 *   multi-token cluster that contains them (subset detection).
 *
 *   Total: O(n × k log k) where k = avg tokens per name (usually ≤ 3).
 */

import type {
  ClassifiedToken,
  CleanedEntry,
  NameCandidate,
  NameCluster,
} from './types';

// ── Thresholds ─────────────────────────────────────────────────────

const NAME_SCORE_FALLBACK = 0.35; // accept token as name-part even if not classified NAME_LIKELY

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

// ── Step 4: O(n log n) Canonical-Key Clustering ────────────────────

/**
 * Build a canonical key for a name by sorting its tokens alphabetically.
 *
 *   "Rahul K Sharma" → ["k", "rahul", "sharma"] → "k rahul sharma"
 *   "Sharma Rahul"   → ["rahul", "sharma"]       → "rahul sharma"
 *
 * This guarantees that name variants with the same tokens (in any order)
 * land in the same cluster with zero string-distance computation.
 */
function canonicalKey(name: string): string {
  return name
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0)
    .sort()
    .join(' ');
}

/**
 * Cluster name candidates using canonical-key grouping + subset merging.
 *
 * Phase 1: Group by canonical key  — O(n)
 * Phase 2: Sort clusters by token count desc, merge single-token subsets — O(c × k)
 *          where c = cluster count (usually ≪ n) and k = avg tokens
 *
 * Total: O(n × k log k)  ≈  O(n log n) for constant k.
 */
export function clusterCandidates(candidates: NameCandidate[]): NameCluster[] {
  if (candidates.length === 0) return [];

  // ── Phase 1: Group by canonical key ─────────────────────────────

  const keyMap = new Map<
    string,
    {
      variants: string[];
      entries: NameCandidate[];
      userIds: Set<string>;
      totalTrustWeight: number;
    }
  >();

  for (const cand of candidates) {
    const key = canonicalKey(cand.name);
    let group = keyMap.get(key);
    if (!group) {
      group = {
        variants: [],
        entries: [],
        userIds: new Set(),
        totalTrustWeight: 0,
      };
      keyMap.set(key, group);
    }
    group.variants.push(cand.name);
    group.entries.push(cand);
    group.userIds.add(cand.sourceEntry.userId);
    group.totalTrustWeight += cand.sourceEntry.trustScore;
  }

  // ── Phase 2: Convert groups to clusters ─────────────────────────

  const clusters: NameCluster[] = [];
  const mergedKeys = new Set<string>();

  // Sort by token count descending so multi-token clusters come first
  const sortedKeys = [...keyMap.keys()].sort(
    (a, b) => b.split(' ').length - a.split(' ').length,
  );

  // Build a Set of all tokens per multi-token key for subset detection
  const multiTokenSets = new Map<string, Set<string>>();
  for (const key of sortedKeys) {
    const tokens = key.split(' ');
    if (tokens.length > 1) {
      multiTokenSets.set(key, new Set(tokens));
    }
  }

  for (const key of sortedKeys) {
    if (mergedKeys.has(key)) continue;

    const group = keyMap.get(key)!;
    const keyTokens = key.split(' ');

    // If this is a single-token key, check if it's a subset of any multi-token cluster
    if (keyTokens.length === 1) {
      let merged = false;
      for (const [mKey, mTokenSet] of multiTokenSets) {
        if (mergedKeys.has(mKey)) continue;
        if (mTokenSet.has(keyTokens[0])) {
          // Merge into the parent cluster's group
          const parent = keyMap.get(mKey)!;
          for (const entry of group.entries) {
            parent.entries.push(entry);
            parent.userIds.add(entry.sourceEntry.userId);
            parent.totalTrustWeight += entry.sourceEntry.trustScore;
          }
          parent.variants.push(...group.variants);
          mergedKeys.add(key);
          merged = true;
          break;
        }
      }
      if (merged) continue;
    }

    // Build the cluster
    const cluster: NameCluster = {
      representative: '',
      variants: [...new Set(group.variants)],
      entries: group.entries,
      frequency: group.userIds.size,
      totalTrustWeight: group.totalTrustWeight,
      userIds: group.userIds,
    };

    // Representative = longest (most complete) variant
    cluster.representative = cluster.variants.reduce(
      (best, v) => (v.length > best.length ? v : best),
      cluster.variants[0],
    );

    clusters.push(cluster);
  }

  return clusters;
}

// ── Name Similarity (kept for external consumers / tests) ──────────

/**
 * Composite name similarity: 40% normalised edit-distance + 60% token Jaccard.
 * Also detects token-subset relationships (e.g. "Patel" ⊂ "Harsh Patel").
 *
 * NOTE: This is NOT used by the cluster engine anymore (O(n²) path removed).
 * Kept as a utility for scoring/validation.
 */
export function nameSimilarity(a: string, b: string): number {
  const la = a.toLowerCase();
  const lb = b.toLowerCase();
  if (la === lb) return 1.0;

  const tokA = new Set(la.split(/\s+/));
  const tokB = new Set(lb.split(/\s+/));

  const aSubsetOfB = [...tokA].every((t) => tokB.has(t));
  const bSubsetOfA = [...tokB].every((t) => tokA.has(t));
  if (aSubsetOfB || bSubsetOfA) return 0.85;

  const maxLen = Math.max(la.length, lb.length);
  const editDist = levenshtein(la, lb);
  const editSim = maxLen > 0 ? 1 - editDist / maxLen : 0;

  const intersection = [...tokA].filter((t) => tokB.has(t)).length;
  const union = new Set([...tokA, ...tokB]).size;
  const jaccard = union > 0 ? intersection / union : 0;

  return editSim * 0.4 + jaccard * 0.6;
}

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
