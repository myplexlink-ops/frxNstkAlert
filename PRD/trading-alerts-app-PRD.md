# Product Requirements Document: Forex & Stock Price Alert App

**Target build environment:** VS Code + Claude Code CLI
**Target host:** Netlify (Functions, Netlify Database, Identity)
**Status:** Ready for build — prerequisites listed in §12 must be filled in before deploy

---

## 1. Purpose

A multi-user web app where each approved user maintains a personal watchlist of forex pairs and stock symbols, sets price alerts against them, and gets notified via Telegram and/or browser push the moment (within one polling cycle) a condition is met — regardless of whether the app is open. New accounts require explicit admin approval before they can create alerts.

## 2. User Roles

| Role | Capabilities |
|---|---|
| **Pending user** | Signed up, not yet approved. Can log in, sees only a "waiting for approval" screen. |
| **Approved user** | Full access: manage own watchlist, create/edit/delete own alerts, manage own notification channels. |
| **Admin** | Everything an approved user can do, plus: view pending signups, approve/reject them, view all users. |

First admin is seeded manually (see §12).

## 3. Tech Stack & Rationale

| Layer | Choice | Rationale |
|---|---|---|
| Hosting | Netlify | Existing preference |
| Compute | Netlify Functions + Scheduled Functions | No always-on server needed; cron-based polling fits the 1–5 min alert tolerance; free on all plans |
| Database | Netlify Database (Postgres via Neon) | Native to Netlify — no separate DB vendor to manage |
| Auth | Netlify Identity | Still actively supported; integrates natively with Functions; avoids building auth from scratch |
| Frontend | Vanilla HTML/CSS/JS, no build step | Keeps the repo simple and easy for an AI coding agent (or Ahmad) to maintain without a bundler toolchain |
| Price data — primary | Twelve Data | Single free key covers both forex and stocks (800 req/day, 8 req/min) |
| Price data — fallback | Finnhub | Used mainly for **stock** symbols when Twelve Data is rate-limited/down. Finnhub's free-tier forex coverage is weak — do NOT rely on it as a forex fallback; if Twelve Data fails on a forex symbol, skip and retry next cycle instead |
| Notifications — primary | Telegram Bot API | Free, no meaningful rate limits at this scale, delivered independent of browser state |
| Notifications — secondary | OneSignal (Web Push) | Free tier, up to 10,000 web push subscribers, handles VAPID/service-worker complexity |

**Explicitly rejected and why (do not introduce these):**
- cron-job.org — redundant with Netlify Scheduled Functions, adds an external point of failure
- Alpha Vantage — free tier is 25 requests/day, unworkable at any real polling cadence
- PushEngage — redundant with OneSignal, same category

## 4. Non-Functional Requirements

- **Alert latency:** fires within one polling cycle of the condition being met (user-configurable 1–5 min per alert). This is polling, not tick-level — must be communicated in the UI (e.g., "checked every N minutes"), not implied to be instant.
- **API budget discipline:** price fetches must be deduplicated by unique symbol per cycle, never per-alert or per-user. A symbol watched by 5 users with 5 different alerts is fetched once per cycle.
- **Graceful degradation:** if both data providers fail for a cycle, log the failure and retry next cycle — never crash the scheduled function or drop the whole batch because one symbol failed.
- **Security:** no alert or user data should be readable/writable across users except by an admin. All Functions that mutate data must verify the caller's Identity JWT and, where relevant, `approved`/`is_admin` claims server-side — never trust client-supplied user IDs.
- **Idempotency:** a recurring alert must not double-fire within the same trigger event (see re-arm logic, §7).

## 5. Data Model (Postgres — Netlify Database)

