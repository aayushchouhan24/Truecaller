/**
 * STEP 1: Tokenizer Module
 *
 * Normalizes raw saved names into cleaned tokens with extracted features.
 * Removes emojis, punctuation blocks, bracket text, collapses whitespace.
 * Stores both raw and cleaned versions.
 *
 * No static keyword lists. Pure character-level preprocessing.
 */

import type { CrowdEntry, CleanedEntry, TokenFeatures } from './types';

// ── Regex patterns (character-level, not semantic) ─────────────────

const EMOJI_RE = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}\u{FE0F}]/gu;
const BRACKET_RE = /\[.*?\]|\(.*?\)|\{.*?\}/g;
const PUNCTUATION_BLOCK_RE = /[!@#$%^&*=_~`|\\<>/]{2,}/g;
const SPECIAL_CHARS_RE = /[^a-zA-Z\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F\s.\-']/g;

const VOWELS = new Set('aeiouAEIOU');

/**
 * Clean a raw name string into normalized form.
 * Returns both raw and cleaned versions + token list.
 */
export function normalizeEntry(entry: CrowdEntry): CleanedEntry | null {
  const raw = entry.savedName;
  if (!raw || raw.trim().length === 0) return null;

  let cleaned = raw;

  // Step 1: Remove emojis
  cleaned = cleaned.replace(EMOJI_RE, '');

  // Step 2: Remove bracketed text [spam] (work) {label}
  cleaned = cleaned.replace(BRACKET_RE, '');

  // Step 3: Remove punctuation blocks (===, ---, ***)
  cleaned = cleaned.replace(PUNCTUATION_BLOCK_RE, ' ');

  // Step 4: Remove special characters (keep letters, Indic scripts, spaces, dots, hyphens, apostrophes)
  cleaned = cleaned.replace(SPECIAL_CHARS_RE, ' ');

  // Step 5: Collapse whitespace
  cleaned = cleaned.replace(/\s+/g, ' ').trim();

  if (cleaned.length === 0) return null;

  // Step 6: Split into tokens
  const tokens = cleaned
    .split(/\s+/)
    .filter(t => t.length > 0)
    .map(t => t.replace(/^[.\-']+|[.\-']+$/g, '')) // trim leading/trailing punctuation
    .filter(t => t.length > 0);

  if (tokens.length === 0) return null;

  return {
    raw,
    cleaned,
    tokens: tokens.map(t => t.toLowerCase()),
    userId: entry.userId,
    trustScore: entry.trustScore,
    timestamp: entry.timestamp,
    country: entry.country,
  };
}

/**
 * Extract character-level features for a single token.
 * These features are used by the classifier to determine token type probabilistically.
 */
export function extractTokenFeatures(token: string): TokenFeatures {
  const lower = token.toLowerCase();
  const len = lower.length;

  let alphaCount = 0;
  let numericCount = 0;

  for (const ch of lower) {
    if (/[a-z\u0900-\u0D7F]/.test(ch)) alphaCount++;
    else if (/\d/.test(ch)) numericCount++;
  }

  // Build consonant/vowel pattern (for latin characters)
  let charPattern = '';
  for (const ch of lower.slice(0, 8)) { // cap at 8 chars
    if (/\d/.test(ch)) charPattern += 'D';
    else if (VOWELS.has(ch)) charPattern += 'V';
    else if (/[a-z]/.test(ch)) charPattern += 'C';
    else charPattern += 'X';
  }

  return {
    token: lower,
    length: len,
    alphabetRatio: len > 0 ? alphaCount / len : 0,
    numericRatio: len > 0 ? numericCount / len : 0,
    isCapitalized: /^[A-Z\u0900-\u0D7F]/.test(token),
    charPattern,
  };
}

/**
 * Batch-normalize an array of crowd entries.
 * Filters out entries that produce empty cleaned names.
 */
export function normalizeEntries(entries: CrowdEntry[]): CleanedEntry[] {
  const results: CleanedEntry[] = [];
  for (const entry of entries) {
    const cleaned = normalizeEntry(entry);
    if (cleaned) results.push(cleaned);
  }
  return results;
}

/**
 * Capitalize a name string properly.
 */
export function capitalizeName(name: string): string {
  return name
    .split(/\s+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}
