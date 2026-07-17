-- ============================================================================
-- 012 · Multi-Tenant SaaS Inception
-- ----------------------------------------------------------------------------
-- The schema has carried club_id on every table since 001 "for future
-- multi-tenant SaaS migration" — this migration activates that future:
--
--   · clubs.slug       — immutable, unique tenant domain prefix used during
--                        onboarding (/api/auth/register-club) and ambiguous
--                        login resolution. Lowercase kebab, 3–63 chars.
--   · clubs.plan       — commercial tier ('base' | 'pro'); the seeded showcase
--                        club is grandfathered onto 'pro'.
--   · clubs.is_active  — tenant kill-switch; suspended clubs cannot log in.
--   · user_role 'coach' — restricted role for coaching calendars only.
--
-- NOTE: ALTER TYPE ... ADD VALUE must commit before the value is usable in
-- the same session; it is issued first as its own statement on purpose.
-- ============================================================================

ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'coach';

ALTER TABLE clubs ADD COLUMN IF NOT EXISTS slug VARCHAR(63);
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS plan VARCHAR(20) NOT NULL DEFAULT 'base';
ALTER TABLE clubs ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- Backfill: every club gets a deterministic, collision-free slug first;
-- the flagship seeded club (fixed UUID from seed.ts) then claims the
-- canonical slug + pro plan. Handles databases that accumulated duplicate
-- seed rows from 001's INSERT plus the seeder.
UPDATE clubs
   SET slug = 'club-' || substr(id::text, 1, 8)
 WHERE slug IS NULL;

UPDATE clubs
   SET slug = 'courtflow-padel',
       plan = 'pro'
 WHERE id = '00000000-0000-0000-0000-000000000001';

-- Empty duplicate seed rows (no users) are deactivated, not deleted
UPDATE clubs c
   SET is_active = FALSE
 WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.club_id = c.id)
   AND c.id <> '00000000-0000-0000-0000-000000000001';

ALTER TABLE clubs ALTER COLUMN slug SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clubs_slug_unique') THEN
    ALTER TABLE clubs ADD CONSTRAINT clubs_slug_unique UNIQUE (slug);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clubs_slug_format') THEN
    ALTER TABLE clubs ADD CONSTRAINT clubs_slug_format
      CHECK (slug ~ '^[a-z0-9](?:[a-z0-9-]{1,61})[a-z0-9]$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clubs_plan_check') THEN
    ALTER TABLE clubs ADD CONSTRAINT clubs_plan_check
      CHECK (plan IN ('base', 'pro'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_clubs_slug ON clubs (slug);
