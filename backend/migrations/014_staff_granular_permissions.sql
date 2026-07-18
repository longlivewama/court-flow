-- ============================================================================
-- 014 · Granular staff permissions
-- ----------------------------------------------------------------------------
-- Per-account permission flags layered on top of the coarse role. They refine
-- what a `receptionist` (STAFF / DESK) may reach; `owner` accounts implicitly
-- hold every permission and bypass these checks in requirePermission().
--
--   · can_view_schedule   — the main timetable grid + daily schedule feed
--   · can_verify_deposits — manually clear 50% down-payments
--   · can_manage_coaches  — create/manage coaching sessions & rosters
--   · can_view_finance    — revenue metrics, payments ledger, analytics
--
-- Columns default TRUE so every EXISTING staff account keeps its current
-- access on migrate (no silent lockout). New accounts created through the
-- Staff Manager set each flag explicitly from the owner's toggle choices.
-- ============================================================================

ALTER TABLE users ADD COLUMN IF NOT EXISTS can_view_schedule   BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_verify_deposits BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_manage_coaches  BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS can_view_finance    BOOLEAN NOT NULL DEFAULT TRUE;
