-- ═══════════════════════════════════════════════════════════════
-- 010: Tournaments carry a full schedule window (starts_at → ends_at).
--
-- Existing rows are backfilled with a same-day 6-hour window so the
-- NOT NULL + ordering constraints can be enforced going forward.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE tournaments ADD COLUMN ends_at TIMESTAMPTZ;

UPDATE tournaments SET ends_at = starts_at + INTERVAL '6 hours' WHERE ends_at IS NULL;

ALTER TABLE tournaments
  ALTER COLUMN ends_at SET NOT NULL,
  ADD CONSTRAINT chk_tournaments_ends_after_starts CHECK (ends_at > starts_at);
