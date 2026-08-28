'use strict';

const { sql } = require('./_lib/db');
const { requireUser } = require('./_lib/auth');
const { ok, methodNotAllowed, serverError } = require('./_lib/http');

// GET /api/get-sector-breakdown — the caller's *stock* watchlist grouped by
// sector (from symbol_metadata, refreshed by the refresh-symbol-metadata cron).
// Forex is excluded. Symbols with no metadata row yet land in `unknown`.
exports.handler = async (event, context) => {
  if (event.httpMethod !== 'GET') return methodNotAllowed();

  const gate = await requireUser(event, context);
  if (gate.response) return gate.response;

  try {
    const rows = await sql`
      SELECT w.symbol,
             sm.sector, sm.industry,
             pc.last_price, pc.percent_change
      FROM watchlist w
      LEFT JOIN symbol_metadata sm ON sm.symbol = w.symbol
      LEFT JOIN price_cache pc     ON pc.symbol = w.symbol
      WHERE w.user_id = ${gate.user.id} AND w.asset_type = 'stock'
      ORDER BY w.symbol`;

    const bySector = new Map();
    const unknown = [];

    for (const r of rows) {
      const entry = {
        symbol: r.symbol,
        industry: r.industry || null,
        last_price: r.last_price == null ? null : Number(r.last_price),
        percent_change: r.percent_change == null ? null : Number(r.percent_change),
      };
      if (!r.sector) {
        unknown.push(entry);
        continue;
      }
      if (!bySector.has(r.sector)) bySector.set(r.sector, []);
      bySector.get(r.sector).push(entry);
    }

    const sectors = [...bySector.entries()]
      .map(([sector, symbols]) => ({ sector, count: symbols.length, symbols }))
      .sort((a, b) => b.count - a.count || a.sector.localeCompare(b.sector));

    return ok({
      sectors,
      unknown,
      total: rows.length,
      classified: rows.length - unknown.length,
    });
  } catch (err) {
    console.error('[get-sector-breakdown]', err);
    return serverError();
  }
};
