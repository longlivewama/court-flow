-- ═══════════════════════════════════════════════════════════════
-- 008: Equipment rental + fixed long-term (VIP) subscriptions
--
-- Equipment:  rentable inventory (rackets, gear) priced per hour.
--             booking_equipment snapshots the hourly price at booking
--             time so later price edits never rewrite history.
--
-- Subscriptions: a weekly recurring reservation (same court, weekday
--             and hour) for a 1- or 3-month term. Each occurrence is
--             materialised as a normal bookings row pointing back at
--             its subscription, so conflict-checking, check-in and
--             cancellation reuse the existing booking machinery.
-- ═══════════════════════════════════════════════════════════════

-- ------------------------------------
-- Equipment inventory
-- ------------------------------------
CREATE TABLE equipment (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_id      UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  name         VARCHAR(100) NOT NULL,
  category     VARCHAR(50)  NOT NULL DEFAULT 'racket',
  description  TEXT,
  hourly_price NUMERIC(10,2) NOT NULL CHECK (hourly_price >= 0),
  stock_qty    INT NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (club_id, name)
);

CREATE INDEX idx_equipment_club ON equipment (club_id, is_active);

CREATE TRIGGER trg_equipment_updated_at
  BEFORE UPDATE ON equipment FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Seed the starting rental fleet for the single club
INSERT INTO equipment (club_id, name, category, description, hourly_price, stock_qty)
SELECT c.id, e.name, e.category, e.description, e.hourly_price, e.stock_qty
FROM clubs c,
     (VALUES
       ('Carbon Pro Racket',    'racket', '3K carbon frame, diamond shape — advanced players', 120.00, 8),
       ('Control Lite Racket',  'racket', 'Fiberglass round shape — control & comfort',         80.00, 12),
       ('Tour Ball Tube (x3)',  'balls',  'Pressurised tour-grade padel balls',                 40.00, 24),
       ('Pro Grip Overwrap',    'gear',   'Tacky overgrip, applied fresh per session',          15.00, 40)
     ) AS e(name, category, description, hourly_price, stock_qty);

-- ------------------------------------
-- Booking ↔ equipment lines (price snapshot per line)
-- ------------------------------------
CREATE TABLE booking_equipment (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id         UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  equipment_id       UUID NOT NULL REFERENCES equipment(id),
  quantity           INT NOT NULL CHECK (quantity > 0),
  hourly_price_snap  NUMERIC(10,2) NOT NULL,
  hours              NUMERIC(4,1)  NOT NULL,
  subtotal           NUMERIC(10,2) NOT NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (booking_id, equipment_id)
);

CREATE INDEX idx_booking_equipment_booking   ON booking_equipment (booking_id);
CREATE INDEX idx_booking_equipment_equipment ON booking_equipment (equipment_id);

-- ------------------------------------
-- VIP weekly subscriptions
-- ------------------------------------
CREATE TYPE subscription_status AS ENUM ('active', 'cancelled', 'completed');

CREATE TABLE subscriptions (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_id          UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  customer_id      UUID NOT NULL REFERENCES users(id),
  court_id         UUID NOT NULL REFERENCES courts(id),
  created_by       UUID NOT NULL REFERENCES users(id),
  status           subscription_status NOT NULL DEFAULT 'active',
  -- First occurrence; every following occurrence is +7 days
  first_start_time TIMESTAMPTZ NOT NULL,
  duration_minutes SMALLINT NOT NULL CHECK (duration_minutes >= 60 AND duration_minutes <= 720),
  term_months      SMALLINT NOT NULL CHECK (term_months IN (1, 3)),
  occurrences      SMALLINT NOT NULL CHECK (occurrences > 0),
  -- Financial snapshot at subscription time
  price_per_slot_snap NUMERIC(10,2) NOT NULL,
  weekly_price        NUMERIC(10,2) NOT NULL,
  cancelled_at     TIMESTAMPTZ,
  cancelled_by     UUID REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subscriptions_club_status ON subscriptions (club_id, status);
CREATE INDEX idx_subscriptions_customer    ON subscriptions (customer_id);

CREATE TRIGGER trg_subscriptions_updated_at
  BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Link each materialised occurrence back to its subscription
ALTER TABLE bookings
  ADD COLUMN subscription_id UUID REFERENCES subscriptions(id) ON DELETE SET NULL;

CREATE INDEX idx_bookings_subscription
  ON bookings (subscription_id)
  WHERE subscription_id IS NOT NULL;
