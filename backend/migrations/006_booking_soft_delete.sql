-- Migration: Booking Soft-Delete Support
-- Adds deleted_at, deleted_by, and deletion_reason columns to bookings.
-- Enables soft-delete instead of hard-delete for historical data preservation.

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS deletion_reason TEXT;

-- Partial index: only index rows that are actually soft-deleted (sparse)
CREATE INDEX IF NOT EXISTS idx_bookings_deleted_at
  ON bookings (deleted_at)
  WHERE deleted_at IS NOT NULL;
