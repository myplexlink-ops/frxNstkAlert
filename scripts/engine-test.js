'use strict';
const path = require('path');
const FN = path.join(process.cwd(), 'netlify', 'functions');

// ---- in-memory DB ----
let alerts = [];
let priceCache = {};
let notifLog = [];
const now = () => new Date();

function fakeSql(strings, ...vals) {
  const q = strings.join('?').replace(/\s+/g, ' ').trim();
  // crude router for the exact queries poll-alerts uses
  if (q.startsWith('SELECT a.*, u.telegram_chat_id')) {
    return Promise.resolve(
      alerts.filter(a => a.active && a.next_check_due <= now())
        .map(a => ({ ...a, telegram_chat_id: 'tg123', onesignal_player_id: null }))
    );
  }
  if (q.startsWith('INSERT INTO price_cache')) {
    const [symbol, asset_type, last_price, prev_close, percent_change] = vals;
    priceCache[symbol] = { symbol, asset_type, last_price, prev_close, percent_change };
    return Promise.resolve([]);
  }
  if (q.startsWith('UPDATE alerts SET armed = TRUE WHERE id =')) {
    const a = alerts.find(x => x.id === vals[0]); if (a) a.armed = true;
    return Promise.resolve([]);
  }
  if (q.startsWith('UPDATE alerts SET last_triggered_at = now(), armed = FALSE')) {
    const a = alerts.find(x => x.id === vals[1]);
    if (a) { a.last_triggered_at = now(); a.armed = false;
      a.next_check_due = new Date(Date.now() + vals[0] * 1000); }
    return Promise.resolve([]);
  }
  if (q.startsWith('UPDATE alerts SET last_triggered_at = now(), active = FALSE')) {
    const a = alerts.find(x => x.id === vals[1]);
    if (a) { a.last_triggered_at = now(); a.active = false;
      a.next_check_due = new Date(Date.now() + vals[0] * 1000); }
    return Promise.resolve([]);
  }
  if (q.startsWith('UPDATE alerts SET next_check_due = now() + make_interval')) {
    const a = alerts.find(x => x.id === vals[1]);
    if (a) a.next_check_due = new Date(Date.now() + vals[0] * 1000);
    return Promise.resolve([]);
  }
  if (q.startsWith('INSERT INTO notification_log')) {
    notifLog.push({ alert_id: vals[0], channel: vals[1], status: vals[2] });
    return Promise.resolve([]);
  }
  throw new Error('unhandled query: ' + q.slice(0, 80));
}

// ---- inject fakes into require cache ----
function stub(rel, exports) {
  const p = require.resolve(path.join(FN, rel));
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}
stub('_lib/db.js', { sql: fakeSql });

let quoteMap = new Map();
stub('_lib/prices.js', { resolveQuotes: () => Promise.resolve(quoteMap) });

let notified = [];
stub('_lib/notify.js', {
  notifyAlert: (alert, user, msg) => { notified.push({ id: alert.id, msg }); return Promise.resolve(); },
});

const { handler } = require(path.join(FN, 'poll-alerts.js'));

// ---- helpers ----
function mkAlert(o) {
  return Object.assign({
    id: o.id, user_id: 'u1', symbol: o.symbol, asset_type: o.asset_type || 'stock',
    condition_type: o.condition_type, target_value: o.target_value,
    reference_price: o.reference_price ?? null, poll_interval_seconds: o.poll_interval_seconds || 60,
    recurring: !!o.recurring, active: true, armed: o.armed ?? true,
    last_triggered_at: null, next_check_due: new Date(Date.now() - 1000),
  }, {});
}
let passed = 0, failed = 0;
function assert(name, cond) { if (cond) { passed++; console.log('  PASS', name); }
  else { failed++; console.log('  FAIL', name); } }

async function scenario(name, fn) { console.log('\n# ' + name);
  alerts = []; priceCache = {}; notifLog = []; notified = []; quoteMap = new Map();
  await fn();
}

