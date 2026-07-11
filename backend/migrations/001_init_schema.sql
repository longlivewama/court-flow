-- ============================================================
--  CourtFlow – Initial Database Schema
--  Version 1.0  |  Timezone: UTC (display in Africa/Cairo)
-- ============================================================

-- ------------------------------------
-- Extensions
-- ------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";   -- for fuzzy customer search

-- ------------------------------------
-- Custom Types / ENUMs
-- ------------------------------------
CREATE TYPE user_role AS ENUM ('owner', 'receptionist', 'customer');

CREATE TYPE court_status AS ENUM (
  'available',
  'closed',
  'maintenance',
  'reserved_club_event',
  'reserved_tournament'
);

CREATE TYPE booking_status AS ENUM (
  'draft',
  'pending_deposit',
  'pending_verification',
  'confirmed',
  'checked_in',
  'completed',
  'cancelled',
  'no_show',
  'expired'
);

CREATE TYPE payment_status AS ENUM (
  'deposit_pending',
  'deposit_approved',
  'deposit_rejected',
  'remaining_balance_pending',
  'paid_in_full',
  'partially_refunded',
  'fully_refunded'
);

CREATE TYPE refund_status AS ENUM (
  'pending',
  'approved',
  'rejected'
);

CREATE TYPE blocked_period_type AS ENUM (
  'maintenance',
  'private_event',
  'holiday',
  'tournament',
  'other'
);

CREATE TYPE report_status AS ENUM (
  'queued',
  'processing',
  'completed',
  'failed'
);

CREATE TYPE report_type AS ENUM (
  'daily_revenue',
  'weekly_revenue',
  'monthly_revenue',
  'court_utilization',
  'booking_history',
  'customer_activity',
  'payment_history',
  'cancellation_report',
  'noshow_report'
);

CREATE TYPE export_format AS ENUM ('pdf', 'excel', 'csv');

-- ------------------------------------
-- Core Tables
-- ------------------------------------

