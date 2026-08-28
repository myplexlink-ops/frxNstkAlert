# Product Requirements Document V3: Forex & Stock Price Alert App

**Supersedes:** `trading-alerts-app-PRD-V2.md` (V2)
**Build environment:** VS Code + Claude Code CLI
**Host:** Netlify (Functions + Scheduled Functions + static frontend) + Neon Postgres (direct connection) + Netlify Identity
**Status:** V2 scope is live and ~99% complete (OneSignal Web Push configured and repo pushed 2026-08-28; only a live OneSignal delivery check remains — §13). **V3 scope — Movers & Risk, Sector Breakdown, Position Calculator — is built, tested, migrated, and LIVE** at https://fx-stock-alerts.netlify.app (deployed 2026-08-28, 16 functions). Sector Breakdown shows empty until users add stock symbols (the daily cron then classifies them).
**Last updated:** 2026-08-28

---

## 0. Completion Summary

### V2 scope (previously built — unchanged, carried forward for reference)

| Area | Status | Notes |
|---|---|---|
| Data model / schema | ✅ Complete | Applied to Neon; `watchlist` table added beyond original V1 spec |
| Alert engine (`poll-alerts`) | ✅ Complete | 17/17 engine tests pass; cron `* * * * *` live |
| Price providers (Twelve Data + Finnhub) | ✅ Complete | Batched primary + stock-only fallback + forex-skip-on-failure |
| Auth + admin approval | ✅ Complete | Server-side gate on every endpoint; app_metadata mirrored to DB |
| CRUD Functions (alerts, watchlist) | ✅ Complete | 12 functions deployed |
| Telegram notifications | ✅ Complete & verified | Bot `@FxNStAlert_bot`, webhook registered + secret-verified |
| OneSignal web push | ✅ Configured (2026-08-28) | Web Push platform set up & saved in the OneSignal dashboard (Typical Site, `https://fx-stock-alerts.netlify.app`, default SW). No code change. Live subscribe→deliver check still pending. |
| Frontend (all pages) | ✅ Complete | Landing, pending, dashboard, watchlist, notifications, admin |
| Deployment / infra | ✅ Complete | Site + DB + Identity live; env vars set; first admin bootstrapped |
| Git repository | ✅ Committed & pushed (2026-08-28) | Root commit on `master` → `github.com/myplexlink-ops/frxNstkAlert` |

### V3 scope — new in this revision

| Area | Status | Notes |
|---|---|---|
| `symbol_metadata` table + migration | ✅ Code complete — **migration not yet applied** | `netlify/database/migrations/002_symbol_metadata/migration.sql`; apply manually to Neon like `001_init` |
| Movers & Risk view + `get-movers-risk.js` | ✅ Built | Reads `watchlist` + `price_cache` + `alerts` only — zero new external API calls |
| On-demand ticker chart + `get-symbol-chart.js` | ✅ Built | Proxies Twelve Data `/time_series` (added to `_lib/prices.js`); fetched only on ticker click. Chart is a hand-drawn `<canvas>` — no charting dependency added |
| Sector Breakdown + `get-sector-breakdown.js` + `refresh-symbol-metadata.js` | ✅ Built | **Sector source = Finnhub `/stock/profile2`** (`finnhubIndustry`), reusing `FINNHUB_API_KEY` — Twelve Data's company profile is not reliably free-tier. Daily cron `0 6 * * *` |
| Position Calculator (frontend only) | ✅ Built | Stateless; math in `public/lib-calc.js`, unit-tested (`scripts/v3-test.js`, 16 assertions). Prefills buy price from watchlist cached price |

**Overall: V2's ~95% figure is unchanged by this revision** — it describes the alerts/notifications/auth core only. The five rows above are now built; remaining to be *live* is the `002` migration apply + a deploy (see §16).

---

## 1. Purpose

A multi-user web app where each approved user maintains a personal watchlist of forex
pairs and stock symbols, sets price alerts against them, and gets notified via Telegram
and/or browser push within one polling cycle of a condition being met — regardless of
whether the app is open. New accounts require explicit admin approval before they can
create alerts. Alongside alerts, approved users get read-only market context on their
own watchlist: which symbols are moving, how close each is to its alert thresholds, a
sector breakdown of their stock holdings, and a standalone position-sizing calculator.

## 2. User Roles (unchanged, implemented)

