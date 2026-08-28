# Product Requirements Document V2: Forex & Stock Price Alert App

**Supersedes:** `trading-alerts-app-PRD.md` (V1)
**Build environment:** VS Code + Claude Code CLI
**Host:** Netlify (Functions + Scheduled Functions + static frontend) + Neon Postgres + Netlify Identity
**Status:** **Built and deployed — live at https://fx-stock-alerts.netlify.app**
**Last updated:** 2026-08-28

---

## 0. Completion Summary

| Area | Status | Notes |
|---|---|---|
| Data model / schema | ✅ Complete | Applied to Neon; `watchlist` table added beyond V1 spec |
| Alert engine (`poll-alerts`) | ✅ Complete | All V1 §7 logic implemented; 17/17 engine tests pass; cron `* * * * *` live |
| Price providers (Twelve Data + Finnhub) | ✅ Complete | Batched primary + stock-only fallback + forex-skip-on-failure |
| Auth + admin approval | ✅ Complete | Server-side gate on every endpoint; app_metadata mirrored to DB |
| CRUD Functions (alerts, watchlist) | ✅ Complete | 12 functions deployed |
| Telegram notifications | ✅ Complete & verified | Bot `@FxNStAlert_bot`, webhook registered + secret-verified |
| OneSignal web push | ✅ Configured & verified end-to-end (2026-08-28) | Web Push platform saved in the dashboard (Typical Site, `https://fx-stock-alerts.netlify.app`, default SW). No code change. Verified on the live site: SDK inits clean, SW registers, browser subscribes, and a REST push using the exact `notify.js` payload (`include_player_ids`, `headings.en:"Price Alert"`) was delivered and shown. |
| Frontend (all pages) | ✅ Complete | Landing, pending, dashboard, watchlist, notifications, admin |
| Deployment / infra | ✅ Complete | Site + DB + Identity live; env vars set; first admin bootstrapped |
| Git repository | ✅ Committed & pushed (2026-08-28) | Root commit on `master`, remote `github.com/myplexlink-ops/frxNstkAlert` |

**Overall: functionally complete.** Both notification channels verified working on the live
site (Telegram earlier; OneSignal web push configured and delivery-tested 2026-08-28). The
only path not exercised is the logged-in `link-onesignal` → `poll-alerts` chain (needs an
Identity login) — but every component of it is now individually proven. Remaining items are
optional hardening (§16).

---

## 1. Purpose (unchanged from V1)

A multi-user web app where each approved user maintains a personal watchlist of forex
pairs and stock symbols, sets price alerts against them, and gets notified via Telegram
and/or browser push within one polling cycle of a condition being met — regardless of
whether the app is open. New accounts require explicit admin approval before they can
create alerts.

## 2. User Roles (unchanged, implemented)

| Role | Capabilities | Status |
|---|---|---|
| **Pending user** | Log in, see "waiting for approval" screen only | ✅ `#view-pending`, gated server-side by `requireUser` |
| **Approved user** | Manage own watchlist, alerts, notification channels | ✅ |
| **Admin** | All of the above + view/approve/reject pending users, view all users | ✅ `#view-admin`, `admin-*` functions |

First admin was seeded via a one-time `admin-bootstrap.js` function (POST `{secret}` with a
logged-in JWT), which has since been **removed** along with `ADMIN_BOOTSTRAP_SECRET`.
Going forward, additional admins are made via `admin-approve-user` with `make_admin: true`,
or `scripts/seed-admin.js` + Identity dashboard.

## 3. Tech Stack — As Built (changes from V1 in **bold**)

| Layer | V1 plan | As built |
|---|---|---|
| Hosting / compute | Netlify Functions + Scheduled Functions | ✅ Same |
| Database | **Netlify Database (Neon extension)** | ⚠️ **Netlify's built-in DB was discontinued for new DBs (2026). Uses a Neon project directly** via `@netlify/database`'s `getDatabase({ connectionString })`, reading `DATABASE_URL`. Schema applied manually. |
| Auth | Netlify Identity | ✅ Same — **but Identity is in maintenance mode** (see §14). Isolated to `_lib/auth.js` + `_lib/identity.js` + the widget for swappability. |
| Frontend | Vanilla HTML/CSS/JS, no build | ✅ Same (`public/`) |
| Price data — primary | Twelve Data | ✅ Same (`_lib/prices.js`, comma-batched, 8/call) |
| Price data — fallback | Finnhub (stocks only) | ✅ Same |
| Notifications — primary | Telegram Bot API | ✅ Same, verified working |
| Notifications — secondary | OneSignal Web Push | ✅ **v16 SDK**, 2026 REST endpoint; Web Push platform configured 2026-08-28 and a test push delivered to the live site end-to-end (§13). |

Rejected in V1 and still not introduced: cron-job.org, Alpha Vantage, PushEngage.

