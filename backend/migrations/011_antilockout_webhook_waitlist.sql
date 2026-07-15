-- ═══════════════════════════════════════════════════════════════
-- 011: Anti-lockout, automated payment webhook, anti-scalping waitlist
--
-- expires_at:   per-booking deposit deadline. Replaces the club-wide
--               static window as the source of truth so prime-time
--               bookings can carry a tighter (15-minute) expiry.
--
-- payment_webhook_events: idempotency ledger for the gateway webhook —
--               UNIQUE(provider_event_id) makes replayed deliveries no-ops.
--
-- waitlist_entries / slot_holds: when a prime-time slot is cancelled it
--               is NOT released to the public. A 5-minute hold is written
--               for the top matching waitlist user, claimable only with
--               the single-use token (stored hashed) issued to them.
-- ═══════════════════════════════════════════════════════════════

-- ------------------------------------
-- Dynamic per-booking deposit expiry
-- ------------------------------------
ALTER TABLE bookings ADD COLUMN expires_at TIMESTAMPTZ;

-- Backfill in-flight pending bookings with their club's static window so
-- the cron cutover never extends an existing lock.
UPDATE bookings b
SET expires_at = b.created_at + (c.pending_deposit_expiry_minutes || ' minutes')::interval
FROM clubs c
WHERE c.id = b.club_id
  AND b.status = 'pending_deposit'
  AND b.expires_at IS NULL;

CREATE INDEX idx_bookings_pending_expiry
  ON bookings (expires_at)
  WHERE status = 'pending_deposit';

-- ------------------------------------
-- Payment gateway webhook idempotency ledger
-- ------------------------------------
CREATE TABLE payment_webhook_events (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  provider_event_id  VARCHAR(255) NOT NULL UNIQUE,
  booking_id         UUID REFERENCES bookings(id),
  event_type         VARCHAR(100) NOT NULL,
  amount             NUMERIC(10,2),
  payload            JSONB,
  processed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_webhook_events_booking ON payment_webhook_events (booking_id);

-- ------------------------------------
-- Waitlist + anti-scalping slot holds
-- ------------------------------------
CREATE TABLE waitlist_entries (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_id       UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  court_id      UUID REFERENCES courts(id) ON DELETE CASCADE,  -- NULL = any court
  desired_start TIMESTAMPTZ NOT NULL,
  desired_end   TIMESTAMPTZ NOT NULL,
  fulfilled_at  TIMESTAMPTZ,          -- set when a hold was issued to this entry
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (desired_end > desired_start)
);

-- FIFO fairness: "top of the waitlist" = earliest unfulfilled matching entry
CREATE INDEX idx_waitlist_open
  ON waitlist_entries (club_id, created_at)
  WHERE fulfilled_at IS NULL;

CREATE TABLE slot_holds (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_id     UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  court_id    UUID NOT NULL REFERENCES courts(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  start_time  TIMESTAMPTZ NOT NULL,
  end_time    TIMESTAMPTZ NOT NULL,
  -- SHA-256 of the single-use claim token; the raw token is only ever
  -- delivered to the waitlisted user, never persisted.
  token_hash  CHAR(64) NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  claimed_at  TIMESTAMPTZ,
  booking_id  UUID REFERENCES bookings(id),   -- the claim, once made
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_time > start_time)
);

CREATE INDEX idx_slot_holds_active
  ON slot_holds (court_id, start_time, end_time)
  WHERE claimed_at IS NULL;
