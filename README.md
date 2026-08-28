# Trading Alerts

Multi-user Forex & Stock price-alert web app. Each approved user keeps a watchlist,
sets price / %-change alerts, and is notified via **Telegram** and **browser push
(OneSignal)** within one polling cycle — whether or not the app is open.

Built per `PRD/trading-alerts-app-PRD.md`.

- **Hosting / compute:** Netlify (static frontend + Functions + one Scheduled Function)
- **DB:** Neon Postgres, accessed via `@netlify/database` driver with an explicit
  `DATABASE_URL`. (Netlify's built-in DB was discontinued for new databases, so we
  point at a Neon project directly.) Schema lives in
  `netlify/database/migrations/001_init/migration.sql` — apply it manually (see setup).
- **Auth:** Netlify Identity (JWT verified by Netlify; `approved` / `is_admin` in `app_metadata`, mirrored to the DB)
- **Prices:** Twelve Data (primary, batched) → Finnhub (stock-only fallback)
- **Frontend:** vanilla HTML/CSS/JS, no build step

## Project layout

```
public/                     static frontend (published dir)
  index.html  app.js  lib-calc.js  styles.css  config.js  OneSignalSDKWorker.js
netlify/
  functions/
    _lib/       db, auth, http, prices, notify, validate, identity  (shared, not endpoints)
    me.js                     GET  bootstrap: identity + approval + channel status
    list-alerts.js            GET  caller's alerts
    create-alert.js           POST
    update-alert.js           PUT
    delete-alert.js           DELETE
    watchlist.js              GET/POST/DELETE
    get-telegram-link-code.js GET/POST
    link-onesignal.js         POST  store/clear push subscription id
    admin-list-pending.js     GET   admin only
    admin-approve-user.js     POST  admin only (also writes app_metadata back to Identity)
    telegram-webhook.js       POST  Telegram updates — handles /start <code>
    poll-alerts.js            Scheduled (every minute) — the alert engine (PRD §7)
    get-movers-risk.js        GET  V3 — watchlist movers + alert-distance (no external calls)
    get-symbol-chart.js       GET  V3 — on-demand Twelve Data /time_series proxy
    get-sector-breakdown.js   GET  V3 — stock watchlist grouped by sector
    refresh-symbol-metadata.js Scheduled (daily 06:00 UTC) — fills symbol_metadata via Finnhub profile
  database/migrations/
    001_init/migration.sql            core schema (apply manually)
    002_symbol_metadata/migration.sql V3 — sector/industry table (apply manually)
scripts/                    seed-admin, set-telegram-webhook, engine-test, v3-test
```

## V3 features (Movers & Risk / Sectors / Calculator)

- **Movers & Risk** (`#view-movers-risk`) — ranks your watchlist by size of move and shows
  how far the last price is from each active alert's target. Reads `price_cache` /
  `watchlist` / `alerts` only — **zero** extra market-data calls. Click a symbol for a
  hand-drawn canvas price chart (`get-symbol-chart.js` → Twelve Data `/time_series`,
  fetched only on click, key stays server-side).
- **Sector Breakdown** (`#view-sectors`) — your *stock* watchlist grouped by sector.
  `refresh-symbol-metadata.js` runs daily and populates `symbol_metadata` from Finnhub's
  `/stock/profile2` (Twelve Data's company profile isn't reliably on the free tier).
  Symbols with no metadata yet show as "Unclassified".
- **Position Calculator** (`#view-calculator`) — stateless: given shares owned, current
  average cost, a target average and a hypothetical buy price, solves for the shares to
  buy. Math lives in `public/lib-calc.js` and is unit-tested (`npm run test:v3`). Nothing
  is persisted.

## First-time setup

### 1. Link the site
```bash
npm install
npx netlify login
npx netlify link          # link to the existing "fx-stock-alerts" project
```

