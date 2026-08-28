'use strict';

const ASSET_TYPES = ['forex', 'stock'];
const CONDITION_TYPES = ['cross_above', 'cross_below', 'pct_change'];

function normalizeSymbol(raw, assetType) {
  if (typeof raw !== 'string') return null;
  let s = raw.trim().toUpperCase();
  if (!s) return null;
  if (assetType === 'forex') {
    // Accept "EURUSD" or "EUR/USD" -> "EUR/USD"
    if (/^[A-Z]{6}$/.test(s)) s = `${s.slice(0, 3)}/${s.slice(3)}`;
    if (!/^[A-Z]{3}\/[A-Z]{3}$/.test(s)) return null;
  } else {
    if (!/^[A-Z0-9.\-:]{1,15}$/.test(s)) return null;
  }
  return s;
}

/** Validate an alert payload. Returns { value } or { error }. */
function validateAlert(body, { partial = false } = {}) {
  if (!body || typeof body !== 'object') return { error: 'Invalid JSON body' };
  const out = {};

  const need = (k) => !partial || body[k] !== undefined;

  if (need('asset_type')) {
    if (!ASSET_TYPES.includes(body.asset_type)) return { error: 'asset_type must be forex or stock' };
    out.asset_type = body.asset_type;
  }

  if (need('symbol')) {
    const at = out.asset_type || body.asset_type;
    const sym = normalizeSymbol(body.symbol, at);
    if (!sym) return { error: 'symbol is invalid for the given asset_type' };
    out.symbol = sym;
  }

  if (need('condition_type')) {
    if (!CONDITION_TYPES.includes(body.condition_type)) {
      return { error: 'condition_type must be cross_above, cross_below or pct_change' };
    }
    out.condition_type = body.condition_type;
  }

  if (need('target_value')) {
    const t = Number(body.target_value);
    if (!Number.isFinite(t)) return { error: 'target_value must be a number' };
    const ct = out.condition_type || body.condition_type;
    if (ct === 'pct_change' && t <= 0) return { error: 'target_value (percent) must be > 0' };
    if ((ct === 'cross_above' || ct === 'cross_below') && t <= 0) {
      return { error: 'target_value (price) must be > 0' };
    }
    out.target_value = t;
  }

  if (body.reference_price !== undefined && body.reference_price !== null && body.reference_price !== '') {
    const r = Number(body.reference_price);
    if (!Number.isFinite(r) || r <= 0) return { error: 'reference_price must be a positive number' };
    out.reference_price = r;
  } else if (body.reference_price === null || body.reference_price === '') {
    out.reference_price = null;
  }

  if (need('poll_interval_seconds')) {
    const p = Math.round(Number(body.poll_interval_seconds));
    if (!Number.isFinite(p) || p < 60 || p > 300) {
      return { error: 'poll_interval_seconds must be between 60 and 300' };
    }
    out.poll_interval_seconds = p;
  }

  if (body.recurring !== undefined) out.recurring = body.recurring === true;
  if (body.active !== undefined) out.active = body.active === true;

  return { value: out };
}

module.exports = { validateAlert, normalizeSymbol, ASSET_TYPES, CONDITION_TYPES };
