-- ═══════════════════════════════════════════════════════════════
-- 007: Flexible booking durations
-- Replaces the fixed 60/90/120-minute whitelist so bookings can span
-- any whole-hour block up to 12 hours. 30-minute granularity remains
-- valid at the DB level so pre-existing 90-minute bookings still
-- satisfy the constraint; the application layer only creates
-- whole-hour bookings going forward.
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_duration_minutes_check;

ALTER TABLE bookings ADD CONSTRAINT bookings_duration_minutes_check
  CHECK (duration_minutes >= 60 AND duration_minutes <= 720 AND duration_minutes % 30 = 0);