## 4. Non-Functional Requirements — Verification Status

| Requirement | Status | Evidence |
|---|---|---|
| Alert latency within one polling cycle (1–5 min/alert) | ✅ | Engine cron runs every minute; each alert re-checked on its own `poll_interval_seconds`. UI states "checked every N min — not tick-level". |
| Price fetches deduped by unique symbol per cycle | ✅ | `poll-alerts.js` builds a `specMap` keyed by symbol before fetching. Engine test: "symbol dedup". |
| Graceful degradation if providers fail | ✅ | `resolveQuotes` failure → empty map, alerts left with `next_check_due` untouched; per-symbol failures skip only that symbol. Scheduled fn returns 200 even on fatal error. |
| No cross-user data access | ✅ | Every query filtered `WHERE user_id = <caller>`; `requireUser` loads the DB row, never trusts client IDs. |
| Idempotency / no double-fire | ✅ | `armed` flag flips false on fire for recurring alerts; re-arms only after price crosses back. Engine tests: "no fire on re-arm cycle", "fires again after re-arm + re-cross". |

## 5. Data Model — As Built

Schema file: `netlify/database/migrations/001_init/migration.sql` (idempotent, `IF NOT EXISTS`).
Applied to Neon project `ep-young-credit-az4rifsj-pooler...ap-southeast-1` / `neondb`.

