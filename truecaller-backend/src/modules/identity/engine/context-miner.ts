/**
 * STEPS 6 & 7: Context Miner
 *
 * Step 6 — Mine roles, relationships, and descriptors from non-name tokens.
 * Step 7 — Aggregate into tags and determine the most probable role.
 *
 * All detection is data-driven:
 *   • ROLE tokens      → those that appear across many different numbers.
 *   • RELATIONSHIP     → tokens saved for very few numbers, often as the sole word.
 *   • DESCRIPTOR       → modifiers that colour the identity (e.g. position-last tokens).
 *
 * Output: ExtractedContext { tags, probableRole, relationshipTokens, roleTokens, descriptorTokens }
 */

import type { ClassifiedToken, CleanedEntry, ExtractedContext } from './types';

// ── Public API ─────────────────────────────────────────────────────

/**
 * Mine contextual information from all cleaned entries for a phone number.
 *
 * @param entries           Cleaned, tokenised entries for this number.
 * @param classifiedTokens  Map<token, ClassifiedToken> produced by the classifier.
 */
export function mineContext(
  entries: CleanedEntry[],
  classifiedTokens: Map<string, ClassifiedToken>,
): ExtractedContext {
  const tags = new Set<string>();
  const roleTokens: string[] = [];
  const relationshipTokens: string[] = [];
  const descriptorTokens: string[] = [];

  // Frequency map for roles (to pick the most probable)
  const roleCounts = new Map<string, number>();

  for (const entry of entries) {
    for (const tokenStr of entry.tokens) {
      const classified = classifiedTokens.get(tokenStr);
      if (!classified) continue;

      switch (classified.type) {
        case 'ROLE':
          if (!roleTokens.includes(tokenStr)) roleTokens.push(tokenStr);
          tags.add(tokenStr);
          roleCounts.set(tokenStr, (roleCounts.get(tokenStr) ?? 0) + 1);
          break;

        case 'RELATIONSHIP':
          if (!relationshipTokens.includes(tokenStr))
            relationshipTokens.push(tokenStr);
          tags.add(tokenStr);
          break;

        case 'DESCRIPTOR':
          if (!descriptorTokens.includes(tokenStr))
            descriptorTokens.push(tokenStr);
          // Descriptors are not surfaced as tags — they are supplementary info
          break;

        case 'ORGANIZATION':
          tags.add(tokenStr);
          break;

        default:
          break;
      }
    }
  }

  // ── Determine probable role: the most frequent ROLE token ──
  let probableRole: string | null = null;
  let maxRoleCount = 0;

  for (const [role, count] of roleCounts) {
    if (count > maxRoleCount) {
      maxRoleCount = count;
      probableRole = role;
    }
  }

  return {
    tags: [...tags],
    probableRole,
    relationshipTokens,
    roleTokens,
    descriptorTokens,
  };
}
