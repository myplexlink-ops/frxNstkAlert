/* Position-sizing math — pure, no DOM. Shared by app.js and scripts/v3-test.js. */
(function (root) {
  'use strict';

  /**
   * How many shares `n` to buy at `buy` so the blended average cost of
   * (shares @ avg) + (n @ buy) equals `target`.
   *
   * Solve (shares*avg + n*buy) / (shares + n) = target  for n:
   *   n = shares * (avg - target) / (target - buy)
   *
   * Returns { reachable: bool, shares: number|null, reason?: string }.
   * `shares` is null when not reachable.
   */
  function solveSharesToTarget(shares, avg, target, buy) {
    if (![shares, avg, target, buy].every(function (n) { return typeof n === 'number' && isFinite(n); })) {
      return { reachable: false, shares: null, reason: 'invalid input' };
    }
    if (shares < 0 || avg <= 0 || target <= 0 || buy <= 0) {
      return { reachable: false, shares: null, reason: 'values must be positive' };
    }

    if (shares === 0) {
      // No existing position: any buy sets the average to the buy price exactly.
      return Math.abs(target - buy) < 1e-9
        ? { reachable: true, shares: 0, reason: 'no existing position — average will equal the buy price' }
        : { reachable: false, shares: null, reason: 'with no shares owned, the average just equals the buy price' };
    }

    var denom = target - buy;
    if (Math.abs(denom) < 1e-9) {
      // Buying at exactly the target price only "works" if you're already there.
      return Math.abs(target - avg) < 1e-9
        ? { reachable: true, shares: 0 }
        : { reachable: false, shares: null, reason: 'buy price equals target' };
    }

    var n = (shares * (avg - target)) / denom;
    if (n < 0 || !isFinite(n)) {
      return { reachable: false, shares: null, reason: 'buying at this price moves the average the wrong way' };
    }
    return { reachable: true, shares: n };
  }

  var apiObj = { solveSharesToTarget: solveSharesToTarget };
  if (typeof module !== 'undefined' && module.exports) module.exports = apiObj;
  else root.PositionCalc = apiObj;
})(typeof window !== 'undefined' ? window : globalThis);
