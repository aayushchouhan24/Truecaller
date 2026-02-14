/**
 * Identity Intelligence Engine — Shared Types
 *
 * No static keyword lists. All classification is probabilistic,
 * derived from dataset-level frequency patterns.
 */

// ── Input Types ────────────────────────────────────────────────────

export interface CrowdEntry {
  savedName: string;
  userId: string;
  timestamp: number;
  country: string;
  trustScore: number;
}

// ── Token Types ────────────────────────────────────────────────────

export type TokenType =
  | 'NAME_LIKELY'
  | 'RELATIONSHIP'
  | 'ROLE'
  | 'ORGANIZATION'
  | 'DESCRIPTOR'
  | 'NOISE';

export interface TokenFeatures {
  token: string;
  length: number;
  alphabetRatio: number;
  numericRatio: number;
  isCapitalized: boolean;
  charPattern: string; // e.g. "CVCVC" for consonant/vowel pattern
}

export interface ClassifiedToken extends TokenFeatures {
  type: TokenType;
  probability: number; // 0-1 confidence in classification
  globalFrequency: number;
  numberCount: number;
  positionFirstPct: number;
  positionLastPct: number;
  soloFrequency: number;
  nameScore: number;
}

export interface TokenStats {
  token: string;
  globalFrequency: number;  // total appearances across all entries
  numberCount: number;       // distinct phone numbers where token appears
  positionFirstPct: number;  // % of times token is first in entry
  positionLastPct: number;   // % of times token is last in entry
  soloFrequency: number;     // times token appears as the entire name
  avgTrustWeight: number;    // average trust weight of contributors
}

// ── Cleaned Entry ──────────────────────────────────────────────────

export interface CleanedEntry {
  raw: string;
  cleaned: string;
  tokens: string[];
  userId: string;
  trustScore: number;
  timestamp: number;
  country: string;
}

// ── Name Candidates ────────────────────────────────────────────────

export interface NameCandidate {
  name: string;
  tokens: ClassifiedToken[];
  sourceEntry: CleanedEntry;
}

// ── Clusters ───────────────────────────────────────────────────────

export interface NameCluster {
  representative: string;
  variants: string[];
  entries: NameCandidate[];
  frequency: number;         // unique userId count
  totalTrustWeight: number;
  userIds: Set<string>;
}

export interface ScoredCluster extends NameCluster {
  score: number;
  frequencyWeight: number;
  trustWeight: number;
  structuralScore: number;
  uniquenessScore: number;
  noiseScore: number;
}

// ── Context ────────────────────────────────────────────────────────

export interface ExtractedContext {
  tags: string[];
  probableRole: string | null;
  relationshipTokens: string[];
  roleTokens: string[];
  descriptorTokens: string[];
}

// ── Final Output ───────────────────────────────────────────────────

export interface IdentityProfile {
  name: string;
  confidence: number;
  tags: string[];
  probable_role: string | null;
  description: string;
  reasoning: string;
}

// ── Pipeline Log ───────────────────────────────────────────────────

export interface PipelineLog {
  step: string;
  detail: string;
  timestamp: number;
}
