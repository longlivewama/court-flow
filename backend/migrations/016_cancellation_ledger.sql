-- ════════════════════════════════════════════════════════════════════════════
-- 016_cancellation_ledger.sql
-- Booking Cancellation Workflow: financial ledger + refund/forfeit accounting.
--
-- Adds:
--   • ledger_entries    – immutable financial ledger (REFUND / FORFEIT_INCOME /
--                         CANCELLATION_ADJUSTMENT). Append-only: UPDATE/DELETE
--                         are rejected by a trigger, mirroring audit_logs.
--   • bookings.cancelled_by / cancelled_by_role / refund_status / refund_amount
--                         – who cancelled and the settled financial outcome.
--   • payment_status 'forfeited' – a deposit kept by the club on a late cancel.
--
-- Safe to re-run: every statement is guarded with IF NOT EXISTS.
-- Apply to the live volume with:
--   docker exec -i courtflow_postgres psql -U courtflow -d courtflow \
--     -v ON_ERROR_STOP=1 < backend/migrations/016_cancellation_ledger.sql
-- ════════════════════════════════════════════════════════════════════════════

-- ── 1. New payment status: a forfeited (retained) deposit ────────────────────
-- ALTER TYPE ... ADD VALUE must not run inside an explicit transaction block and
-- the value cannot be USED in the same txn it is created — we only reference it
-- from application code at runtime, so this is safe.
ALTER TYPE payment_status ADD VALUE IF NOT EXISTS 'forfeited';

-- ── 2. Booking cancellation bookkeeping columns ──────────────────────────────
ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS cancelled_by      uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS cancelled_by_role user_role,
  -- Settled financial outcome of the cancellation:
  --   NONE (default / not cancelled), NOT_APPLICABLE (nothing was collected),
  --   REFUNDED, FORFEITED, PARTIAL
  ADD COLUMN IF NOT EXISTS refund_status     varchar(20) NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS refund_amount     numeric(10,2) NOT NULL DEFAULT 0;

-- ── 3. Immutable financial ledger ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ledger_entries (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_id         uuid NOT NULL REFERENCES clubs(id),
  -- REFUND | FORFEIT_INCOME | CANCELLATION_ADJUSTMENT (extensible)
  entry_type      varchar(40) NOT NULL,
  -- Accounting direction relative to the club:
  --   DEBIT  = money leaves the club (a refund paid back to the customer)
  --   CREDIT = money retained/earned by the club (a forfeited deposit)
  direction       varchar(8)  NOT NULL CHECK (direction IN ('DEBIT','CREDIT')),
  amount          numeric(10,2) NOT NULL CHECK (amount >= 0),
  booking_id      uuid REFERENCES bookings(id) ON DELETE SET NULL,
  payment_id      uuid REFERENCES payments(id) ON DELETE SET NULL,
  court_name      text,
  reason          text,
  metadata        jsonb,
  created_by      uuid REFERENCES users(id),
  created_by_role user_role,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ledger_club_created ON ledger_entries (club_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ledger_booking      ON ledger_entries (booking_id);
CREATE INDEX IF NOT EXISTS idx_ledger_type         ON ledger_entries (club_id, entry_type);

-- Append-only enforcement: a financial ledger must never be rewritten.
CREATE OR REPLACE FUNCTION reject_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'ledger_entries is append-only; % is not permitted', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_ledger_no_update ON ledger_entries;
CREATE TRIGGER trg_ledger_no_update
  BEFORE UPDATE OR DELETE ON ledger_entries
  FOR EACH ROW EXECUTE FUNCTION reject_ledger_mutation();
