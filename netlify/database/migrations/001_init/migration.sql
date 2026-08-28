-- Trading Alerts App — Postgres schema (Netlify Database / Neon)
-- Safe to run repeatedly.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id                   UUID PRIMARY KEY,               -- matches Netlify Identity user id
  email                TEXT UNIQUE NOT NULL,
  approved             BOOLEAN NOT NULL DEFAULT FALSE,
  is_admin             BOOLEAN NOT NULL DEFAULT FALSE,
  telegram_chat_id     TEXT,
  telegram_link_code   TEXT,
  onesignal_player_id  TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS watchlist (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol      TEXT NOT NULL,
  asset_type  TEXT NOT NULL CHECK (asset_type IN ('forex','stock')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, symbol)
);

CREATE TABLE IF NOT EXISTS alerts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol                TEXT NOT NULL,
  asset_type            TEXT NOT NULL CHECK (asset_type IN ('forex','stock')),
  condition_type        TEXT NOT NULL CHECK (condition_type IN ('cross_above','cross_below','pct_change')),
  target_value          NUMERIC NOT NULL,
  reference_price       NUMERIC,
  poll_interval_seconds INTEGER NOT NULL CHECK (poll_interval_seconds BETWEEN 60 AND 300),
  recurring             BOOLEAN NOT NULL DEFAULT FALSE,
  active                BOOLEAN NOT NULL DEFAULT TRUE,
  armed                 BOOLEAN NOT NULL DEFAULT TRUE,
  last_triggered_at     TIMESTAMPTZ,
  next_check_due        TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS price_cache (
  symbol          TEXT PRIMARY KEY,
  asset_type      TEXT NOT NULL,
  last_price      NUMERIC,
  prev_close      NUMERIC,
  percent_change  NUMERIC,
  last_checked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS notification_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id    UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  channel     TEXT NOT NULL CHECK (channel IN ('telegram','onesignal')),
  status      TEXT NOT NULL CHECK (status IN ('sent','failed')),
  error       TEXT,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_alerts_next_check ON alerts (next_check_due) WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_alerts_symbol     ON alerts (symbol)        WHERE active = TRUE;
CREATE INDEX IF NOT EXISTS idx_alerts_user       ON alerts (user_id);
CREATE INDEX IF NOT EXISTS idx_notiflog_alert    ON notification_log (alert_id);
