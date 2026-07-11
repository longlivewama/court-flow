-- Migration: Phase 1 Financial Engine Upgrade
-- Adds advanced financial columns to the bookings table.

CREATE TYPE deposit_status_enum AS ENUM ('NOT_PAID', 'DEPOSIT_PAID', 'FULLY_PAID');
CREATE TYPE payment_method_enum AS ENUM ('INSTAPAY', 'VODAFONE_CASH', 'CASH', 'NONE');

ALTER TABLE bookings 
  ADD COLUMN deposit_status deposit_status_enum NOT NULL DEFAULT 'NOT_PAID',
  ADD COLUMN payment_method payment_method_enum NOT NULL DEFAULT 'NONE',
  ADD COLUMN amount_paid NUMERIC(10,2) NOT NULL DEFAULT 0.0,
  ADD COLUMN discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0.0,
  ADD COLUMN admin_notes TEXT,
  ADD COLUMN processed_by_id UUID REFERENCES users(id);

-- Update the audit log trigger or handle manually in use case.
