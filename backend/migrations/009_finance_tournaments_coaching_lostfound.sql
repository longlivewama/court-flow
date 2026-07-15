-- ═══════════════════════════════════════════════════════════════
-- 009: Club expenses & net profit, tournaments with brackets,
--      coaching/training ledger, and the digital Lost & Found board.
--
-- Expenses:    operating costs (electricity, salaries, maintenance,
--              gear purchases …) logged by the owner. Net profit =
--              collected revenue − cumulative expenses.
--
-- Tournaments: owner creates a tournament with a registration fee,
--              teams register (and pay), and a single-elimination
--              bracket is generated. Every fee payment is tracked
--              per team so collected vs. outstanding is always exact.
--
-- Coaching:    coaches carry a commission percentage. Each training
--              session snapshots price / coach share / club share at
--              creation so later rate edits never rewrite history.
--
-- Lost & Found: staff photograph found items (photo stored inline as
--              bytea — these are small, non-sensitive images) and
--              customers submit claim requests.
-- ═══════════════════════════════════════════════════════════════

-- Online tournament fee payments need their own method value
ALTER TYPE payment_method_enum ADD VALUE IF NOT EXISTS 'ONLINE';

-- ------------------------------------
-- Club expenses
-- ------------------------------------
CREATE TYPE expense_category AS ENUM
  ('electricity', 'water', 'salaries', 'maintenance', 'gear', 'marketing', 'other');

CREATE TABLE expenses (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_id      UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  category     expense_category NOT NULL DEFAULT 'other',
  description  VARCHAR(255) NOT NULL,
  amount       NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_by   UUID NOT NULL REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_expenses_club_date ON expenses (club_id, expense_date);
CREATE INDEX idx_expenses_category  ON expenses (club_id, category);

CREATE TRIGGER trg_expenses_updated_at
  BEFORE UPDATE ON expenses FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ------------------------------------
-- Tournaments
-- ------------------------------------
CREATE TYPE tournament_status AS ENUM
  ('registration_open', 'in_progress', 'completed', 'cancelled');

CREATE TABLE tournaments (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_id          UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  name             VARCHAR(150) NOT NULL,
  description      TEXT,
  registration_fee NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (registration_fee >= 0),
  max_teams        SMALLINT NOT NULL DEFAULT 16 CHECK (max_teams BETWEEN 2 AND 128),
  starts_at        TIMESTAMPTZ NOT NULL,
  status           tournament_status NOT NULL DEFAULT 'registration_open',
  created_by       UUID NOT NULL REFERENCES users(id),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tournaments_club_status ON tournaments (club_id, status);

CREATE TRIGGER trg_tournaments_updated_at
  BEFORE UPDATE ON tournaments FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE tournament_teams (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tournament_id  UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  name           VARCHAR(100) NOT NULL,
  captain_id     UUID REFERENCES users(id),          -- NULL when staff-entered walk-in team
  contact_phone  VARCHAR(50),
  -- Fee snapshot at registration + running payments → exact outstanding math
  amount_due     NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (amount_due >= 0),
  amount_paid    NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  payment_method payment_method_enum NOT NULL DEFAULT 'NONE',
  paid_at        TIMESTAMPTZ,
  seed           SMALLINT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tournament_id, name)
);

CREATE INDEX idx_tournament_teams_tournament ON tournament_teams (tournament_id);
CREATE INDEX idx_tournament_teams_captain    ON tournament_teams (captain_id);

CREATE TABLE tournament_matches (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  tournament_id  UUID NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  round          SMALLINT NOT NULL CHECK (round >= 1),      -- 1 = first round
  position       SMALLINT NOT NULL CHECK (position >= 1),   -- slot within the round
  team1_id       UUID REFERENCES tournament_teams(id) ON DELETE SET NULL,
  team2_id       UUID REFERENCES tournament_teams(id) ON DELETE SET NULL,
  winner_id      UUID REFERENCES tournament_teams(id) ON DELETE SET NULL,
  score1         SMALLINT,
  score2         SMALLINT,
  played_at      TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tournament_id, round, position)
);

CREATE INDEX idx_tournament_matches_tournament ON tournament_matches (tournament_id, round);