```sql
CREATE TABLE users (
  id              UUID PRIMARY KEY,          -- matches Netlify Identity user id
  email           TEXT UNIQUE NOT NULL,
  approved        BOOLEAN NOT NULL DEFAULT FALSE,
  is_admin        BOOLEAN NOT NULL DEFAULT FALSE,
  telegram_chat_id     TEXT,
  telegram_link_code   TEXT,                 -- one-time code shown to user to link their bot chat
  onesignal_player_id  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE alerts (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol            TEXT NOT NULL,             -- e.g. 'EUR/USD', 'AAPL'
  asset_type        TEXT NOT NULL CHECK (asset_type IN ('forex','stock')),
  condition_type    TEXT NOT NULL CHECK (condition_type IN ('cross_above','cross_below','pct_change')),
  target_value      NUMERIC NOT NULL,          -- price level, or percent (e.g. 2.5 = 2.5%)
  reference_price   NUMERIC,                   -- baseline for pct_change; null = use provider's previous-close change
  poll_interval_seconds INTEGER NOT NULL CHECK (poll_interval_seconds BETWEEN 60 AND 300),
  recurring         BOOLEAN NOT NULL,           -- per-alert, user's explicit choice
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  armed             BOOLEAN NOT NULL DEFAULT TRUE,  -- false right after firing on a recurring alert until price re-crosses back, prevents spam
  last_triggered_at TIMESTAMPTZ,
  next_check_due    TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE price_cache (
  symbol          TEXT PRIMARY KEY,
  asset_type      TEXT NOT NULL,
  last_price      NUMERIC,
  prev_close      NUMERIC,
  percent_change  NUMERIC,
  last_checked_at TIMESTAMPTZ
);

CREATE TABLE notification_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  alert_id    UUID NOT NULL REFERENCES alerts(id) ON DELETE CASCADE,
  channel     TEXT NOT NULL CHECK (channel IN ('telegram','onesignal')),
  status      TEXT NOT NULL CHECK (status IN ('sent','failed')),
  error       TEXT,
  sent_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_alerts_next_check ON alerts (next_check_due) WHERE active = TRUE;
CREATE INDEX idx_alerts_symbol ON alerts (symbol) WHERE active = TRUE;
```

## 6. External API Contracts

### 6.1 Twelve Data (primary price source)
```
GET https://api.twelvedata.com/quote?symbol=EUR/USD,AAPL,MSFT&apikey={TWELVE_DATA_API_KEY}
```
Batch multiple symbols comma-separated in one call to conserve the 8/min request cap. Response is keyed by symbol when batched; each entry includes `close` (current price), `previous_close`, `percent_change`. Use `close` as `last_price`, `previous_close` as `prev_close`, `percent_change` as-is unless `reference_price` is set on the alert (see §7).