| Role | Capabilities | Status |
|---|---|---|
| **Pending user** | Log in, see "waiting for approval" screen only | ✅ `#view-pending`, gated server-side by `requireUser` |
| **Approved user** | Manage own watchlist, alerts, notification channels, **and** view Movers & Risk / Sector Breakdown / Position Calculator | ✅ existing capabilities; 🆕 new views, same role, no new role needed |
| **Admin** | All of the above + view/approve/reject pending users, view all users | ✅ `#view-admin`, `admin-*` functions |

First admin was seeded via a one-time `admin-bootstrap.js` function, since **removed**
along with `ADMIN_BOOTSTRAP_SECRET`. Additional admins are made via `admin-approve-user`
with `make_admin: true`, or `scripts/seed-admin.js` + Identity dashboard.

## 3. Tech Stack — As Built (+ V3 additions)

| Layer | V1 plan | As built | V3 note |
|---|---|---|---|
| Hosting / compute | Netlify Functions + Scheduled Functions | ✅ Same | New scheduled fn: `refresh-symbol-metadata.js` (low frequency, e.g. daily) |
| Database | Netlify Database (Neon extension) | ⚠️ Netlify's built-in DB was discontinued for new DBs (2026). Uses a Neon project directly via `@netlify/database`'s `getDatabase({ connectionString })`, reading `DATABASE_URL`. | New migration adds `symbol_metadata` — same connection, same runner |
| Auth | Netlify Identity | ✅ Same — Identity is in maintenance mode (see §14) | No change — new endpoints reuse `requireUser` |
| Frontend | Vanilla HTML/CSS/JS, no build | ✅ Same (`public/`) | New views added to the same view-switching SPA, no router/framework introduced |
| Price data — primary | Twelve Data | ✅ Same (`_lib/prices.js`, comma-batched, 8/call) | New usage: `/time_series` for charts (on click only) — extend `_lib/prices.js`, don't create a parallel client |
| Price data — fallback | Finnhub (stocks only) | ✅ Same | Not extended to charts/sector — Twelve Data only for those |
| Notifications — primary | Telegram Bot API | ✅ Same, verified working | No change |
| Notifications — secondary | OneSignal Web Push | ✅ Web Push platform configured in the dashboard 2026-08-28 (§13); live delivery not yet user-verified | No change |

Rejected in V1 and still not introduced: cron-job.org, Alpha Vantage, PushEngage.

## 4. Non-Functional Requirements — Verification Status

| Requirement | Status | Evidence |
|---|---|---|
| Alert latency within one polling cycle (1–5 min/alert) | ✅ | Engine cron runs every minute; UI states "checked every N min — not tick-level" |
| Price fetches deduped by unique symbol per cycle | ✅ | `poll-alerts.js` builds a `specMap` keyed by symbol before fetching |
| Graceful degradation if providers fail | ✅ | Per-symbol failures skip only that symbol; scheduled fn returns 200 even on fatal error |
| No cross-user data access | ✅ | Every query filtered `WHERE user_id = <caller>`; `requireUser` loads the DB row |
| Idempotency / no double-fire | ✅ | `armed` flag flips false on fire for recurring alerts |
| 🆕 New views add zero poll-cycle API calls | ✅ | `get-movers-risk.js` and `get-sector-breakdown.js` import only `db`/`auth`/`http` — no `_lib/prices.js`. Sector data is filled by a separate daily cron. |
| 🆕 Chart/sector calls never expose the API key client-side | ✅ | `get-symbol-chart.js` proxies `/time_series`; `refresh-symbol-metadata.js` (server, scheduled) is the only caller of the Finnhub profile endpoint. Keys stay in `_lib/prices.js`. |

## 5. Data Model

`users`, `alerts`, `price_cache`, `notification_log`, `watchlist` are live and unchanged
by this revision (see V2 for full schema — `watchlist`: `id, user_id, symbol, asset_type,
created_at, UNIQUE(user_id, symbol)`).

**New in V3** — written as `netlify/database/migrations/002_symbol_metadata/migration.sql`,
idempotent (`IF NOT EXISTS`), matching the `001_init` convention (`001_init` untouched).
**Not yet applied to Neon** — see §16:

```sql
CREATE TABLE IF NOT EXISTS symbol_metadata (
  symbol          TEXT PRIMARY KEY,
  asset_type      TEXT NOT NULL,        -- forex rows simply won't have a sector
  sector          TEXT,
  industry        TEXT,
  last_refreshed  TIMESTAMPTZ
);
```

No changes needed to `price_cache`, `watchlist`, or `alerts` — Movers & Risk and the
calculator are built entirely on data that already exists.

## 6. External API Contracts