-- club_id is included on all tables for future multi-tenant SaaS migration
CREATE TABLE clubs (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            VARCHAR(255) NOT NULL,
  email           VARCHAR(255),
  phone           VARCHAR(50),
  address         TEXT,
  timezone        VARCHAR(100) NOT NULL DEFAULT 'Africa/Cairo',
  currency        VARCHAR(10)  NOT NULL DEFAULT 'EGP',
  deposit_percent NUMERIC(5,2) NOT NULL DEFAULT 50.00
                    CHECK (deposit_percent >= 10 AND deposit_percent <= 100),
  cancellation_deadline_hours INT NOT NULL DEFAULT 24,
  pending_deposit_expiry_minutes INT NOT NULL DEFAULT 120,
  noshow_grace_minutes INT NOT NULL DEFAULT 15,
  reminder_24h_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  reminder_2h_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed single club record
INSERT INTO clubs (id, name, timezone, currency)
VALUES (uuid_generate_v4(), 'CourtFlow Padel Club', 'Africa/Cairo', 'EGP');

-- ------------------------------------
-- Users
-- ------------------------------------
CREATE TABLE users (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_id               UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  email                 VARCHAR(255) NOT NULL,
  password_hash         TEXT NOT NULL,
  role                  user_role NOT NULL DEFAULT 'customer',
  first_name            VARCHAR(100) NOT NULL,
  last_name             VARCHAR(100) NOT NULL,
  phone                 VARCHAR(50),
  address               TEXT,
  email_verified        BOOLEAN NOT NULL DEFAULT FALSE,
  is_active             BOOLEAN NOT NULL DEFAULT TRUE,
  failed_login_attempts INT NOT NULL DEFAULT 0,
  locked_until          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (club_id, email)
);

CREATE INDEX idx_users_email ON users (email);
CREATE INDEX idx_users_club_role ON users (club_id, role);

-- ------------------------------------
-- Email Verification Tokens
-- ------------------------------------
CREATE TABLE email_verifications (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,          -- stored hashed
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_email_verifications_token ON email_verifications (token_hash);

-- ------------------------------------
-- Password Reset Tokens
-- ------------------------------------
CREATE TABLE password_resets (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,          -- stored hashed, single-use
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_password_resets_token ON password_resets (token_hash);

-- ------------------------------------
-- Refresh Tokens (JWT rotation)
-- ------------------------------------
CREATE TABLE refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,   -- stored hashed
  device_info TEXT,
  ip_address  INET,
  expires_at  TIMESTAMPTZ NOT NULL,
  revoked_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens (user_id);
CREATE INDEX idx_refresh_tokens_hash ON refresh_tokens (token_hash);

-- ------------------------------------
-- Courts
-- ------------------------------------
CREATE TABLE courts (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_id     UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  name        VARCHAR(100) NOT NULL,
  number      INT NOT NULL,
  description TEXT,
  price_per_slot NUMERIC(10,2) NOT NULL CHECK (price_per_slot > 0),
  status      court_status NOT NULL DEFAULT 'available',
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (club_id, number)
);

CREATE INDEX idx_courts_club ON courts (club_id);
CREATE INDEX idx_courts_status ON courts (status);

-- ------------------------------------
-- Working Hours (per weekday, 0=Sunday … 6=Saturday)
-- ------------------------------------
CREATE TABLE working_hours (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_id      UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  day_of_week  SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  open_time    TIME NOT NULL,
  close_time   TIME NOT NULL,   -- may be < open_time for after-midnight slots
  is_closed    BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (club_id, day_of_week)
);

CREATE INDEX idx_working_hours_club ON working_hours (club_id, day_of_week);

-- ------------------------------------
-- Blocked Periods
-- ------------------------------------
CREATE TABLE blocked_periods (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_id     UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  court_id    UUID REFERENCES courts(id) ON DELETE CASCADE, -- NULL = entire club
  type        blocked_period_type NOT NULL DEFAULT 'other',
  title       VARCHAR(255) NOT NULL,
  start_at    TIMESTAMPTZ NOT NULL,
  end_at      TIMESTAMPTZ NOT NULL,
  recurring   BOOLEAN NOT NULL DEFAULT FALSE,   -- annually recurring
  created_by  UUID NOT NULL REFERENCES users(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_at > start_at)
);

CREATE INDEX idx_blocked_periods_court ON blocked_periods (court_id, start_at, end_at);
CREATE INDEX idx_blocked_periods_club  ON blocked_periods (club_id, start_at, end_at);

-- ------------------------------------
-- Bookings
-- ------------------------------------
CREATE TABLE bookings (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_id              UUID NOT NULL REFERENCES clubs(id),
  court_id             UUID NOT NULL REFERENCES courts(id),
  customer_id          UUID NOT NULL REFERENCES users(id),
  created_by           UUID NOT NULL REFERENCES users(id),   -- may differ from customer_id
  status               booking_status NOT NULL DEFAULT 'pending_deposit',
  start_time           TIMESTAMPTZ NOT NULL,
  end_time             TIMESTAMPTZ NOT NULL,
  duration_minutes     SMALLINT NOT NULL CHECK (duration_minutes IN (60, 90, 120)),
  -- Snapshot at time of creation (immutable)
  total_price          NUMERIC(10,2) NOT NULL,
  deposit_percent_snap NUMERIC(5,2)  NOT NULL,
  deposit_amount       NUMERIC(10,2) NOT NULL,
  remaining_balance    NUMERIC(10,2) NOT NULL,
  cancellation_reason  TEXT,
  cancelled_at         TIMESTAMPTZ,
  noshow_at            TIMESTAMPTZ,
  checked_in_at        TIMESTAMPTZ,
  completed_at         TIMESTAMPTZ,
  expired_at           TIMESTAMPTZ,
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_time > start_time)
);

CREATE INDEX idx_bookings_court_time ON bookings (court_id, start_time, end_time);
CREATE INDEX idx_bookings_customer   ON bookings (customer_id);
CREATE INDEX idx_bookings_status     ON bookings (status);
CREATE INDEX idx_bookings_club       ON bookings (club_id);
CREATE INDEX idx_bookings_start_time ON bookings (start_time);

-- ------------------------------------
-- Payments
-- ------------------------------------
CREATE TABLE payments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id      UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  club_id         UUID NOT NULL REFERENCES clubs(id),
  customer_id     UUID NOT NULL REFERENCES users(id),
  status          payment_status NOT NULL DEFAULT 'deposit_pending',
  deposit_amount  NUMERIC(10,2) NOT NULL,
  total_amount    NUMERIC(10,2) NOT NULL,
  verified_by     UUID REFERENCES users(id),
  verified_at     TIMESTAMPTZ,
  rejection_reason TEXT,
  balance_paid_by  UUID REFERENCES users(id),
  balance_paid_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_payments_booking ON payments (booking_id);
CREATE INDEX idx_payments_status  ON payments (status);

-- ------------------------------------
-- Receipts (encrypted file references)
-- ------------------------------------
CREATE TABLE receipts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  payment_id      UUID NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
  booking_id      UUID NOT NULL REFERENCES bookings(id),
  uploaded_by     UUID NOT NULL REFERENCES users(id),
  file_name       VARCHAR(255) NOT NULL,
  file_mime       VARCHAR(100) NOT NULL,
  file_size_bytes INT NOT NULL,
  storage_key     TEXT NOT NULL,          -- encrypted path / S3 key
  encryption_iv   TEXT NOT NULL,          -- per-file AES-256-GCM IV (base64)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_receipts_payment ON receipts (payment_id);
CREATE INDEX idx_receipts_booking ON receipts (booking_id);

-- ------------------------------------
-- Refunds
-- ------------------------------------
CREATE TABLE refunds (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id       UUID NOT NULL REFERENCES bookings(id),
  payment_id       UUID NOT NULL REFERENCES payments(id),
  created_by       UUID NOT NULL REFERENCES users(id),   -- receptionist
  approved_by      UUID REFERENCES users(id),            -- owner
  status           refund_status NOT NULL DEFAULT 'pending',
  amount           NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  percent          NUMERIC(5,2),
  reason           TEXT NOT NULL,
  internal_notes   TEXT,
  approved_at      TIMESTAMPTZ,
  rejected_at      TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refunds_booking ON refunds (booking_id);
CREATE INDEX idx_refunds_status  ON refunds (status);

-- ------------------------------------
-- Report Jobs
-- ------------------------------------
CREATE TABLE report_jobs (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_id       UUID NOT NULL REFERENCES clubs(id),
  requested_by  UUID NOT NULL REFERENCES users(id),
  type          report_type NOT NULL,
  format        export_format NOT NULL,
  filters       JSONB NOT NULL DEFAULT '{}',
  status        report_status NOT NULL DEFAULT 'queued',
  storage_key   TEXT,          -- available after completion
  error_message TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

CREATE INDEX idx_report_jobs_club   ON report_jobs (club_id, status);
CREATE INDEX idx_report_jobs_status ON report_jobs (status, created_at);

-- ============================================================
--  AUDIT LOG – APPEND-ONLY, ROW-LEVEL SECURITY
-- ============================================================

CREATE TABLE audit_logs (
  id             BIGSERIAL PRIMARY KEY,
  club_id        UUID         NOT NULL,
  timestamp_utc  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  user_id        UUID,
  user_role      user_role,
  ip_address     INET,
  device_info    TEXT,
  action_type    VARCHAR(100) NOT NULL,
  entity_type    VARCHAR(100) NOT NULL,
  entity_id      TEXT,
  previous_values JSONB,
  new_values      JSONB,
  reason          TEXT
);

CREATE INDEX idx_audit_logs_timestamp  ON audit_logs (timestamp_utc DESC);
CREATE INDEX idx_audit_logs_user       ON audit_logs (user_id, timestamp_utc DESC);
CREATE INDEX idx_audit_logs_entity     ON audit_logs (entity_type, entity_id);
CREATE INDEX idx_audit_logs_club       ON audit_logs (club_id, timestamp_utc DESC);

-- ============================================================
--  AUDIT LOG IMMUTABILITY: Database-level enforcement
--  1. Dedicated role with INSERT-only rights
--  2. Row-Level Security prevents UPDATE/DELETE from app role
-- ============================================================

-- Create a restricted DB role for audit writes (used only by app's audit service)
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'audit_writer') THEN
    CREATE ROLE audit_writer LOGIN PASSWORD 'CHANGE_IN_PRODUCTION';
  END IF;
END
$$;

-- audit_writer can ONLY insert into audit_logs
REVOKE ALL ON audit_logs FROM PUBLIC;
GRANT INSERT ON audit_logs TO audit_writer;
GRANT USAGE ON SEQUENCE audit_logs_id_seq TO audit_writer;

-- Enable RLS so the application role cannot UPDATE or DELETE
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- App role (courtflow_app) can only SELECT or INSERT, never UPDATE/DELETE
CREATE POLICY audit_logs_insert_only ON audit_logs
  AS RESTRICTIVE
  FOR ALL
  USING (FALSE)         -- deny UPDATE / DELETE for all users by default
  WITH CHECK (TRUE);    -- allow INSERT

-- Allow SELECT for authenticated app and owner reads
CREATE POLICY audit_logs_select ON audit_logs
  FOR SELECT
  USING (TRUE);

-- ============================================================
--  UPDATED_AT trigger function
-- ============================================================
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_users_updated_at          BEFORE UPDATE ON users          FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_courts_updated_at         BEFORE UPDATE ON courts         FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_bookings_updated_at       BEFORE UPDATE ON bookings       FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_payments_updated_at       BEFORE UPDATE ON payments       FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_refunds_updated_at        BEFORE UPDATE ON refunds        FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_working_hours_updated_at  BEFORE UPDATE ON working_hours  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_clubs_updated_at          BEFORE UPDATE ON clubs          FOR EACH ROW EXECUTE FUNCTION update_updated_at();
