'use strict';

const { sql } = require('./_lib/db');
const { requireUser } = require('./_lib/auth');
const { ok, methodNotAllowed, serverError } = require('./_lib/http');

// GET /api/list-alerts — caller's own alerts, newest first, with latest cached price.
exports.handler = async (event, context) => {
  if (event.httpMethod !== 'GET') return methodNotAllowed();

  const gate = await requireUser(event, context);
  if (gate.response) return gate.response;

  try {
    const rows = await sql`
      SELECT a.*,
             pc.last_price     AS cached_price,
             pc.percent_change AS cached_percent_change,
             pc.last_checked_at AS price_checked_at
      FROM alerts a
      LEFT JOIN price_cache pc ON pc.symbol = a.symbol
      WHERE a.user_id = ${gate.user.id}
      ORDER BY a.created_at DESC`;
    return ok({ alerts: rows });
  } catch (err) {
    console.error('[list-alerts]', err);
    return serverError();
  }
};
