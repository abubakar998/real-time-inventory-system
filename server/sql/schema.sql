-- =============================================================================
--  Real-Time Inventory System — canonical schema
--  Idempotent: safe to run repeatedly (`npm run db:migrate`).
--  Sequelize models mirror this file; sequelize.sync() is intentionally never
--  called, so this file is the single source of truth for the database shape.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- users
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  id          SERIAL       PRIMARY KEY,
  username    VARCHAR(32)  NOT NULL CHECK (length(btrim(username)) BETWEEN 2 AND 32),
  created_at  TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness: "Bakar" and "bakar" are the same shopper.
CREATE UNIQUE INDEX IF NOT EXISTS users_username_lower_key
  ON users (lower(username));

-- -----------------------------------------------------------------------------
-- drops
--
-- Stock is modelled as three counters rather than one mutable "available"
-- column, so every unit is always accounted for:
--
--     available = total_stock - reserved_count - sold_count
--
-- reserved_count is the "soft hold" bucket. Reserving moves a unit from
-- available -> reserved. Purchasing moves it reserved -> sold. Expiring moves
-- it reserved -> available. Nothing is ever destroyed, which makes the whole
-- system auditable and makes the oversell guard expressible as a CHECK.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS drops (
  id             SERIAL       PRIMARY KEY,
  name           VARCHAR(120) NOT NULL CHECK (length(btrim(name)) > 0),
  description    TEXT,
  image_url      TEXT,
  price_cents    INTEGER      NOT NULL CHECK (price_cents >= 0),

  total_stock    INTEGER      NOT NULL CHECK (total_stock >= 0),
  reserved_count INTEGER      NOT NULL DEFAULT 0 CHECK (reserved_count >= 0),
  sold_count     INTEGER      NOT NULL DEFAULT 0 CHECK (sold_count >= 0),

  -- Per-drop hold window. Defaults to the 60s required by the spec, but a drop
  -- can be created with a different window (handy for demos / stress tests).
  reservation_window_seconds INTEGER NOT NULL DEFAULT 60
    CHECK (reservation_window_seconds BETWEEN 5 AND 3600),

  starts_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),
  ends_at        TIMESTAMPTZ,

  created_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),

  -- The last line of defence against overselling. Even if application logic
  -- were buggy, Postgres refuses to let holds + sales exceed the drop size.
  CONSTRAINT drops_no_oversell CHECK (reserved_count + sold_count <= total_stock),
  CONSTRAINT drops_window_valid CHECK (ends_at IS NULL OR ends_at > starts_at)
);

CREATE INDEX IF NOT EXISTS drops_starts_at_idx ON drops (starts_at DESC, id DESC);

-- -----------------------------------------------------------------------------
-- reservations
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  CREATE TYPE reservation_status AS ENUM ('active', 'completed', 'expired', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

CREATE TABLE IF NOT EXISTS reservations (
  id         SERIAL              PRIMARY KEY,
  drop_id    INTEGER             NOT NULL REFERENCES drops (id) ON DELETE CASCADE,
  user_id    INTEGER             NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status     reservation_status  NOT NULL DEFAULT 'active',
  expires_at TIMESTAMPTZ         NOT NULL,
  created_at TIMESTAMPTZ         NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ         NOT NULL DEFAULT now()
);

-- One live hold per user per drop. A *partial* unique index, so a user can
-- reserve the same drop again after an earlier hold expired or completed.
CREATE UNIQUE INDEX IF NOT EXISTS reservations_one_active_per_user_drop
  ON reservations (drop_id, user_id)
  WHERE status = 'active';

-- Drives the expiry sweeper: only live holds are indexed, so the sweep query
-- stays O(due rows) no matter how much historical data accumulates.
CREATE INDEX IF NOT EXISTS reservations_due_idx
  ON reservations (expires_at)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS reservations_user_idx
  ON reservations (user_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- purchases
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchases (
  id             SERIAL      PRIMARY KEY,
  drop_id        INTEGER     NOT NULL REFERENCES drops (id) ON DELETE CASCADE,
  user_id        INTEGER     NOT NULL REFERENCES users (id) ON DELETE CASCADE,

  -- UNIQUE: a reservation can be converted into at most one purchase, ever.
  -- Belt-and-braces against a double-submitted "Complete Purchase" click.
  reservation_id INTEGER     NOT NULL UNIQUE REFERENCES reservations (id) ON DELETE CASCADE,

  -- Price is snapshotted at purchase time; editing a drop's price later must
  -- not rewrite history.
  price_cents    INTEGER     NOT NULL CHECK (price_cents >= 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Serves the "top 3 most recent purchasers per drop" activity feed.
CREATE INDEX IF NOT EXISTS purchases_feed_idx
  ON purchases (drop_id, created_at DESC, id DESC);

COMMIT;
