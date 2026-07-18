-- ============================================================================
-- 013 · Coach login accounts
-- ----------------------------------------------------------------------------
-- Links a coaches roster row to a users row (role 'coach') so a coach can
-- sign in and see their own coaching viewport: allocated training sessions
-- and personal commission earnings — never the club-wide ledger.
--
--   · coaches.user_id — nullable, UNIQUE (one login per coach profile),
--     ON DELETE SET NULL so removing the account keeps the roster history.
-- ============================================================================

ALTER TABLE coaches
  ADD COLUMN IF NOT EXISTS user_id UUID UNIQUE REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_coaches_user ON coaches (user_id);
