'use strict';

const { requireUser } = require('./_lib/auth');
const { ok, badRequest, methodNotAllowed, serverError } = require('./_lib/http');
const { normalizeSymbol, ASSET_TYPES } = require('./_lib/validate');
const { fetchTimeSeries, TS_INTERVALS } = require('./_lib/prices');

// GET /api/get-symbol-chart?symbol=AAPL&asset_type=stock&interval=1day&outputsize=30
// On-demand price history — proxied so TWELVE_DATA_API_KEY never reaches the
// browser. Called only when a user clicks a ticker, never on a timer.
exports.handler = async (event, context) => {
  if (event.httpMethod !== 'GET') return methodNotAllowed();

  const gate = await requireUser(event, context);
  if (gate.response) return gate.response;

  const q = event.queryStringParameters || {};
  const assetType = ASSET_TYPES.includes(q.asset_type) ? q.asset_type : 'stock';
  const symbol = normalizeSymbol(q.symbol, assetType);
  if (!symbol) return badRequest('Invalid or missing symbol');

  const interval = TS_INTERVALS.includes(q.interval) ? q.interval : '1day';
  const outputsize = q.outputsize || 30;

  try {
    const series = await fetchTimeSeries(symbol, { interval, outputsize });
    if (!series.points.length) return badRequest('No price history available for this symbol');
    return ok(series);
  } catch (err) {
    console.error('[get-symbol-chart]', err.message);
    return serverError(err.message);
  }
};
