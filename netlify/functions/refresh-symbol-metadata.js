'use strict';

const { sql } = require('./_lib/db');
const { fetchSymbolProfile } = require('./_lib/prices');

// Scheduled (daily). Fills symbol_metadata.sector/industry for every stock
// symbol that appears in any user's watchlist and hasn't been refreshed lately.
// Follows poll-alerts.js's structure: never throws out, returns 200 with a
// summary so a failed run doesn't trip Netlify's scheduled-function alarm.

const STALE_DAYS = 7;
const MAX_PER_RUN = 40; // Finnhub free tier is 60 req/min — stay well under

async function run() {
  const started = Date.now();

  const rows = await sql`
    SELECT DISTINCT w.symbol
    FROM watchlist w
    WHERE w.asset_type = 'stock'
      AND NOT EXISTS (
        SELECT 1 FROM symbol_metadata sm
        WHERE sm.symbol = w.symbol
          AND sm.last_refreshed > now() - make_interval(days => ${STALE_DAYS})
      )
    ORDER BY w.symbol
    LIMIT ${MAX_PER_RUN}`;

  let refreshed = 0;
  let missed = 0;

  for (const { symbol } of rows) {
    let profile = null;
    try {
      profile = await fetchSymbolProfile(symbol);
    } catch (err) {
      console.error(`[refresh-symbol-metadata] ${symbol}:`, err.message);
    }

    try {
      await sql`
        INSERT INTO symbol_metadata (symbol, asset_type, sector, industry, last_refreshed)
        VALUES (${symbol}, 'stock', ${profile?.sector ?? null}, ${profile?.industry ?? null}, now())
        ON CONFLICT (symbol) DO UPDATE SET
          asset_type = 'stock',
          sector = COALESCE(EXCLUDED.sector, symbol_metadata.sector),
          industry = COALESCE(EXCLUDED.industry, symbol_metadata.industry),
          last_refreshed = now()`;
      if (profile && profile.sector) refreshed++;
      else missed++;
    } catch (err) {
      console.error(`[refresh-symbol-metadata] upsert ${symbol}:`, err.message);
      missed++;
    }
  }

  const summary = { candidates: rows.length, refreshed, missed, ms: Date.now() - started };
  console.log('[refresh-symbol-metadata]', JSON.stringify(summary));
  return summary;
}

exports.handler = async () => {
  try {
    return { statusCode: 200, body: JSON.stringify(await run()) };
  } catch (err) {
    console.error('[refresh-symbol-metadata] fatal:', err);
    return { statusCode: 200, body: JSON.stringify({ error: err.message }) };
  }
};
