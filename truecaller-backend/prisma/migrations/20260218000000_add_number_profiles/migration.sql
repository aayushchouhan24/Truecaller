-- ═══════════════════════════════════════════════════════════════════════════
-- Migration: Add number_profiles canonical lookup table + composite indexes
-- Date: 2026-02-18
-- Purpose: Create the single-read lookup table that eliminates all runtime
--          joins, scoring, and AI during phone number lookup.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── Step 1: Create canonical number_profiles table ──────────────────────

CREATE TABLE IF NOT EXISTS "number_profiles" (
    "phone_number"      TEXT        NOT NULL PRIMARY KEY,
    "resolved_name"     TEXT,
    "description"       TEXT,
    "confidence"        DOUBLE PRECISION NOT NULL DEFAULT 0,
    "spam_score"        INTEGER     NOT NULL DEFAULT 0,
    "spam_category"     TEXT,
    "category"          TEXT,
    "tags"              TEXT[]      DEFAULT '{}',
    "relationship_hint" TEXT,
    "source_count"      INTEGER     NOT NULL DEFAULT 0,
    "is_verified"       BOOLEAN     NOT NULL DEFAULT false,
    "version"           INTEGER     NOT NULL DEFAULT 1,
    "updated_at"        TIMESTAMP(3) NOT NULL,
    "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for number_profiles
CREATE INDEX IF NOT EXISTS "number_profiles_spam_score_idx" ON "number_profiles" ("spam_score");
CREATE INDEX IF NOT EXISTS "number_profiles_category_idx"   ON "number_profiles" ("category");
CREATE INDEX IF NOT EXISTS "number_profiles_updated_at_idx" ON "number_profiles" ("updated_at");

-- ── Step 2: Add composite indexes to heavy-write tables ─────────────────

-- Dedup index for name_contributions: (identity_id, contributor_id, cleaned_name)
CREATE INDEX IF NOT EXISTS "idx_contrib_dedup"
    ON "name_contributions" ("identity_id", "contributor_id", "cleaned_name");

-- Composite index for spam reports: (reporter_id, phone_number) — per-user dedup
CREATE INDEX IF NOT EXISTS "idx_spam_reporter_phone"
    ON "spam_reports" ("reporter_id", "phone_number");

-- Composite index for user_contacts: (phone_number, name) — groupBy acceleration
CREATE INDEX IF NOT EXISTS "idx_contact_phone_name"
    ON "user_contacts" ("phone_number", "name");

-- ── Step 3: Backfill number_profiles from existing data ─────────────────

INSERT INTO "number_profiles" ("phone_number", "resolved_name", "description", "confidence",
    "spam_score", "category", "tags", "source_count", "is_verified", "version", "updated_at", "created_at")
SELECT
    ni."phone_number",
    ni."resolved_name",
    ni."description",
    COALESCE(ni."confidence", 0),
    COALESCE(ss."score", 0),
    NULL,
    COALESCE(ni."tags", '{}'),
    COALESCE(ni."source_count", 0),
    (ni."verified_name" IS NOT NULL),
    1,
    COALESCE(ni."last_resolved_at", ni."updated_at", NOW()),
    COALESCE(ni."created_at", NOW())
FROM "number_identities" ni
LEFT JOIN "spam_scores" ss ON ss."phone_number" = ni."phone_number"
ON CONFLICT ("phone_number") DO NOTHING;

-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK STEPS (execute in reverse order to undo)
-- ═══════════════════════════════════════════════════════════════════════════
-- DROP INDEX IF EXISTS "idx_contact_phone_name";
-- DROP INDEX IF EXISTS "idx_spam_reporter_phone";
-- DROP INDEX IF EXISTS "idx_contrib_dedup";
-- DROP INDEX IF EXISTS "number_profiles_updated_at_idx";
-- DROP INDEX IF EXISTS "number_profiles_category_idx";
-- DROP INDEX IF EXISTS "number_profiles_spam_score_idx";
-- DROP TABLE IF EXISTS "number_profiles";
