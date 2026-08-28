'use strict';

const { sql } = require('./_lib/db');
const { resolveQuotes } = require('./_lib/prices');
const { notifyAlert } = require('./_lib/notify');

function pctChange(alert, quote) {
  if (alert.reference_price != null && Number(alert.reference_price) > 0) {
    const ref = Number(alert.reference_price);
    return ((quote.last_price - ref) / ref) * 100;
  }
  if (quote.percent_change != null) return Number(quote.percent_change);
  if (quote.prev_close != null && Number(quote.prev_close) > 0) {
    return ((quote.last_price - Number(quote.prev_close)) / Number(quote.prev_close)) * 100;
  }
  return null;
}

// Would this alert's condition fire right now, given a fresh quote?
function conditionMet(alert, quote) {
  const target = Number(alert.target_value);
  switch (alert.condition_type) {
    case 'cross_above':
      return quote.last_price >= target;
    case 'cross_below':
      return quote.last_price <= target;
    case 'pct_change': {
      const p = pctChange(alert, quote);
      return p != null && Math.abs(p) >= target;
    }
    default:
      return false;
  }
}

function formatMessage(alert, quote) {
  const p = pctChange(alert, quote);
  const priceStr = quote.last_price;
  const mins = Math.round(alert.poll_interval_seconds / 60);
  let cond;
  if (alert.condition_type === 'cross_above') cond = `rose to/above ${alert.target_value}`;
  else if (alert.condition_type === 'cross_below') cond = `fell to/below ${alert.target_value}`;
  else cond = `moved ${p != null ? p.toFixed(2) : '?'}% (target ${alert.target_value}%)`;

  return [
    `🔔 ${alert.symbol} ${cond}`,
    `Current price: ${priceStr}`,
    p != null ? `Change: ${p.toFixed(2)}%` : null,
    `(polled every ${mins} min — not tick-level)`,
  ]
    .filter(Boolean)
    .join('\n');
}

async function run() {
  const started = Date.now();

  const dueAlerts = await sql`
    SELECT a.*,
           u.telegram_chat_id,
           u.onesignal_player_id
    FROM alerts a
    JOIN users u ON u.id = a.user_id
    WHERE a.active = TRUE AND a.next_check_due <= now()
    ORDER BY a.symbol`;

  if (dueAlerts.length === 0) {
    return { checked: 0, note: 'no alerts due' };
  }

  // Unique symbol set for this cycle (dedup — one fetch per symbol, never per alert/user).
  const specMap = new Map();
  for (const a of dueAlerts) {
    if (!specMap.has(a.symbol)) specMap.set(a.symbol, { symbol: a.symbol, asset_type: a.asset_type });
  }
  const specs = [...specMap.values()];

  let quotes;
  try {
    quotes = await resolveQuotes(specs);
  } catch (err) {
    console.error('[poll-alerts] price resolution failed entirely:', err);
    quotes = new Map();
  }

  // Persist fresh prices to price_cache.
  for (const [symbol, q] of quotes) {
    const assetType = specMap.get(symbol).asset_type;
    try {
      await sql`
        INSERT INTO price_cache (symbol, asset_type, last_price, prev_close, percent_change, last_checked_at)
        VALUES (${symbol}, ${assetType}, ${q.last_price}, ${q.prev_close ?? null}, ${q.percent_change ?? null}, now())
        ON CONFLICT (symbol) DO UPDATE SET
          asset_type = EXCLUDED.asset_type,
          last_price = EXCLUDED.last_price,
          prev_close = EXCLUDED.prev_close,
          percent_change = EXCLUDED.percent_change,
          last_checked_at = EXCLUDED.last_checked_at`;
    } catch (err) {
      console.error(`[poll-alerts] price_cache upsert ${symbol}:`, err.message);
    }
  }

  let triggered = 0;
  let evaluated = 0;
  let skippedNoPrice = 0;

  for (const alert of dueAlerts) {
    const quote = quotes.get(alert.symbol);

    if (!quote) {
      // No fresh price this cycle — leave next_check_due untouched so it retries.
      skippedNoPrice++;
      continue;
    }

    evaluated++;
    const met = conditionMet(alert, quote);
    let armed = alert.armed;

    // Re-arm: a recurring alert that previously fired stays disarmed until the
    // price crosses back to the non-triggering side of the threshold.
    if (!armed && !met) {
      armed = true;
      await sql`UPDATE alerts SET armed = TRUE WHERE id = ${alert.id}`;
    }

    const willFire = met && armed;

    if (willFire) {
      triggered++;
      const message = formatMessage(alert, quote);
      await notifyAlert(alert, alert, message);

      if (alert.recurring) {
        await sql`
          UPDATE alerts SET
            last_triggered_at = now(),
            armed = FALSE,
            next_check_due = now() + make_interval(secs => ${alert.poll_interval_seconds})
          WHERE id = ${alert.id}`;
      } else {
        await sql`
          UPDATE alerts SET
            last_triggered_at = now(),
            active = FALSE,
            next_check_due = now() + make_interval(secs => ${alert.poll_interval_seconds})
          WHERE id = ${alert.id}`;
      }
    } else {
      await sql`
        UPDATE alerts SET
          next_check_due = now() + make_interval(secs => ${alert.poll_interval_seconds})
        WHERE id = ${alert.id}`;
    }
  }

  const summary = {
    checked: dueAlerts.length,
    symbols: specs.length,
    prices_resolved: quotes.size,
    evaluated,
    triggered,
    skipped_no_price: skippedNoPrice,
    ms: Date.now() - started,
  };
  console.log('[poll-alerts]', JSON.stringify(summary));
  return summary;
}

exports.handler = async () => {
  try {
    const summary = await run();
    return { statusCode: 200, body: JSON.stringify(summary) };
  } catch (err) {
    console.error('[poll-alerts] fatal:', err);
    // Return 200 so Netlify doesn't treat the scheduled run as a hard failure loop;
    // the error is logged and the next cycle will retry.
    return { statusCode: 200, body: JSON.stringify({ error: err.message }) };
  }
};
