-- Trading Alerts App — V3 schema addition: symbol_metadata
-- Sector / industry lookup for the Sector Breakdown view.
-- Idempotent; safe to run repeatedly. Do NOT edit 001_init — this is additive.

CREATE TABLE IF NOT EXISTS symbol_metadata (
  symbol          TEXT PRIMARY KEY,
  asset_type      TEXT NOT NULL,        -- forex rows simply won't carry a sector
  sector          TEXT,
  industry        TEXT,
  last_refreshed  TIMESTAMPTZ
);
