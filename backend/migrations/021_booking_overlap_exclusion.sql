-- ════════════════════════════════════════════════════════════════════════════
-- 021_booking_overlap_exclusion.sql
-- Phase 8 — database-level defense-in-depth against double-booking a court.
--
-- The application already prevents this correctly via SELECT ... FOR UPDATE
-- row locking in a transaction (see domain/booking/booking.validator.ts +
-- application/booking/*.usecase.ts) BEFORE inserting/updating a booking. This
-- constraint does NOT replace that — it is a second, independent guarantee
-- enforced by Postgres itself, so a future bug in the app-level lock (a
-- missed FOR UPDATE, a new code path that forgets to call validateBookingSlot,
-- a raw SQL fix run by hand against production) fails loudly with a DB error
-- instead of silently double-booking a court.
--
-- Scope matches booking.validator.ts's own conflict check EXACTLY: only
-- "active" statuses can block a slot. A cancelled/expired/completed/no_show
-- booking, or a soft-deleted one, must never prevent a new booking from
-- reusing that time — the exclusion constraint's WHERE clause encodes the
-- identical predicate the app already uses, so this cannot diverge from
-- existing business behaviour, only backstop it.
--
-- tstzrange(start_time, end_time) is a `[start, end)` range — inclusive
-- start, exclusive end — the same half-open semantics already used by every
-- overlap check in this codebase (see the Phase 6 fixes), so two bookings
-- that only touch at a shared boundary instant (one ends exactly when the
-- other starts) are correctly NOT flagged as overlapping.
--
-- ⚠ BEFORE APPLYING TO THE LIVE VOLUME: run this check first. If it returns
-- any rows, this migration will fail outright (ADD CONSTRAINT validates
-- existing data) — resolve those conflicts (or exclude them, e.g. a bad demo
-- seed row) before re-running.
--
--   SELECT b1.id, b2.id, b1.court_id, b1.start_time, b1.end_time
--   FROM bookings b1
--   JOIN bookings b2 ON b1.court_id = b2.court_id AND b1.id < b2.id
--   WHERE b1.status IN ('draft','pending_deposit','pending_verification','confirmed','checked_in')
--     AND b2.status IN ('draft','pending_deposit','pending_verification','confirmed','checked_in')
--     AND b1.deleted_at IS NULL AND b2.deleted_at IS NULL
--     AND b1.start_time < b2.end_time AND b2.start_time < b1.end_time;
--
-- Apply to the live volume with:
--   docker exec -i courtflow_postgres psql -U courtflow -d courtflow \
--     -v ON_ERROR_STOP=1 < backend/migrations/021_booking_overlap_exclusion.sql
-- ════════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'bookings_no_overlap_per_court'
  ) THEN
    ALTER TABLE bookings
      ADD CONSTRAINT bookings_no_overlap_per_court
      EXCLUDE USING gist (
        court_id WITH =,
        tstzrange(start_time, end_time) WITH &&
      )
      WHERE (
        status IN ('draft','pending_deposit','pending_verification','confirmed','checked_in')
        AND deleted_at IS NULL
      );
  END IF;
END $$;
