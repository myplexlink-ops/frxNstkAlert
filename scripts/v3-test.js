'use strict';

// V3 unit checks — position-calculator math (frontend `public/lib-calc.js`).
// Movers & Risk / Sector Breakdown are exercised via their SQL and covered by
// acceptance criteria 7,8,10; this file locks down criterion 9 (calculator).

const { solveSharesToTarget } = require('../public/lib-calc.js');

let passed = 0, failed = 0;
function assert(name, cond) {
  if (cond) { passed++; console.log('  PASS', name); }
  else { failed++; console.log('  FAIL', name); }
}
function approx(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-6); }

// Blended-average identity: buying n @ buy alongside shares @ avg lands avg at target.
function blended(shares, avg, n, buy) {
  return (shares * avg + n * buy) / (shares + n);
}

console.log('\n# position calculator');

// 1. Lower the average: 100 @ 150, buy cheaper at 100, target 130.
(() => {
  const r = solveSharesToTarget(100, 150, 130, 100);
  assert('reachable when buying below target below avg', r.reachable);
  assert('n = 100*(150-130)/(130-100) = 66.667', approx(r.shares, 66.6666667, 1e-4));
  assert('blended result equals target', approx(blended(100, 150, r.shares, 100), 130));
})();

// 2. Raise the average: 50 @ 20, buy higher at 40, target 30.
(() => {
  const r = solveSharesToTarget(50, 20, 30, 40);
  assert('reachable when buying above target above avg', r.reachable);
  assert('n = 50*(20-30)/(30-40) = 50', approx(r.shares, 50));
  assert('blended equals target (raise case)', approx(blended(50, 20, r.shares, 40), 30));
})();

// 3. Already at target -> 0 shares.
(() => {
  const r = solveSharesToTarget(10, 25, 25, 25);
  assert('already at target is reachable', r.reachable);
  assert('needs 0 shares', approx(r.shares, 0));
})();

// 4. Wrong-direction buy -> not reachable (buy above target, want to lower).
(() => {
  const r = solveSharesToTarget(100, 150, 130, 140);
  assert('buying at 140 cannot get average down to 130', !r.reachable);
  assert('shares is null when unreachable', r.shares === null);
})();

// 5. Buy price equals target but not already there -> not reachable.
(() => {
  const r = solveSharesToTarget(100, 150, 130, 130);
  assert('buy == target while avg != target is unreachable', !r.reachable);
})();

// 6. Input validation.
(() => {
  assert('rejects NaN', !solveSharesToTarget(NaN, 1, 1, 1).reachable);
  assert('rejects negative shares', !solveSharesToTarget(-1, 1, 1, 1).reachable);
  assert('rejects zero avg', !solveSharesToTarget(10, 0, 1, 1).reachable);
})();

// 7. Zero shares owned -> any single buy sets the average to the buy price;
//    target must equal buy to be reachable.
(() => {
  const ok = solveSharesToTarget(0, 10, 25, 25);
  assert('0 shares, target == buy is reachable', ok.reachable);
  const bad = solveSharesToTarget(0, 10, 25, 30);
  assert('0 shares, target != buy is unreachable', !bad.reachable);
})();

console.log('\n----------------------------------------');
console.log(`total: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
