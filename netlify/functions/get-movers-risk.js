'use strict';

const { sql } = require('./_lib/db');
const { requireUser } = require('./_lib/auth');
const { ok, methodNotAllowed, serverError } = require('./_lib/http');

// GET /api/get-movers-risk — read-only market context on the caller's own
// watchlist. Reads price_cache / watchlist / alerts ONLY — zero external API
// calls (the poll cycle already fetched every price this needs).
//
// Returns:
//   movers: watchlist rows + cached price, ranked by |percent_change| desc
//   risk:   per active alert, how far last_price is from target_value
exports.handler = async (event, context) => {
  if (event.httpMethod !== 'GET') return methodNotAllowed();

  const gate = await requireUser(event, context);
  if (gate.response) return gate.response;
  const userId = gate.user.id;

  try {
    const watch = await sql`
      SELECT w.symbol, w.asset_type,
             pc.last_price, pc.prev_close, pc.percent_change, pc.last_checked_at
      FROM watchlist w
      LEFT JOIN price_cache pc ON pc.symbol = w.symbol
      WHERE w.user_id = ${userId}`;

    const alertRows = await sql`
      SELECT a.id, a.symbol, a.asset_type, a.condition_type, a.target_value,
             a.armed, a.recurring, a.reference_price,
             pc.last_price, pc.percent_change
      FROM alerts a
      LEFT JOIN price_cache pc ON pc.symbol = a.symbol
      WHERE a.user_id = ${userId} AND a.active = TRUE`;

    const movers = watch
      .map((r) => {
        const pct = r.percent_change == null ? null : Number(r.percent_change);
        return {
          symbol: r.symbol,
          asset_type: r.asset_type,
          last_price: r.last_price == null ? null : Number(r.last_price),
          prev_close: r.prev_close == null ? null : Number(r.prev_close),
          percent_change: pct,
          last_checked_at: r.last_checked_at,
          has_price: r.last_price != null,
        };
      })
      .sort((a, b) => {
        // priced symbols first, then by absolute move
        if (a.has_price !== b.has_price) return a.has_price ? -1 : 1;
        return Math.abs(b.percent_change ?? 0) - Math.abs(a.percent_change ?? 0);
      });

    const risk = alertRows
      .map((a) => {
        const price = a.last_price == null ? null : Number(a.last_price);
        const target = Number(a.target_value);
        let distance = null;
        let distance_pct = null;
        let direction = null;

        if (price != null) {
          if (a.condition_type === 'cross_above') {
            distance = target - price; // >0 means not yet reached
            direction = 'to rise';
          } else if (a.condition_type === 'cross_below') {
            distance = price - target; // >0 means not yet reached
            direction = 'to fall';
          } else {
            // pct_change: compare current move magnitude to the target percent
            const cur =
              a.reference_price != null && Number(a.reference_price) > 0
                ? ((price - Number(a.reference_price)) / Number(a.reference_price)) * 100
                : a.percent_change == null
                ? null
                : Number(a.percent_change);
            distance = cur == null ? null : target - Math.abs(cur);
            direction = 'move %';
          }
          if (distance != null && price !== 0) {
            distance_pct = (distance / price) * 100;
          }
        }

        return {
          id: a.id,
          symbol: a.symbol,
          asset_type: a.asset_type,
          condition_type: a.condition_type,
          target_value: target,
          last_price: price,
          armed: a.armed,
          recurring: a.recurring,
          distance,
          distance_pct,
          direction,
          reached: distance != null && distance <= 0,
        };
      })
      .sort((a, b) => {
        if ((a.distance == null) !== (b.distance == null)) return a.distance == null ? 1 : -1;
        return Math.abs(a.distance_pct ?? 1e9) - Math.abs(b.distance_pct ?? 1e9);
      });

    return ok({ movers, risk });
  } catch (err) {
    console.error('[get-movers-risk]', err);
    return serverError();
  }
};