-- ------------------------------------
-- Coaches & training sessions
-- ------------------------------------
CREATE TABLE coaches (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_id        UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  name           VARCHAR(100) NOT NULL,
  phone          VARCHAR(50),
  specialty      VARCHAR(100),
  hourly_rate    NUMERIC(10,2) NOT NULL CHECK (hourly_rate >= 0),
  -- Percentage of each session fee paid out to the coach (rest = club profit)
  commission_pct NUMERIC(5,2) NOT NULL DEFAULT 60 CHECK (commission_pct BETWEEN 0 AND 100),
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (club_id, name)
);

CREATE INDEX idx_coaches_club ON coaches (club_id, is_active);

CREATE TRIGGER trg_coaches_updated_at
  BEFORE UPDATE ON coaches FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TYPE training_status AS ENUM ('scheduled', 'completed', 'cancelled');

CREATE TABLE training_sessions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_id         UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  coach_id        UUID NOT NULL REFERENCES coaches(id),
  customer_id     UUID REFERENCES users(id),          -- NULL for walk-in trainees
  customer_name   VARCHAR(150),                       -- display name for walk-ins
  court_id        UUID REFERENCES courts(id),
  start_time      TIMESTAMPTZ NOT NULL,
  end_time        TIMESTAMPTZ NOT NULL,
  status          training_status NOT NULL DEFAULT 'scheduled',
  -- Financial snapshot at creation: price = what the client pays,
  -- coach_share = coach commission, club_share = retained profit.
  price           NUMERIC(10,2) NOT NULL CHECK (price >= 0),
  coach_share     NUMERIC(10,2) NOT NULL CHECK (coach_share >= 0),
  club_share      NUMERIC(10,2) NOT NULL CHECK (club_share >= 0),
  is_paid         BOOLEAN NOT NULL DEFAULT FALSE,
  payment_method  payment_method_enum NOT NULL DEFAULT 'NONE',
  paid_at         TIMESTAMPTZ,
  notes           TEXT,
  created_by      UUID NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_time > start_time)
);

CREATE INDEX idx_training_sessions_club_time ON training_sessions (club_id, start_time);
CREATE INDEX idx_training_sessions_coach     ON training_sessions (coach_id);
CREATE INDEX idx_training_sessions_customer  ON training_sessions (customer_id);

CREATE TRIGGER trg_training_sessions_updated_at
  BEFORE UPDATE ON training_sessions FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Starting coaching staff (owner edits rates/commission in the Coaching screen)
INSERT INTO coaches (club_id, name, specialty, hourly_rate, commission_pct)
SELECT c.id, co.name, co.specialty, co.hourly_rate, co.commission_pct
FROM clubs c,
     (VALUES
       ('Omar El-Shorbagy', 'Advanced technique & match play', 400.00, 60.00),
       ('Nour Hassan',      'Beginners & junior development',  300.00, 55.00)
     ) AS co(name, specialty, hourly_rate, commission_pct);

-- ------------------------------------
-- Lost & Found
-- ------------------------------------
CREATE TYPE lost_found_status AS ENUM ('unclaimed', 'claimed', 'returned');
CREATE TYPE claim_status      AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE lost_found_items (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  club_id      UUID NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  title        VARCHAR(150) NOT NULL,
  description  TEXT,
  court_id     UUID REFERENCES courts(id),
  found_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status       lost_found_status NOT NULL DEFAULT 'unclaimed',
  photo_data   BYTEA,
  photo_mime   VARCHAR(100),
  created_by   UUID NOT NULL REFERENCES users(id),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lost_found_club_status ON lost_found_items (club_id, status);

CREATE TRIGGER trg_lost_found_items_updated_at
  BEFORE UPDATE ON lost_found_items FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TABLE lost_found_claims (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id      UUID NOT NULL REFERENCES lost_found_items(id) ON DELETE CASCADE,
  claimant_id  UUID NOT NULL REFERENCES users(id),
  message      TEXT NOT NULL,
  status       claim_status NOT NULL DEFAULT 'pending',
  decided_by   UUID REFERENCES users(id),
  decided_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (item_id, claimant_id)
);

CREATE INDEX idx_lost_found_claims_item ON lost_found_claims (item_id, status);
