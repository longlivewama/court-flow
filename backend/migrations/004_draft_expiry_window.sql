-- ============================================================
--  Migration 004: Draft Booking Expiry Window
--  Configurable per-club grace period before a stalled 'draft'
--  booking (receptionist-created, never finalized) is auto-expired.
-- ============================================================

ALTER TABLE clubs
  ADD COLUMN draft_expiry_minutes INT NOT NULL DEFAULT 30;
