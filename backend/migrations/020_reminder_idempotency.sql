-- ════════════════════════════════════════════════════════════════════════════
-- 020_reminder_idempotency.sql
-- The reminder cron (infrastructure/cron/index.ts, sendReminders()) matched
-- bookings with a 2-minute-wide sliding window (± 1 minute around the target
-- offset) re-evaluated every minute, with no record of which bookings had
-- already been notified — so a booking sitting in that window across two or
-- three consecutive 1-minute ticks got the same 24h/2h reminder sent that
-- many times. Adds durable per-booking, per-reminder-type "already sent"
-- flags so a reminder can be attempted many times (retryable on failure) but
-- only ever actually mark itself sent once it truly sends.
--
-- Safe to re-run: guarded with IF NOT EXISTS.
-- Apply to the live volume with:
--   docker exec -i courtflow_postgres psql -U courtflow -d courtflow \
--     -v ON_ERROR_STOP=1 < backend/migrations/020_reminder_idempotency.sql
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS reminder_24h_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_2h_sent_at  timestamptz;