### 6.1–6.5 (unchanged, as built)
Twelve Data batched `/quote`, Finnhub stock-only fallback, Telegram `/sendMessage` +
webhook linking, OneSignal `/notifications` (v16 SDK; Web Push platform configured 2026-08-28, live delivery unverified),
Netlify Identity widget + `app_metadata` writeback — all unchanged by this revision. See
V2 §6 for full detail.

### 🆕 6.6 Twelve Data Time Series (on-demand ticker charts)
```
GET https://api.twelvedata.com/time_series?symbol=AAPL&interval=1day&outputsize=30&apikey={TWELVE_DATA_API_KEY}
```
Add as a new function in `_lib/prices.js` alongside the existing `/quote` client — reuse
the same API key and error-handling conventions already established there. 1 credit/symbol
per Twelve Data's published pricing. **Call only when a user clicks a ticker** — never on
the poll cycle, never on a timer. Must be proxied through `get-symbol-chart.js`, never
called from the browser (same key-exposure discipline already applied everywhere else in
this codebase).

### 🆕 6.7 Sector/Industry Data (for sector breakdown) — RESOLVED
Twelve Data's company-profile data isn't reliably on the free tier, so sector/industry
comes from **Finnhub** instead (the key is already configured as the price fallback):
```
GET https://finnhub.io/api/v1/stock/profile2?symbol=AAPL&token={FINNHUB_API_KEY}
```
`_lib/prices.js` → `fetchSymbolProfile(symbol)` returns `{ sector, industry }` from the
`finnhubIndustry` field (Finnhub's free profile has no separate sector vs. industry, so
the same value fills both). Called only by the scheduled `refresh-symbol-metadata.js`,
never from a request path. Symbols Finnhub doesn't recognise get a `symbol_metadata` row
with null sector and simply show as "Unclassified" — the feature never blocks.

## 7. Alert Engine Logic

Unchanged by this revision — `poll-alerts.js` needs no modification. Movers & Risk reads
the same `price_cache` rows the engine already maintains; it does not need to trigger or
be triggered by the engine.

## 8. Functions

### As built (unchanged, see V2 §8 for full detail)
`me.js`, `list-alerts.js`, `create-alert.js`, `update-alert.js`, `delete-alert.js`,
`watchlist.js`, `get-telegram-link-code.js`, `link-onesignal.js`, `admin-list-pending.js`,
`admin-approve-user.js`, `telegram-webhook.js`, `poll-alerts.js` — 12 functions, all
using the shared `_lib/` modules (`db.js`, `auth.js`, `http.js`, `prices.js`, `notify.js`,
`validate.js`, `identity.js`).

### 🆕 New in V3

