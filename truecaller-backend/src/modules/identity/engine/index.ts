/**
 * Identity Intelligence Engine — Barrel Exports
 */

// Types
export type {
  CrowdEntry,
  TokenType,
  TokenFeatures,
  ClassifiedToken,
  TokenStats,
  CleanedEntry,
  NameCandidate,
  NameCluster,
  ScoredCluster,
  ExtractedContext,
  IdentityProfile,
  PipelineLog,
} from './types';

// Step 1: Tokenizer
export {
  normalizeEntry,
  normalizeEntries,
  extractTokenFeatures,
  capitalizeName,
} from './tokenizer';

// Step 2: Token Classifier
export {
  classifyToken,
  classifyEntryTokens,
  buildGlobalTokenStats,
} from './token-classifier';

// Name Reference Data
export {
  isFirstName,
  isLastName,
  isMiddleName,
  isPrefix,
  isRelationshipTerm,
  isDescriptorTerm,
  isKnownNamePart,
  isNonNameTerm,
  loadFromDatabase,
  isLoaded,
  getRefCounts,
  getSeedEntries,
  learnToken,
} from './name-data';

// Steps 3 & 4: Cluster Engine
export {
  extractNameCandidates,
  clusterCandidates,
  nameSimilarity,
} from './cluster-engine';

// Step 5: Scoring Engine
export { scoreClusters } from './scoring-engine';

// Steps 6 & 7: Context Miner
export { mineContext } from './context-miner';

// Steps 8, 9 & 10: Consensus Resolver
export { resolveIdentity } from './consensus-resolver';