### 6.2 Finnhub (fallback, stocks only)
```
GET https://finnhub.io/api/v1/quote?symbol=AAPL&token={FINNHUB_API_KEY}
```
Response: `c` (current), `pc` (previous close), `dp` (percent change). One symbol per call — use only when Twelve Data fails on a specific stock symbol, not for bulk fallback (rate limit is 60/min but don't lean on it as primary).

### 6.3 Telegram Bot API (primary notification channel)
```
POST https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}/sendMessage
Content-Type: application/json
{ "chat_id": "<telegram_chat_id>", "text": "<alert message>" }
```
Linking flow: user's account page displays a short code; user sends `/start <code>` to the bot; a Telegram webhook Function receives the update, matches the code to `telegram_link_code`, and stores the resulting `chat.id` as `telegram_chat_id`.

### 6.4 OneSignal (secondary notification channel)
```
POST https://api.onesignal.com/notifications
Authorization: Key {ONESIGNAL_REST_API_KEY}
Content-Type: application/json
{
  "app_id": "{ONESIGNAL_APP_ID}",
  "include_player_ids": ["<onesignal_player_id>"],
  "headings": {"en": "Price Alert"},
  "contents": {"en": "<alert message>"}
}
```
Note: this is the current (2026) endpoint and key-based auth format — do not use the older `onesignal.com/api/v1/notifications` + `Authorization: Basic` pattern found in older tutorials; that's legacy.

### 6.5 Netlify Identity (auth + admin approval)
Standard Identity signup/login/JWT flow on the frontend via the Identity widget or direct GoTrue endpoints. For admin approval, the approved/is_admin flags should live in `app_metadata` (admin-editable only, not user-editable — do not put them in `user_metadata`, which the user's own client can modify). **Verify the current Identity Admin API token/endpoint pattern against live Netlify docs at build time** — this has had version drift and shouldn't be hardcoded from memory; the general shape is an authenticated PUT/PATCH to the site's `/.netlify/identity/admin/users/{id}` updating `app_metadata`.

## 7. Alert Engine Logic (Scheduled Function, runs every 1 minute)

```
1. SELECT * FROM alerts WHERE active = TRUE AND next_check_due <= now()
2. Group due alerts by unique symbol
3. For each unique symbol batch (respecting Twelve Data's 8 req/min cap — chunk if needed):
     fetch quote from Twelve Data
     on failure for a stock symbol: retry that single symbol via Finnhub
     on failure for a forex symbol: skip this cycle, leave next_check_due unchanged, log it
     UPSERT price_cache
4. For each due alert, evaluate against its symbol's fresh price_cache row:
     - cross_above: last_price >= target_value AND armed = TRUE
     - cross_below: last_price <= target_value AND armed = TRUE
     - pct_change: ABS(percent_change relative to reference_price OR prev_close) >= target_value AND armed = TRUE
5. On trigger:
     - send Telegram message (if telegram_chat_id set)
     - send OneSignal push (if onesignal_player_id set)
     - log each attempt to notification_log
     - set last_triggered_at = now()
     - if recurring = FALSE: set active = FALSE
     - if recurring = TRUE: set armed = FALSE (prevents re-fire until price crosses back past target_value, then armed resets to TRUE — implement as a simple re-check in step 4 before evaluating trigger conditions)
6. Regardless of trigger: set next_check_due = now() + alert.poll_interval_seconds
```

## 8. Functions (Netlify Functions — suggested file layout)

```
netlify/functions/
  poll-alerts.js          -- scheduled function, runs the logic in §7
  telegram-webhook.js      -- receives Telegram updates, handles /start <code> linking
  link-onesignal.js        -- called by frontend after push permission granted, stores player_id
  create-alert.js          -- POST, auth required, approved required
  update-alert.js          -- PUT, auth required, ownership check
  delete-alert.js          -- DELETE, auth required, ownership check
  list-alerts.js           -- GET, auth required, returns only caller's alerts
  admin-list-pending.js    -- GET, auth required, is_admin required
  admin-approve-user.js    -- POST, auth required, is_admin required
  get-telegram-link-code.js -- GET, auth required, generates/returns the user's linking code
```

Every non-webhook, non-scheduled Function must:
1. Verify the Netlify Identity JWT from the request context
2. Look up the user's `approved`/`is_admin` status server-side from the DB (not from client-supplied claims alone)
3. Reject with 401/403 as appropriate before touching any data

## 9. Frontend Pages

| Page | Key elements |
|---|---|
| Login/Signup | Netlify Identity widget or custom form |
| Pending approval | Static message, no navigation to app features |
| Dashboard | List of user's alerts (symbol, condition, target, status), Add Alert button |
| Add/Edit Alert form | Symbol (autocomplete from watchlist + free text), asset type, condition type (cross above/below/% change), target value, reference price (optional, for % change), poll interval slider (1–5 min), recurring toggle |
| Watchlist | Add/remove tracked symbols beyond the seeded starter list |
| Notification settings | Telegram: show link code + linked status; OneSignal: "Enable browser alerts" button + status |
| Admin panel | Table of pending users with Approve/Reject; table of all approved users |

## 10. Explicitly Out of Scope (v1)

- Tick-level/instant triggering — this is polling-based by design (1–5 min)
- Charting, technical indicators beyond price level and % change
- Billing/subscriptions
- Native mobile app
- Multi-language support

## 11. Acceptance Criteria (spot checks before calling it done)

- [ ] A new signup cannot see the dashboard until an admin approves them
- [ ] Two different users' alerts on the same symbol result in exactly one price API call per cycle, not two
- [ ] A one-time alert deactivates after firing; a recurring alert does not double-fire while price stays past the threshold, and re-arms once price crosses back
- [ ] Telegram message and OneSignal push are both attempted independently — failure of one does not block the other, and both are logged
- [ ] Poll interval is respected per-alert (a 1-min alert and a 5-min alert on the same symbol don't force each other's cadence)
- [ ] All Function endpoints reject requests from unauthenticated or unapproved users

## 12. Prerequisites Before/During Build

1. Telegram bot token (BotFather)
2. Twelve Data API key
3. Finnhub API key
4. OneSignal App ID + REST API key
5. Netlify site created, Netlify Database provisioned, Netlify Identity enabled
6. First admin: manually set `approved: true, is_admin: true` in that user's `app_metadata` after their first signup (one-time, via Netlify dashboard or Identity Admin API)
7. Starter symbol list (forex pairs / stock tickers to seed the watchlist)

## 13. Environment Variables

```
TWELVE_DATA_API_KEY
FINNHUB_API_KEY
TELEGRAM_BOT_TOKEN
ONESIGNAL_APP_ID
ONESIGNAL_REST_API_KEY
NETLIFY_DATABASE_URL        -- auto-provided by Netlify DB
```