| File | Method(s) | Auth | Status | Notes |
|---|---|---|---|---|
| `get-movers-risk.js` | GET | `requireUser`, approved | ✅ Built | Joins `watchlist` + `price_cache` for movers (ranked by `|percent_change|`, priced symbols first); joins `alerts` for risk (signed distance from `last_price` to each active alert's `target_value`, plus `distance_pct` and a `reached` flag). Zero external API calls. |
| `get-symbol-chart.js` | GET | `requireUser`, approved | ✅ Built | Proxies `/time_series` via `_lib/prices.js` `fetchTimeSeries()`. Interval allowlist; `outputsize` clamped 5–200. On-demand only. |
| `get-sector-breakdown.js` | GET | `requireUser`, approved | ✅ Built | `watchlist` LEFT JOIN `symbol_metadata` + `price_cache`, `WHERE asset_type = 'stock'`. Groups by `sector`; no-metadata symbols returned in `unknown`. |
| `refresh-symbol-metadata.js` | Scheduled `0 6 * * *` | none (internal) | ✅ Built | Refreshes `symbol_metadata` for stock symbols in any `watchlist` row, stale > 7 days, max 40/run. Source: `fetchSymbolProfile()` → Finnhub `/stock/profile2`. Same return-200-on-fatal pattern as `poll-alerts.js`. |

No new function needed for the Position Calculator — it's frontend-only (§9).

The 3 new request-path functions call `requireUser(event, context, opts)` exactly like the
existing ones — no new auth pattern. `refresh-symbol-metadata.js` is internal/scheduled
(no auth), mirroring `poll-alerts.js`. Function count is now 16 (+ 7 `_lib` modules).

## 9. Frontend Pages

### As built (unchanged, see V2 §9)
Single-page app (`index.html` + `app.js` + `styles.css` + `config.js`), view-switching,
no router. Landing, login/signup, pending, dashboard, add/edit alert modal, watchlist,
notification settings, admin — all ✅.

### 🆕 New in V3

| View | Status | Notes |
|---|---|---|
| Movers & Risk (`#view-movers-risk`) | ✅ Built | Two cards: Movers (rows ranked by move, colour-coded) and Risk (per active alert, distance to target + armed/cooldown/reached badge). Click a mover row → chart modal (`#chart-modal`, same `.modal` pattern as Add/Edit Alert) with Daily/Weekly/Hourly interval toggle. |
| Sector Breakdown (`#view-sectors`) | ✅ Built | Stock watchlist grouped by `symbol_metadata.sector`, bar-width by count, per-symbol chips with % change. Forex excluded server-side. "Unclassified" group for symbols with no metadata row yet. "N of M classified" summary line. |
| Position Calculator (`#view-calculator`) | ✅ Built | Inputs: symbol (optional prefill), shares owned, current avg cost, target avg cost, hypothetical buy price. Solves `n = shares·(avg−target)/(target−buy)`; handles unreachable / already-there / zero-position cases. No backend call; prefills buy price from `state.watchlist` cached price; nothing persisted. |

Navigation entries for the three new views were added to `app.js`'s view-switching logic
(`movers-risk`, `sectors`, `calculator`) — same pattern as the existing ones.

**In-page sound alert** (added after the initial V3 build, deployed 2026-08-28): while the
tab is open, `app.js` polls `list-alerts` every 45s (skipped while `document.hidden`, and
run immediately on `visibilitychange` back to visible), tracks each alert's
`last_triggered_at`, and on an advance shows a toast + plays a short two-tone WebAudio
chime (no audio asset). Toggle + "Test sound" live in Notifications → *In-page sound*;
preference persists in `localStorage` (`alertSound`). Purely client-side and best-effort —
it needs the tab open; Telegram / push remain the real delivery channels. No backend
change; no new endpoint (reuses `list-alerts`).

## 10. Out of Scope

- Tick-level/instant triggering — polling-based by design (1–5 min)
- Technical indicators (RSI, MACD, moving averages, etc.) — the new on-demand chart
  (§6.6) is price history only, not indicator overlays
- **Persisted portfolio/position tracking** (buy/sell transaction log, realized vs.
  unrealized P/L, cost-basis storage in the DB) — deliberately not built. The Position
  Calculator is a **stateless utility only**. Full position tracking would mean new
  `positions`/`transactions` tables and its own ledger logic — a meaningfully larger
  scope than this app's alerts-plus-context purpose. Treat as a separate future ask if
  it comes up, not something to infer from "port the calculator."
- Billing/subscriptions
- Native mobile app
- Multi-language support

## 11. Acceptance Criteria

### As built (verified, see V2 §11 for evidence)
1. New signup can't see dashboard until admin approves — ✅
2. Two users, same symbol → one price API call per cycle — ✅
3. One-time alert deactivates after firing; recurring re-arms correctly — ✅
4. Telegram + OneSignal attempted independently, both logged — ✅ logic verified; OneSignal Web Push now configured, live delivery check pending (§13)
5. Poll interval respected per-alert — ✅
6. All endpoints reject unauthenticated/unapproved users — ✅

### 🆕 New — implemented; live verification pending a deploy
7. ✅ (by construction) Movers & Risk and Sector Breakdown issue **only** SQL — no `_lib/prices.js` import in `get-movers-risk.js` / `get-sector-breakdown.js`
8. ✅ (by construction) `TWELVE_DATA_API_KEY` is read only in `_lib/prices.js` (server-side); `get-symbol-chart.js` is the proxy; no key in `public/`
9. ✅ Position Calculator math unit-tested (`npm run test:v3`, 16/16); frontend-only, form `reset()` on Reset, nothing persisted
10. ✅ `get-sector-breakdown.js` filters `WHERE asset_type = 'stock'` and `LEFT JOIN`s `symbol_metadata` (missing rows → `unknown`, no error)

Remaining live checks after deploy + `002` migration: open the three views against real data;
confirm the Netlify functions dashboard shows no Twelve Data calls from movers/sectors;
inspect browser Network tab for the key.

## 12. Prerequisites

All V2 prerequisites remain satisfied (Telegram, Twelve Data, Finnhub, OneSignal keys;
site/DB/Identity live; first admin seeded — see V2 §12). **Nothing new required for V3** —
the new features reuse the existing `TWELVE_DATA_API_KEY`.

## 13. Known Open Items

### Carried forward from V2
1. ✅ **OneSignal Web Push platform configured 2026-08-28** (dashboard, app `b06c8e23-…`,
   Typical Site, `https://fx-stock-alerts.netlify.app`, default SW). No code change.
   Remaining: one live subscribe→deliver check on the deployed site.
2. ✅ **Repository committed & pushed 2026-08-28** → `github.com/myplexlink-ops/frxNstkAlert`
3. Local dev needs `DATABASE_URL` in `.env` for `npm run dev` against a real DB
4. `price_cache.asset_type` can flip if two alerts disagree on a symbol's type — low impact

### 🆕 New for V3
5. ✅ Resolved — sector/industry comes from **Finnhub `/stock/profile2`** (`finnhubIndustry`),
   not Twelve Data. Reuses the existing `FINNHUB_API_KEY`. `finnhubIndustry` is stored as
   both `sector` and `industry` (Finnhub's free profile has no finer split).
6. ✅ Resolved — the ticker chart is a **hand-drawn `<canvas>`** in `app.js` (`drawChart()`),
   no dependency added, consistent with the no-build frontend.
7. ⚠️ **`002_symbol_metadata` migration written but not yet applied.** Apply it to the same
   Neon project as `001_init` (`psql "$DATABASE_URL" -f netlify/database/migrations/002_symbol_metadata/migration.sql`).
   Until then `get-sector-breakdown.js` will error (missing table) — the other V3 views are unaffected.

## 14. Risks / Watch Items

- Netlify Identity is in maintenance mode — swap point is `_lib/auth.js` +
  `_lib/identity.js` + the widget, unchanged by this revision
- **Twelve Data free tier: 800 req/day, 8 req/min — now shared across polling AND
  on-demand chart clicks.** The poll cycle's batched `/quote` calls stay well under
  budget on their own, but `/time_series` chart requests draw from the same daily pool.
  At 5–8 users this is very unlikely to be a problem, but if chart usage turns out to be
  frequent, watch the daily total rather than assuming headroom
- Netlify MCP endpoint is flaky (frequent 502s) — operational only, retries succeed
- Secrets scanning is configured (`SECRETS_SCAN_OMIT_PATHS`); keep real keys out of
  committed files — applies equally to any new files this revision adds

## 15. Environment Variables

Unchanged from V2 — no new variables needed for V3:
```
TWELVE_DATA_API_KEY        set — reused for /time_series and (if viable) sector data
FINNHUB_API_KEY             set
TELEGRAM_BOT_TOKEN          set
TELEGRAM_BOT_USERNAME       set
TELEGRAM_WEBHOOK_SECRET     set
ONESIGNAL_APP_ID            set
ONESIGNAL_REST_API_KEY      set
DATABASE_URL                set on Netlify; still needed in local .env
SECRETS_SCAN_OMIT_PATHS     set
```

## 16. Remaining Work to "Done"

### Carried forward from V2
1. ~~Configure the OneSignal Web Push platform~~ **done 2026-08-28** — still verify live push end-to-end
2. ~~`git commit` the initial codebase and push to a remote~~ **done 2026-08-28**
3. Add `DATABASE_URL` to local `.env` for full local dev parity (optional)
4. Optional hardening: pin `price_cache.asset_type` on first insert; admin view of recent `notification_log` rows

### 🆕 New for V3 — build status
5. ⚠️ `002_symbol_metadata` migration **written**, not yet applied to Neon
6. ✅ `get-movers-risk.js` built
7. ✅ `get-symbol-chart.js` built; `_lib/prices.js` gained `fetchTimeSeries()`
8. ✅ Sector source resolved (Finnhub profile2); `refresh-symbol-metadata.js` + `get-sector-breakdown.js` built; `_lib/prices.js` gained `fetchSymbolProfile()`; daily cron added to `netlify.toml`
9. ✅ Three new frontend views + Position Calculator built (`index.html`, `app.js`, `styles.css`, `public/lib-calc.js`); nav wired
10. ✅ Static/unit verification done (`npm test` → 17 engine + 16 calc assertions pass); live checks pending deploy

### 🆕 V3 — done
- ✅ `002_symbol_metadata` applied to Neon prod (via new `scripts/apply-migrations.js`; verified table + columns)
- ✅ Deployed prod 2026-08-28 (deploy `6a9145fab727da159ded9982`, 16 functions). **Use `netlify deploy --prod` without `--build`** — `--build` fails locally on the auto-enabled Neon integration's plugin install (`EALLOWSCRIPTS`); the site has no build command so `--build` is unnecessary.
- ✅ New endpoints verified 401-gated (not 404); `lib-calc.js` served; `refresh-symbol-metadata` registered as scheduled (HTTP 403 on direct call, as expected)
- Live data walk-through pending real stock symbols on a watchlist (currently 1 forex only, so Sector Breakdown is legitimately empty and the refresh cron is a no-op)
