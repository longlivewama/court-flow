-- ============================================================
--  Migration 003: Split Payments Refactoring
--  Supports a "Deposit + Remainder" architecture.
-- ============================================================

ALTER TABLE bookings
  DROP COLUMN IF EXISTS amount_paid,
  DROP COLUMN IF EXISTS payment_method;

ALTER TABLE bookings
  ADD COLUMN deposit_method VARCHAR(50),
  ADD COLUMN remainder_amount NUMERIC(10,2) NOT NULL DEFAULT 0.0,
  ADD COLUMN remainder_method VARCHAR(50);
