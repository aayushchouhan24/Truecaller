/**
 * STEPS 8, 9 & 10: Consensus Resolver
 *
 * Step  8 — Select the winning cluster (highest composite score).
 * Step  9 — Generate a human-readable description.
 * Step 10 — Calculate final confidence from four orthogonal factors:
 *           cluster dominance × dataset agreement × token reliability × source trust
 *
 * Output: IdentityProfile { name, confidence, tags, probable_role, description, reasoning }
 */

import type {
  ExtractedContext,
  IdentityProfile,
  PipelineLog,
  ScoredCluster,
} from './types';
import { capitalizeName } from './tokenizer';

// ── Confidence Weights ─────────────────────────────────────────────

const CW_DOMINANCE = 0.25;
const CW_AGREEMENT = 0.35;
const CW_RELIABILITY = 0.20;
const CW_TRUST = 0.20;

// ── Public API ─────────────────────────────────────────────────────

/**
 * Build the final IdentityProfile from scored clusters and mined context.
 *
 * @param scoredClusters  Clusters with composite scores from the scoring engine.
 * @param context         Extracted tags / roles / relationships from the context miner.
 * @param totalEntries    Total cleaned entries fed into the pipeline.
 * @param logs            Pipeline log entries for deterministic reasoning output.
 */
export function resolveIdentity(
  scoredClusters: ScoredCluster[],
  context: ExtractedContext,
  totalEntries: number,
  logs: PipelineLog[],
): IdentityProfile {
  if (scoredClusters.length === 0) {
    return {
      name: 'Unknown',
      confidence: 0,
      tags: context.tags,
      probable_role: context.probableRole,
      description: 'No name data available.',
      reasoning: 'No valid name clusters were formed from the dataset.',
    };
  }

  // ── Step 8: Select winner ──
  const sorted = [...scoredClusters].sort((a, b) => b.score - a.score);
  const winner = sorted[0];
  const runnerUp = sorted.length > 1 ? sorted[1] : null;

  // ── Step 10: Confidence ──
  const clusterDominance = runnerUp
    ? Math.min(
        (winner.score - runnerUp.score) / Math.max(winner.score, 0.01),
        1.0,
      )
    : 0.8; // no competition → reasonably confident

  const datasetAgreement =
    totalEntries > 0
      ? Math.min(winner.frequency / totalEntries, 1.0)
      : 0;

  const tokenReliability = winner.structuralScore;
  const sourceTrust = winner.trustWeight;

  const confidence = clamp01(
    clusterDominance * CW_DOMINANCE +
      datasetAgreement * CW_AGREEMENT +
      tokenReliability * CW_RELIABILITY +
      sourceTrust * CW_TRUST,
  );

  // ── Step 9: Name formatting ──
  const name = capitalizeName(winner.representative);

  // ── Description & reasoning ──
  const description = generateDescription(winner, context, confidence);
  const reasoning = generateReasoning(winner, sorted, context, totalEntries, logs);

  return {
    name,
    confidence: round2(confidence),
    tags: context.tags,
    probable_role: context.probableRole
      ? capitalizeName(context.probableRole)
      : null,
    description,
    reasoning,
  };
}

// ── Description Generator ──────────────────────────────────────────

function generateDescription(
  winner: ScoredCluster,
  context: ExtractedContext,
  confidence: number,
): string {
  const parts: string[] = [];

  const name = capitalizeName(winner.representative);
  parts.push(`Identified as ${name}`);

  if (context.probableRole) {
    parts.push(`likely a ${context.probableRole}`);
  }

  if (confidence >= 0.8) parts.push('with high confidence');
  else if (confidence >= 0.5) parts.push('with moderate confidence');
  else parts.push('with low confidence');

  parts.push(`based on ${winner.frequency} source(s)`);

  return parts.join(', ') + '.';
}

// ── Reasoning Generator ────────────────────────────────────────────

function generateReasoning(
  winner: ScoredCluster,
  allClusters: ScoredCluster[],
  context: ExtractedContext,
  totalEntries: number,
  logs: PipelineLog[],
): string {
  const lines: string[] = [];

  lines.push(
    `Pipeline processed ${totalEntries} entry(ies) into ${allClusters.length} cluster(s).`,
  );
  lines.push(
    `Winning cluster: "${capitalizeName(winner.representative)}" ` +
      `(score: ${winner.score.toFixed(3)})`,
  );
  lines.push(`  Frequency : ${winner.frequency} unique contributor(s)`);
  lines.push(
    `  Variants  : ${winner.variants.length} — ` +
      winner.variants.slice(0, 5).join(', '),
  );
  lines.push(
    `  Signals   : freq=${winner.frequencyWeight.toFixed(2)} ` +
      `trust=${winner.trustWeight.toFixed(2)} ` +
      `struct=${winner.structuralScore.toFixed(2)} ` +
      `unique=${winner.uniquenessScore.toFixed(2)} ` +
      `noise=${winner.noiseScore.toFixed(2)}`,
  );

  if (allClusters.length > 1) {
    const ru = allClusters[1];
    lines.push(
      `Runner-up: "${capitalizeName(ru.representative)}" ` +
        `(score: ${ru.score.toFixed(3)})`,
    );
  }

  if (context.roleTokens.length > 0) {
    lines.push(`Detected roles: ${context.roleTokens.join(', ')}`);
  }
  if (context.relationshipTokens.length > 0) {
    lines.push(
      `Detected relationships: ${context.relationshipTokens.join(', ')}`,
    );
  }
  if (context.descriptorTokens.length > 0) {
    lines.push(
      `Detected descriptors: ${context.descriptorTokens.join(', ')}`,
    );
  }

  // Append last N pipeline steps
  for (const log of logs.slice(-6)) {
    lines.push(`[${log.step}] ${log.detail}`);
  }

  return lines.join('\n');
}

// ── Utilities ──────────────────────────────────────────────────────

function clamp01(v: number): number {
  return Math.max(0, Math.min(v, 1));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