### 2. Database (Neon)
Create a free project at https://neon.tech, copy the **pooled** connection string
(host contains `-pooler`), and set it on the site:
```bash
# add DATABASE_URL=postgresql://...  to .env, then:
npx netlify env:import .env
```
Apply the schema once — either connect with `psql "$DATABASE_URL" -f
netlify/database/migrations/001_init/migration.sql`, or run each `CREATE` statement
from a SQL console. (`pgcrypto` isn't required on Neon — `gen_random_uuid()` is built in.)
Then apply the V3 migration the same way:
`psql "$DATABASE_URL" -f netlify/database/migrations/002_symbol_metadata/migration.sql`.

### 3. Netlify Identity
Dashboard → **fx-stock-alerts → Identity → Enable Identity**. Under
*Identity → Registration* choose **Open** or **Invite only** — either way new users
land on a *pending approval* screen until an admin approves them.
(Invite-only: add the first user via *Identity → Invite users*.)

> **Netlify Identity is in maintenance mode.** Existing/enabled instances keep
> working. If the site can't enable it, auth is isolated to
> `netlify/functions/_lib/auth.js` + `_lib/identity.js` + the Identity widget in
> `public/index.html` / `public/app.js` and can be swapped for another provider
> without touching the alert engine.

### 4. Deploy
```bash
npx netlify deploy --build --prod
```

### 5. Register the Telegram webhook
```bash
node scripts/set-telegram-webhook.js https://fx-stock-alerts.netlify.app/api/telegram-webhook
```
(reads `TELEGRAM_BOT_TOKEN` / `TELEGRAM_WEBHOOK_SECRET` from `.env`)

### 6. Make yourself the first admin
1. Open the deployed site, log in once (creates your user row).
2. `DATABASE_URL="postgres://..." node scripts/seed-admin.js you@example.com`
3. Set `app_metadata { "approved": true, "is_admin": true }` for that user in the
   Identity dashboard so the flags also ride on the JWT.

## Local development
```bash
cp .env.example .env      # fill in the same values incl. DATABASE_URL
npm run dev               # netlify dev on http://localhost:8888
```
Trigger the engine manually:
`curl -X POST http://localhost:8888/.netlify/functions/poll-alerts`
Run engine logic tests: `npm test`

## Environment variables (already set on the Netlify project)

| Var | Purpose |
|---|---|
| `TWELVE_DATA_API_KEY` | primary price source |
| `FINNHUB_API_KEY` | stock-only fallback |
| `TELEGRAM_BOT_TOKEN` | bot auth |
| `TELEGRAM_BOT_USERNAME` | cosmetic — shown in the linking UI |
| `TELEGRAM_WEBHOOK_SECRET` | verifies inbound Telegram webhook calls |
| `ONESIGNAL_APP_ID` / `ONESIGNAL_REST_API_KEY` | web push |
| `DATABASE_URL` | Neon pooled Postgres connection string |

`FINNHUB_API_KEY` doubles as the sector/industry source for the V3 Sector Breakdown
(`/stock/profile2`); no new variable is needed for any V3 feature.

`ONESIGNAL_APP_ID` is also in `public/config.js` (the browser copy).

## How the alert engine works (PRD §7)

Every minute `poll-alerts`:
1. loads alerts where `active AND next_check_due <= now()`
2. dedupes to **unique symbols** — one price fetch per symbol per cycle, never per alert/user
3. fetches Twelve Data (comma-batched, 8/call); retries failed **stocks** on Finnhub;
   failed **forex** symbols are skipped this cycle (`next_check_due` left unchanged)
4. upserts `price_cache`, evaluates each due alert:
   - `cross_above` / `cross_below`: price vs `target_value`
   - `pct_change`: `|Δ%|` vs `target_value`, where Δ% is vs `reference_price` if set,
     else the provider's previous-close change
   - a disarmed recurring alert **re-arms** first if price has crossed back
5. on trigger: Telegram + OneSignal fired **independently**, each logged to
   `notification_log`; one-time alerts go `active = FALSE`, recurring go `armed = FALSE`
6. every evaluated alert gets `next_check_due = now() + poll_interval_seconds`

## Security model
Every non-webhook, non-scheduled function calls `requireUser()` which:
verifies the Identity JWT (via Netlify's `clientContext.user`), loads the user row
**from the DB** (not client claims), and enforces `approved` / `is_admin` server-side.
Ownership is enforced with `WHERE user_id = <caller>` on every alert/watchlist query.
The Telegram webhook is verified with a shared secret token header.
