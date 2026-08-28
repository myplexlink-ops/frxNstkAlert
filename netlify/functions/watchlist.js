'use strict';

const { sql } = require('./_lib/db');
const { requireUser } = require('./_lib/auth');
const {
  ok, badRequest, notFound, methodNotAllowed, serverError, parseBody,
} = require('./_lib/http');
const { normalizeSymbol, ASSET_TYPES } = require('./_lib/validate');

// GET    /api/watchlist            -> { items: [...] }
// POST   /api/watchlist  {symbol, asset_type}
// DELETE /api/watchlist  {id} | ?id=
exports.handler = async (event, context) => {
  const gate = await requireUser(event, context);
  if (gate.response) return gate.response;
  const userId = gate.user.id;

  try {
    if (event.httpMethod === 'GET') {
      const items = await sql`
        SELECT w.*, pc.last_price AS cached_price, pc.percent_change AS cached_percent_change
        FROM watchlist w
        LEFT JOIN price_cache pc ON pc.symbol = w.symbol
        WHERE w.user_id = ${userId}
        ORDER BY w.asset_type, w.symbol`;
      return ok({ items });
    }

    if (event.httpMethod === 'POST') {
      const body = parseBody(event);
      if (body === null) return badRequest('Invalid JSON');
      if (!ASSET_TYPES.includes(body.asset_type)) return badRequest('asset_type must be forex or stock');
      const symbol = normalizeSymbol(body.symbol, body.asset_type);
      if (!symbol) return badRequest('Invalid symbol');
      const rows = await sql`
        INSERT INTO watchlist (user_id, symbol, asset_type)
        VALUES (${userId}, ${symbol}, ${body.asset_type})
        ON CONFLICT (user_id, symbol) DO UPDATE SET asset_type = EXCLUDED.asset_type
        RETURNING *`;
      return ok({ item: rows[0] });
    }

    if (event.httpMethod === 'DELETE') {
      const body = parseBody(event) || {};
      const id = body.id || (event.queryStringParameters && event.queryStringParameters.id);
      if (!id) return badRequest('id is required');
      const rows = await sql`
        DELETE FROM watchlist WHERE id = ${id} AND user_id = ${userId} RETURNING id`;
      if (rows.length === 0) return notFound('Not found');
      return ok({ deleted: rows[0].id });
    }

    return methodNotAllowed();
  } catch (err) {
    console.error('[watchlist]', err);
    return serverError();
  }
};