(async () => {
  // 1. dedup: two users, same symbol -> one price fetch
  await scenario('dedup one fetch per symbol', async () => {
    let calls = 0;
    stub('_lib/prices.js', { resolveQuotes: (specs) => { calls++;
      assert('resolveQuotes got 1 unique symbol', specs.length === 1);
      return Promise.resolve(new Map([['AAPL', { last_price: 200, prev_close: 190, percent_change: 5 }]])); } });
    delete require.cache[require.resolve(path.join(FN, 'poll-alerts.js'))];
    const h = require(path.join(FN, 'poll-alerts.js')).handler;
    alerts = [
      mkAlert({ id: 'a1', symbol: 'AAPL', condition_type: 'cross_above', target_value: 999 }),
      mkAlert({ id: 'a2', symbol: 'AAPL', condition_type: 'cross_below', target_value: 1 }),
    ];
    await h();
    assert('resolveQuotes called once', calls === 1);
    // restore default stub
    stub('_lib/prices.js', { resolveQuotes: () => Promise.resolve(quoteMap) });
    delete require.cache[require.resolve(path.join(FN, 'poll-alerts.js'))];
  });

  const H = () => require(path.join(FN, 'poll-alerts.js')).handler;

  // 2. one-time alert deactivates after firing
  await scenario('one-time deactivates', async () => {
    quoteMap = new Map([['AAPL', { last_price: 210, prev_close: 200, percent_change: 5 }]]);
    alerts = [mkAlert({ id: 'a1', symbol: 'AAPL', condition_type: 'cross_above', target_value: 205, recurring: false })];
    await H()();
    assert('fired once', notified.length === 1);
    assert('now inactive', alerts[0].active === false);
    notified = [];
    alerts[0].next_check_due = new Date(Date.now() - 1000);
    await H()();
    assert('does not fire again (inactive)', notified.length === 0);
  });

  // 3. recurring: no double fire while past threshold, re-arms after crossing back
  await scenario('recurring re-arm', async () => {
    alerts = [mkAlert({ id: 'a1', symbol: 'AAPL', condition_type: 'cross_above', target_value: 100, recurring: true })];
    quoteMap = new Map([['AAPL', { last_price: 110, prev_close: 100, percent_change: 10 }]]);
    await H()();
    assert('fired first time', notified.length === 1);
    assert('disarmed', alerts[0].armed === false);

    notified = []; alerts[0].next_check_due = new Date(Date.now() - 1000);
    await H()();  // still above target
    assert('no double fire while above', notified.length === 0);
    assert('still disarmed', alerts[0].armed === false);

    notified = []; alerts[0].next_check_due = new Date(Date.now() - 1000);
    quoteMap = new Map([['AAPL', { last_price: 90, prev_close: 100, percent_change: -10 }]]);
    await H()();  // crossed back below
    assert('re-armed after crossing back', alerts[0].armed === true);
    assert('no fire on the re-arm cycle', notified.length === 0);

    notified = []; alerts[0].next_check_due = new Date(Date.now() - 1000);
    quoteMap = new Map([['AAPL', { last_price: 115, prev_close: 100, percent_change: 15 }]]);
    await H()();
    assert('fires again after re-arm + re-cross', notified.length === 1);
  });

  // 4. forex failure -> skipped, next_check_due unchanged
  await scenario('forex failure skips cycle', async () => {
    const due = new Date(Date.now() - 5000);
    alerts = [mkAlert({ id: 'a1', symbol: 'EUR/USD', asset_type: 'forex', condition_type: 'cross_above', target_value: 1 })];
    alerts[0].next_check_due = due;
    quoteMap = new Map(); // nothing resolved
    await H()();
    assert('not fired', notified.length === 0);
    assert('next_check_due unchanged', alerts[0].next_check_due === due);
  });

  // 5. per-alert interval respected
  await scenario('per-alert interval', async () => {
    quoteMap = new Map([['AAPL', { last_price: 50, prev_close: 50, percent_change: 0 }]]);
    alerts = [
      mkAlert({ id: 'fast', symbol: 'AAPL', condition_type: 'cross_above', target_value: 999, poll_interval_seconds: 60 }),
      mkAlert({ id: 'slow', symbol: 'AAPL', condition_type: 'cross_above', target_value: 999, poll_interval_seconds: 300 }),
    ];
    await H()();
    const fast = alerts.find(a => a.id === 'fast'), slow = alerts.find(a => a.id === 'slow');
    const df = (fast.next_check_due - Date.now()) / 1000;
    const ds = (slow.next_check_due - Date.now()) / 1000;
    assert('fast ~60s', df > 40 && df < 75);
    assert('slow ~300s', ds > 270 && ds < 320);
  });

  // 6. pct_change with reference_price
  await scenario('pct_change vs reference_price', async () => {
    quoteMap = new Map([['AAPL', { last_price: 105, prev_close: 104, percent_change: 1 }]]);
    alerts = [mkAlert({ id: 'a1', symbol: 'AAPL', condition_type: 'pct_change', target_value: 4, reference_price: 100 })];
    await H()();
    assert('fires: 5% move vs ref 100 >= 4%', notified.length === 1);
  });

  console.log('\n----------------------------------------');
  console.log(`total: ${passed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})();
