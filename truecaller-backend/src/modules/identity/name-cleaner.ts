/**
 * Name Cleaning Pipeline
 *
 * Converts raw contact names into cleaned, probable human names
 * by removing junk, emojis, special chars, and spam-related words.
 */

// Words commonly found in contact names that aren't actual names
const JUNK_WORDS = new Set([
  // Spam / Fraud
  'spam', 'fraud', 'fake', 'scam', 'phishing', 'hack',
  // Business / Service
  'loan', 'bank', 'insurance', 'agent', 'delivery', 'courier',
  'customer', 'care', 'support', 'service', 'helpline', 'office',
  'company', 'pvt', 'ltd', 'llp', 'inc', 'corp',
  // Honorifics / Suffixes (Hindi + English)
  'sir', 'ji', 'bhai', 'bhaiya', 'didi', 'aunty', 'uncle',
  'madam', 'maam', 'sahab', 'saheb',
  // Relationship
  'papa', 'mummy', 'mom', 'dad', 'wife', 'husband', 'gf', 'bf',
  // Labels
  'do', 'not', 'pick', 'dont', 'call', 'block', 'blocked',
  'important', 'urgent', 'work', 'home', 'old', 'new',
  'whatsapp', 'telegram', 'wp', 'number', 'no', 'num',
  'mobile', 'phone', 'landline', 'temp', 'temporary',
]);

// Emoji regex pattern
const EMOJI_REGEX = /[\u{1F600}-\u{1F64F}\u{1F300}-\u{1F5FF}\u{1F680}-\u{1F6FF}\u{1F1E0}-\u{1F1FF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{FE00}-\u{FE0F}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{200D}\u{20E3}\u{FE0F}]/gu;

// Special characters regex (keep letters, spaces, dots, hyphens)
const SPECIAL_CHARS_REGEX = /[^a-zA-Z\u0900-\u097F\u0980-\u09FF\u0A00-\u0A7F\u0A80-\u0AFF\u0B00-\u0B7F\u0B80-\u0BFF\u0C00-\u0C7F\u0C80-\u0CFF\u0D00-\u0D7F\s.\-']/g;

export interface CleanedNameResult {
  rawName: string;
  cleanedName: string;
  isJunk: boolean;
}

/**
 * Clean a raw contact name into a probable human name
 */
export function cleanName(rawName: string): CleanedNameResult {
  if (!rawName || rawName.trim().length === 0) {
    return { rawName, cleanedName: '', isJunk: true };
  }

  let name = rawName;

  // Step 1: Convert to lowercase for processing
  name = name.toLowerCase();

  // Step 2: Remove emojis
  name = name.replace(EMOJI_REGEX, '');

  // Step 3: Remove special characters (keep Indic scripts + latin + spaces)
  name = name.replace(SPECIAL_CHARS_REGEX, ' ');

  // Step 4: Remove duplicate spaces
  name = name.replace(/\s+/g, ' ').trim();

  // Step 5: Split into tokens and filter
  let tokens = name.split(/\s+/).filter((t) => t.length > 0);

  // Step 6: Remove junk words
  tokens = tokens.filter((t) => !JUNK_WORDS.has(t));

  // Step 7: Remove numeric-only tokens
  tokens = tokens.filter((t) => !/^\d+$/.test(t));

  // Step 8: Remove single-character tokens (unless it's an initial like 'A.')
  tokens = tokens.filter((t) => t.length > 1 || /^[a-z]\.?$/i.test(t));

  // Step 9: Keep maximum first 3 meaningful tokens (first, middle, last name)
  tokens = tokens.slice(0, 3);

  // Step 10: Check if result is junk
  if (tokens.length === 0) {
    return { rawName, cleanedName: '', isJunk: true };
  }

  // Build cleaned name (title case)
  const cleanedName = tokens
    .map((t) => t.charAt(0).toUpperCase() + t.slice(1))
    .join(' ');

  return { rawName, cleanedName, isJunk: false };
}

/**
 * Calculate similarity between two cleaned names
 * Returns a score between 0 and 1
 */
export function nameSimilarity(name1: string, name2: string): number {
  const a = name1.toLowerCase().trim();
  const b = name2.toLowerCase().trim();

  if (a === b) return 1;
  if (a.length === 0 || b.length === 0) return 0;

  // Token-based similarity
  const tokensA = new Set(a.split(/\s+/));
  const tokensB = new Set(b.split(/\s+/));
  const intersection = new Set([...tokensA].filter((t) => tokensB.has(t)));
  const union = new Set([...tokensA, ...tokensB]);
  const tokenSim = intersection.size / union.size;

  // Edit distance similarity (normalized Levenshtein)
  const editDist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  const editSim = 1 - editDist / maxLen;

  // Starts-with check (handles "Rahul" vs "Rahul Sharma")
  const startsWithSim = a.startsWith(b) || b.startsWith(a) ? 0.3 : 0;

  // Weighted combination
  return Math.min(1, tokenSim * 0.5 + editSim * 0.35 + startsWithSim * 0.15);
}

/**
 * Levenshtein edit distance
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

/**
 * Capitalize a cleaned name properly
 */
export function capitalizeName(name: string): string {
  return name
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}
