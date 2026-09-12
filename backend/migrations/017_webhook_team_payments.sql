-- ============================================================
--  Migration 017: Let the payment gateway webhook credit tournament
--  team registration fees, not just booking deposits.
--
--  PHASE 1 item 1 of the security remediation closes the "fee payment
--  bypass": POST /api/tournaments/:id/teams/:teamId/pay is now staff-only,
--  so a customer/captain token can no longer mark their own team paid by
--  simply calling the endpoint. Customers instead pay online through the
--  gateway, which confirms the charge to this same webhook endpoint used
--  for booking deposits. The webhook needs a way to address "team X",
--  alongside the existing "booking X" target.
-- ============================================================

ALTER TABLE payment_webhook_events
  ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES tournament_teams(id);

CREATE INDEX IF NOT EXISTS idx_webhook_events_team ON payment_webhook_events (team_id);

-- Every event must address exactly one known target.
ALTER TABLE payment_webhook_events
  ADD CONSTRAINT chk_webhook_events_one_target
  CHECK (
    (booking_id IS NOT NULL AND team_id IS NULL) OR
    (booking_id IS NULL AND team_id IS NOT NULL)
  );