**Changes from V1:**
- **Added `watchlist` table** (not in V1's model, but implied by V1 §9 Watchlist page):
  `id, user_id, symbol, asset_type, created_at, UNIQUE(user_id, symbol)`.
- `CREATE EXTENSION "pgcrypto"` line kept in the file but **skipped by the manual runner** —
  Neon has `gen_random_uuid()` in core, so it's not required.
- Added indexes: `idx_alerts_user`, `idx_notiflog_alert` (plus V1's `idx_alerts_next_check`,
  `idx_alerts_symbol`).

`users`, `alerts`, `price_cache`, `notification_log` match V1 as specified.
All 5 tables confirmed created; `users_count = 1` (the admin) at deploy time.

## 6. External API Contracts — As Built

- **6.1 Twelve Data** — `GET /quote?symbol=A,B,C&apikey=…`, comma-batched, chunked at 8
  symbols/request. Handles both flat (single-symbol) and keyed (batched) response shapes.
  Maps `close`→`last_price`, `previous_close`→`prev_close`, `percent_change` as-is.
- **6.2 Finnhub** — `GET /quote?symbol=X&token=…`, one call per symbol, **only** for stock
  symbols that Twelve Data failed on. `c`→last, `pc`→prev_close, `dp`→percent_change.
  A `c` of `0` is treated as a failure.
- **6.3 Telegram** — `POST /bot{token}/sendMessage`, JSON body, `disable_web_page_preview: true`.
  Linking: account page shows a code → user sends `/start <code>` to `@FxNStAlert_bot` →
  `telegram-webhook.js` matches the code to `telegram_link_code`, stores `chat.id`, clears the code.
  Webhook authenticated with `X-Telegram-Bot-Api-Secret-Token` header.
- **6.4 OneSignal** — `POST https://api.onesignal.com/notifications`, `Authorization: Key <REST key>`,
  `include_player_ids`. Frontend uses **Web SDK v16** (`OneSignalDeferred`, `User.PushSubscription`).
  (Deliberately not the legacy `/api/v1` + `Authorization: Basic` pattern.)
- **6.5 Netlify Identity** — Widget on the frontend; JWT verified by Netlify and exposed as
  `context.clientContext.user`. Admin approval writes `app_metadata` back via
  `PUT {clientContext.identity.url}/admin/users/{id}` (`_lib/identity.js`) **and** mirrors the
  flags into the `users` table. Site is **Invite-only** (`disable_signup: true`).

## 7. Alert Engine Logic — As Built (`poll-alerts.js`)

Implements V1 §7 exactly:
1. `SELECT` active alerts where `next_check_due <= now()`, joined to `users` for channel IDs.
2. Dedup to unique `{symbol, asset_type}` specs.
3. `resolveQuotes`: Twelve Data batched → Finnhub retry for missing stocks → forex misses omitted.
4. Upsert `price_cache`.
5. Per due alert: evaluate `cross_above` / `cross_below` / `pct_change`
   (pct vs `reference_price` if set, else provider `percent_change`, else vs `prev_close`).
   Re-arm a disarmed recurring alert first if the condition is no longer met.
6. On fire: `notifyAlert` (Telegram + OneSignal independently, each logged);
   one-time → `active = FALSE`; recurring → `armed = FALSE`. Always advance `next_check_due`.
7. No fresh price → skip, leave `next_check_due` unchanged (retry next cycle).

Returns a JSON summary (`checked`, `symbols`, `prices_resolved`, `evaluated`, `triggered`,
`skipped_no_price`, `ms`). Fatal errors are caught and returned as 200 to avoid a Netlify
scheduled-function failure loop.

**Tested:** `scripts/engine-test.js` (`npm test`) — 17 assertions, all passing, covering
symbol dedup, one-time deactivation, recurring re-arm cycle, forex-failure skip,
per-alert interval independence, and pct_change vs `reference_price`.

## 8. Functions — As Built

`netlify/functions/` (12 endpoints + 7 shared `_lib` modules):

| File | Method(s) | Auth | Status |
|---|---|---|---|
| `me.js` | GET | JWT (approval **not** required) | ✅ bootstrap: identity, approval, channel link status, pending count |
| `list-alerts.js` | GET | approved | ✅ caller's alerts + cached price |
| `create-alert.js` | POST | approved | ✅ validates via `_lib/validate.js` |
| `update-alert.js` | PUT | approved + ownership | ✅ |
| `delete-alert.js` | DELETE | approved + ownership | ✅ |
| `watchlist.js` | GET / POST / DELETE | approved | ✅ (new vs V1 layout) |
| `get-telegram-link-code.js` | GET / POST | approved | ✅ GET returns/creates code, POST regenerates |
| `link-onesignal.js` | POST | approved | ✅ stores/clears `onesignal_player_id` |
| `admin-list-pending.js` | GET | admin | ✅ pending + all users |
| `admin-approve-user.js` | POST | admin | ✅ approve/reject, optional `make_admin`, writes back to Identity |
| `telegram-webhook.js` | POST | shared secret header | ✅ `/start <code>` linking |
| `poll-alerts.js` | Scheduled (`* * * * *`) | none (internal) | ✅ |

Shared `_lib/`: `db.js` (Neon connection resolution), `auth.js` (`requireUser` gate + `syncUser`),
`http.js` (response helpers), `prices.js`, `notify.js`, `validate.js`, `identity.js`.

**Removed after use:** `db-check.js`, `db-migrate.js`, `admin-bootstrap.js` (diagnostic/bootstrap only).

Every non-webhook, non-scheduled function calls `requireUser(event, context, opts)` which
verifies the JWT, upserts/loads the DB user row, and enforces `approved` / `is_admin`
server-side before touching data.

## 9. Frontend Pages — As Built (`public/`)

Single-page app (`index.html` + `app.js` + `styles.css` + `config.js`), view-switching, no router.

| Page / view | Status |
|---|---|
| Landing (logged out) | ✅ `#view-landing` — pitch + login, states polling nature |
| Login / Signup | ✅ Netlify Identity widget (invite-only) |
| Pending approval | ✅ `#view-pending` — message + "Check again" |
| Dashboard | ✅ `#view-dashboard` — alert list (symbol, condition, interval, recurring, cached price, armed/cooldown/fired badge), New / Edit / Delete |
| Add/Edit Alert (modal) | ✅ asset type, symbol w/ datalist autocomplete from watchlist + starter list, condition, target, reference price (shown only for pct_change), 1–5 min interval slider, recurring toggle |
| Watchlist | ✅ `#view-watchlist` — add/remove, "quick add" from `STARTER_SYMBOLS`, cached price |
| Notification settings | ✅ `#view-notifications` — Telegram: status + `/start <code>` + copy + regenerate; OneSignal: enable/disable + status |
| Admin panel | ✅ `#view-admin` — pending signups w/ Approve/Reject, all users w/ role/channel badges |

`config.js` holds `ONESIGNAL_APP_ID` (`b06c8e23-…`), `POLL_TICK_LABEL`, and a 10-symbol
`STARTER_SYMBOLS` list (EUR/USD, GBP/USD, USD/JPY, AUD/USD, XAU/USD, AAPL, MSFT, TSLA, NVDA, AMZN).

## 10. Out of Scope (unchanged)

Tick-level triggering, charting / indicators beyond price level & % change, billing,
native mobile app, multi-language.

## 11. Acceptance Criteria — Current State

| # | Criterion | Status |
|---|---|---|
| 1 | New signup can't see dashboard until admin approves | ✅ server-side gate + `#view-pending` |
| 2 | Two users, same symbol → one price API call per cycle | ✅ symbol dedup in `poll-alerts.js`; engine test |
| 3 | One-time alert deactivates after firing; recurring doesn't double-fire and re-arms | ✅ engine tests pass |
| 4 | Telegram + OneSignal attempted independently, both logged | ✅ `notifyAlert` — separate try/catch, `notification_log` per channel. Both channels verified delivering on the live site (§13). |
| 5 | Poll interval respected per-alert | ✅ engine test "per-alert interval" |
| 6 | All endpoints reject unauthenticated / unapproved users | ✅ `requireUser` on every endpoint |

Criteria 1–3, 5, 6 fully verified. Criterion 4 verified: Telegram works, and a OneSignal
REST push with the exact `notify.js` payload was delivered to a live subscriber (§13).

## 12. Prerequisites — Status

| # | Item | Status |
|---|---|---|
| 1 | Telegram bot token | ✅ `@FxNStAlert_bot` ("FRXalert"), token set |
| 2 | Twelve Data API key | ✅ set |
| 3 | Finnhub API key | ✅ set |
| 4 | OneSignal App ID + REST key | ✅ set (app `b06c8e23-…`) |
| 5 | Netlify site + DB + Identity | ✅ site `fx-stock-alerts` (id `39d53e85-…`), Neon DB connected, Identity enabled (invite-only) |
| 6 | First admin | ✅ done via one-time bootstrap fn (since removed) |
| 7 | Starter symbol list | ✅ in `public/config.js` |

## 13. Known Open Items

1. ~~OneSignal web push not functional.~~ **Configured & verified end-to-end 2026-08-28.**
   Web Push platform saved in the dashboard for app `b06c8e23-aea0-4edf-a284-be14f3ef3b09`
   (Typical Site, `https://fx-stock-alerts.netlify.app`, default SW matching
   `public/OneSignalSDKWorker.js`). No code change. On the live site: SDK v16 inits with no
   "not configured" error, SW registers at root scope, the browser subscribes and gets a
   subscription id, the welcome notification fires, and a REST push using the exact
   `_lib/notify.js` payload (`Authorization: Key os_v2_app_…`, `include_player_ids`,
   `headings.en:"Price Alert"`) returned HTTP 200 and was delivered/shown in the browser.
   Not exercised: the logged-in `link-onesignal` → `poll-alerts`/`notifyAlert` chain (needs
   an Identity login) — but each component is now proven. (Cosmetic: legacy
   `/api/v1/players` reports `notification_types: undefined` for the v16 subscription;
   direct-id targeting delivers regardless.)
2. ~~Repository has no commits.~~ **Done 2026-08-28** — root commit on `master`, pushed to
   `github.com/myplexlink-ops/frxNstkAlert`.
3. **Local dev needs `DATABASE_URL`.** `.env` must carry the Neon pooled connection string
   for `npm run dev` against a real DB (the engine tests use mocks and don't need it; the
   V3 migration helper reads it from `netlify env:get`).
4. **`asset_type` on `price_cache` can flip** if two alerts disagree on a symbol's type
   (the upsert takes `EXCLUDED.asset_type`). Low impact; consider pinning on first insert.

## 14. Risks / Watch Items

- **Netlify Identity is in maintenance mode.** Still functional; if it's ever disabled,
  swap it out at `_lib/auth.js` + `_lib/identity.js` + the widget in `index.html`/`app.js`
  without touching the alert engine.
- **Twelve Data free tier: 800 req/day, 8 req/min.** At one batch call/minute the app stays
  well under the rate cap, but a large distinct-symbol set in a single cycle chunks into
  multiple calls — watch the daily budget as the user base grows.
- **Netlify MCP endpoint is flaky** (frequent 502s) — operational only, retries succeed.
- **Secrets scanning:** `SECRETS_SCAN_OMIT_PATHS=KEYS/**,PRD/**,.env,.env.*` is set and
  `KEYS/` is gitignored; keep real keys out of committed files.

## 15. Environment Variables — As Deployed

```
TWELVE_DATA_API_KEY        ✅ set
FINNHUB_API_KEY            ✅ set
TELEGRAM_BOT_TOKEN         ✅ set
TELEGRAM_BOT_USERNAME      ✅ set (cosmetic, shown in linking UI)
TELEGRAM_WEBHOOK_SECRET    ✅ set (verifies inbound webhook)
ONESIGNAL_APP_ID           ✅ set (also in public/config.js)
ONESIGNAL_REST_API_KEY     ✅ set
DATABASE_URL               ✅ set on Netlify (Neon pooled URL); still needed in local .env
SECRETS_SCAN_OMIT_PATHS    ✅ set
```
`ADMIN_BOOTSTRAP_SECRET` — was temporary, **removed** after first admin bootstrap.

## 16. Remaining Work to "Done"

1. ~~Configure the OneSignal Web Push platform / verify live push.~~ **Done & verified
   2026-08-28** (test push delivered to the live site).
2. ~~`git commit` the initial codebase and push to a remote.~~ **Done 2026-08-28.**
3. Add `DATABASE_URL` to local `.env` for full local dev parity (optional).
4. Optional: a full logged-in run of the `link-onesignal` → alert-fires → push chain
   (all components proven individually).
5. Optional hardening: pin `price_cache.asset_type` on first insert; add a lightweight
   admin view of recent `notification_log` rows for delivery debugging.
