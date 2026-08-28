'use strict';

const TWELVE_DATA_KEY = process.env.TWELVE_DATA_API_KEY;
const FINNHUB_KEY = process.env.FINNHUB_API_KEY;

const TD_BATCH_SIZE = 8; // Twelve Data free tier: 8 requests/min. One batch call = one request.

function num(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Fetch quotes for a list of symbols from Twelve Data in comma-batched calls.
 * Returns a Map<symbol, {last_price, prev_close, percent_change}> for the
 * symbols that resolved. Symbols missing from the map failed.
 */
async function fetchTwelveData(symbols) {
  const out = new Map();
  if (!TWELVE_DATA_KEY || symbols.length === 0) return out;

  for (let i = 0; i < symbols.length; i += TD_BATCH_SIZE) {
    const chunk = symbols.slice(i, i + TD_BATCH_SIZE);
    const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(
      chunk.join(',')
    )}&apikey=${TWELVE_DATA_KEY}`;

    let payload;
    try {
      const res = await fetch(url);
      payload = await res.json();
    } catch (err) {
      console.error('[prices] Twelve Data request failed:', err.message);
      continue; // leave this chunk's symbols unresolved
    }

    // Single-symbol responses are a flat object; batched responses are keyed by symbol.
    const entries =
      chunk.length === 1 ? { [chunk[0]]: payload } : payload;

    for (const symbol of chunk) {
      const q = entries && entries[symbol];
      if (!q || q.status === 'error' || q.code) {
        if (q && q.message) console.warn(`[prices] TD ${symbol}: ${q.message}`);
        continue;
      }
      const last = num(q.close ?? q.price);
      if (last === null) continue;
      out.set(symbol, {
        last_price: last,
        prev_close: num(q.previous_close),
        percent_change: num(q.percent_change),
      });
    }
  }
  return out;
}

/** Single-symbol stock fallback via Finnhub. Returns the quote object or null. */
async function fetchFinnhubStock(symbol) {
  if (!FINNHUB_KEY) return null;
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`
    );
    const q = await res.json();
    const last = num(q.c);
    if (last === null || last === 0) return null;
    return {
      last_price: last,
      prev_close: num(q.pc),
      percent_change: num(q.dp),
    };
  } catch (err) {
    console.error(`[prices] Finnhub ${symbol} failed:`, err.message);
    return null;
  }
}

/**
 * Resolve quotes for symbols described as [{symbol, asset_type}].
 * Twelve Data first (batched); for any *stock* that fails, retry once via Finnhub.
 * Forex failures are simply omitted (caller must not advance next_check_due).
 *
 * Returns Map<symbol, {last_price, prev_close, percent_change, source}>.
 */
async function resolveQuotes(symbolSpecs) {
  const uniq = new Map();
  for (const s of symbolSpecs) {
    if (!uniq.has(s.symbol)) uniq.set(s.symbol, s.asset_type);
  }
  const symbols = [...uniq.keys()];

  const td = await fetchTwelveData(symbols);
  const result = new Map();
  for (const [sym, q] of td) result.set(sym, { ...q, source: 'twelve_data' });

  const missingStocks = symbols.filter(
    (s) => !result.has(s) && uniq.get(s) === 'stock'
  );
  for (const sym of missingStocks) {
    const q = await fetchFinnhubStock(sym);
    if (q) result.set(sym, { ...q, source: 'finnhub' });
  }

  return result;
}

/**
 * On-demand price history for one symbol via Twelve Data /time_series.
 * Used only when a user clicks a ticker — never on the poll cycle.
 * Returns { symbol, interval, points: [{ datetime, close }] } oldest-first, or
 * throws with a readable message.
 */
const TS_INTERVALS = ['1min', '5min', '15min', '30min', '1h', '1day', '1week', '1month'];

async function fetchTimeSeries(symbol, { interval = '1day', outputsize = 30 } = {}) {
  if (!TWELVE_DATA_KEY) throw new Error('TWELVE_DATA_API_KEY not set');
  const iv = TS_INTERVALS.includes(interval) ? interval : '1day';
  const size = Math.min(Math.max(parseInt(outputsize, 10) || 30, 5), 200);
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(
    symbol
  )}&interval=${iv}&outputsize=${size}&apikey=${TWELVE_DATA_KEY}`;

  let payload;
  try {
    const res = await fetch(url);
    payload = await res.json();
  } catch (err) {
    throw new Error(`price history request failed: ${err.message}`);
  }
  if (!payload || payload.status === 'error') {
    throw new Error(payload && payload.message ? payload.message : 'price history unavailable');
  }
  const values = Array.isArray(payload.values) ? payload.values : [];
  const points = values
    .map((v) => ({ datetime: v.datetime, close: num(v.close) }))
    .filter((p) => p.close !== null)
    .reverse(); // Twelve Data returns newest-first
  return { symbol, interval: iv, points };
}

/**
 * Sector / industry for one stock symbol. Twelve Data's company-profile data
 * is not reliably on the free tier, so this uses Finnhub's /stock/profile2
 * (same key already configured for the price fallback). Returns
 * { sector, industry } — either may be null — or null if nothing resolved.
 */
async function fetchSymbolProfile(symbol) {
  if (!FINNHUB_KEY) return null;
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${FINNHUB_KEY}`
    );
    const p = await res.json();
    if (!p || (!p.finnhubIndustry && !p.name)) return null;
    const industry = p.finnhubIndustry ? String(p.finnhubIndustry) : null;
    return { sector: industry, industry };
  } catch (err) {
    console.error(`[prices] Finnhub profile ${symbol} failed:`, err.message);
    return null;
  }
}

module.exports = {
  resolveQuotes,
  fetchTwelveData,
  fetchFinnhubStock,
  fetchTimeSeries,
  fetchSymbolProfile,
  TS_INTERVALS,
};
