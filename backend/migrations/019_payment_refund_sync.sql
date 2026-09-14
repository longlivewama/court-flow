-- ════════════════════════════════════════════════════════════════════════════
-- 019_payment_refund_sync.sql
-- Manual refund approval (POST /api/refunds → PATCH /api/refunds/:id) left
-- payments.status stale and recorded no running refunded total, unlike the
-- booking-cancellation flow (016_cancellation_ledger.sql) which already keeps
-- payments.status and the ledger in sync on cancel. This adds the column
-- needed to close that gap: payments.refunded_amount, updated atomically
-- alongside payments.status and a new REFUND ledger entry, all inside the
-- SAME transaction that approves a refund (see refund.controller.ts
-- approveOrRejectRefund()).
--
-- Safe to re-run: guarded with IF NOT EXISTS.
-- Apply to the live volume with:
--   docker exec -i courtflow_postgres psql -U courtflow -d courtflow \
--     -v ON_ERROR_STOP=1 < backend/migrations/019_payment_refund_sync.sql
-- ════════════════════════════════════════════════════════════════════════════

ALTER TABLE payments
  ADD COLUMN IF NOT EXISTS refunded_amount numeric(10,2) NOT NULL DEFAULT 0
    CHECK (refunded_amount >= 0);
