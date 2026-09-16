-- ============================================================
--  Migration 027: Composite index to support analytics/finance queries.
--
--  Every analytics/finance/report query (analytics.controller.ts,
--  finance.controller.ts, booking.controller.ts's getFinancialSummary,
--  report.controller.ts's revenue reports) filters bookings on exactly the
--  same three columns together: club_id = $1 AND status IN (...) AND
--  start_time in some range. Today that's satisfied by ANDing three separate
--  single-column indexes (idx_bookings_club, idx_bookings_status,
--  idx_bookings_start_time from migration 001) via a bitmap AND, rather than
--  a single composite index scan.
--
--  Additive only — does not drop the existing single-column indexes, since
--  other query paths (availability grid, the overlap-exclusion constraint)
--  may rely on start_time or status alone. Dropping the now-partially-
--  redundant single-column indexes is a separate, lower-priority cleanup
--  once every other query path has been verified against it.
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_bookings_club_status_start
  ON bookings (club_id, status, start_time);
