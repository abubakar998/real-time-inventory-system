# Drop Room — Real-Time High-Traffic Inventory System

A limited-edition sneaker drop: live stock across every open tab, a 60-second
atomic reservation that cannot oversell, automatic stock recovery when a hold
lapses, and a per-drop activity feed of the latest buyers.

**Stack:** React 18 + Vite + Tailwind · Node 20 + Express · PostgreSQL ·
Sequelize · Socket.io

---

## Contents

- [Quick start](#quick-start)
- [Proving it does not oversell](#proving-it-does-not-oversell)
- [Architecture](#architecture)
  - [Concurrency: how overselling is prevented](#concurrency-how-overselling-is-prevented)
  - [Expiration: how the 60-second window works](#expiration-how-the-60-second-window-works)
  - [Real-time propagation](#real-time-propagation)
  - [The activity feed](#the-activity-feed-in-one-query)
- [Data model](#data-model)
- [API reference](#api-reference)
- [Deployment](#deployment)
- [Project layout](#project-layout)
- [Trade-offs and known limits](#trade-offs-and-known-limits)

---

## Quick start

### 1. Requirements

- Node 20+
- A PostgreSQL 12+ database — local, or a free [Neon](https://neon.tech) project

### 2. Install

```bash
npm install          # installs both workspaces (server + client)
```

### 3. Configure

```bash
cp server/.env.example server/.env
```

Set `DATABASE_URL` in `server/.env`:

```ini
# local
DATABASE_URL=postgres://postgres:postgres@localhost:5432/inventory
# or Neon (TLS is auto-detected for neon.tech URLs)
DATABASE_URL=postgres://user:pass@ep-xxx.aws.neon.tech/neondb?sslmode=require
```

If you are using a local Postgres, create the database first:

```bash
createdb inventory        # or: psql -c "CREATE DATABASE inventory;"
```

### 4. Create the schema

```bash
npm run db:migrate        # applies server/sql/schema.sql (idempotent)
npm run db:seed           # 5 demo shoppers + 3 drops (100 / 3 / scheduled units)
```

`schema.sql` is the single source of truth for the database shape — the
Sequelize models mirror it and `sequelize.sync()` is never called, so the
schema can never silently drift under you. To start over:

```bash
npm run db:migrate -- --drop && npm run db:seed
```

You can also apply the schema by hand:

```bash
psql "$DATABASE_URL" -f server/sql/schema.sql
```

### 5. Run

```bash
npm run dev               # API on :4000, client on :5173
```

Open <http://localhost:5173>, sign in as `bakar`. Open a second window
(use a private window so it gets its own `localStorage`) and sign in as
`jordan`. Reserve in one — the stock counter moves in the other immediately.

> **Sign-in is passwordless by design.** You type a name and get a user row.
> That is enough to exercise every inventory rule (reservation ownership, one
> hold per user per drop) without turning the assessment into an auth exercise.
> See [Trade-offs](#trade-offs-and-known-limits).

---

## Proving it does not oversell

With the server running:

```bash
npm run stress                          # 1 unit, 100 racers
npm run stress -- --stock 5 --clients 250
```

The script creates a fresh drop, signs in N distinct users up front (so login
latency is not part of the race), fires every reserve request in the same tick,
then checks the **database**, not the API responses:

```
--- Responses ------------------------------------
  201 reserved            : 1
  OUT_OF_STOCK            : 99

--- Database -------------------------------------
  total_stock             : 1
  reserved_count          : 1
  available               : 0
  active reservation rows : 1

--- Assertions -----------------------------------
  PASS  successful reservations == stock
  PASS  reserved_count == stock
  PASS  reservation rows == stock
  PASS  available never negative
```

Exit code is non-zero if anything oversells, so it drops straight into CI.

### Measured behaviour

Verified end-to-end against a hosted Neon instance (`us-east-2`) from a laptop
with a **253ms median round trip** to the database — a deliberately unforgiving
setup, since every round trip is visible in the numbers:

| Check | Result |
|---|---|
| 100 racers, 1 unit | 1 × `201`, 99 × `409 OUT_OF_STOCK`, `available = 0` |
| 150 racers, 5 units | 5 × `201`, 145 × `409`, `reserved_count = 5` |
| Expiry → stock back on sale | ~610ms after the deadline (200ms timer grace + 2 round trips) |
| Dashboard read model | 14 drops with nested top-3 feeds in **266ms** — one round trip, no N+1 |
| Functional suite | 36/36 across reserve, purchase, cancel, expiry, feed ordering, scheduling, validation, authorisation and WebSocket delivery |

Expiry latency here is dominated by network distance, not by design: the same
code against a co-located database is bounded by the 200ms timer grace plus two
local round trips. `SWEEP_INTERVAL_MS` bounds the worst case if a timer is lost.

---

## Architecture

### Concurrency: how overselling is prevented

Stock is **three counters, not one**:

```
available = total_stock - reserved_count - sold_count
```

Nothing is ever destroyed — a unit only moves between buckets
(`available → reserved → sold`, or `reserved → available` on expiry), which
makes the whole system auditable.

Reserving is **one conditional UPDATE**, and that single statement is the entire
anti-oversell mechanism:

```sql
UPDATE drops
   SET reserved_count = reserved_count + 1
 WHERE id = $1
   AND now() >= starts_at
   AND (ends_at IS NULL OR now() < ends_at)
   AND total_stock - reserved_count - sold_count > 0
RETURNING id, reservation_window_seconds;
```

Why this is safe under 100 simultaneous requests for 1 unit:

1. Postgres takes a **row-level lock** on the drop before applying the update,
   so the 100 requests queue on that one row instead of running in parallel.
2. Under `READ COMMITTED`, a transaction that blocked on the lock
   **re-evaluates its `WHERE` clause against the newly committed row** when the
   lock is released.
3. The first request sets `available` to 0 and commits. The other 99 wake up,
   re-check the predicate, fail it, and update **zero rows** — which the service
   turns into a `409 OUT_OF_STOCK`.

The naive version — `SELECT available` → `if (available > 0)` → `UPDATE` — has a
window between the read and the write where all 100 requests see the same stale
count. That is exactly how overselling happens, and it is why there is no
`SELECT` before the write here.

Three further layers back this up:

| Layer | Mechanism | Catches |
|---|---|---|
| Schema | `CHECK (reserved_count + sold_count <= total_stock)` | Any bug that ever tried to oversell — the transaction aborts |
| Schema | Partial unique index on `(drop_id, user_id) WHERE status = 'active'` | One shopper hoarding multiple holds on the same drop |
| Schema | `UNIQUE (reservation_id)` on `purchases` | A double-clicked "Complete Purchase" |

The claim and the reservation row are written in **one transaction**, so they
live or die together: if the `INSERT` trips the partial unique index, the
rollback releases the unit that was just claimed. There is no path that
decrements stock without producing a reservation.

Reserve, purchase and sweep touch `drops` and `reservations` in different
orders, so Postgres can occasionally pick one as a deadlock victim under load.
Every one of those transactions is all-or-nothing, so
[`withRetry`](server/src/lib/retry.js) simply retries on SQLSTATE `40P01` /
`40001` with jittered backoff — never a partial decrement left behind.

### Expiration: how the 60-second window works

Two layers, deliberately, because a timer alone is not durable and a poll alone
is not fast:

**1. Latency layer — a per-reservation `setTimeout`.** Armed the instant a hold
is created, it fires 200ms past the deadline and triggers a sweep. This is what
stops a lapsed unit from sitting unsellable until the next poll. It is
best-effort: timers die with the process.

**2. Correctness layer — a periodic set-based sweep** (`SWEEP_INTERVAL_MS`,
default 2s). It asks the database "what is due *right now*?" and fixes it in a
**single statement** — chained data-modifying CTEs share one snapshot and commit
together, so it is atomic without an explicit `BEGIN`/`COMMIT`:

```sql
WITH due AS (
  SELECT id FROM reservations
   WHERE status = 'active' AND expires_at <= now()
   FOR UPDATE SKIP LOCKED
), expired AS (
  UPDATE reservations r SET status = 'expired' FROM due
   WHERE r.id = due.id
  RETURNING r.id, r.drop_id AS "dropId", r.user_id AS "userId"
), counts AS (
  SELECT "dropId", count(*)::int AS n FROM expired GROUP BY "dropId"
), restocked AS (
  UPDATE drops d SET reserved_count = d.reserved_count - c.n
    FROM counts c WHERE d.id = c."dropId"
  RETURNING d.id
)
SELECT id, "dropId", "userId" FROM expired;
```

One statement rather than four matters more than it looks: expiry latency is
user-visible, and against a remote database each round trip costs real time
(measured below).

Both layers call the **same idempotent function**, so they cannot disagree or
double-refund a unit. Because the sweep is driven purely by
`expires_at <= now()`, it behaves identically whether it was triggered by a
timer, the interval, or a process that just booted — on startup the server
sweeps once for anything that lapsed while it was down, then re-arms timers for
holds that are still live.

**The checkout-versus-expiry race is handled by row locks, not by luck.** A
purchase updates the reservation row first, which locks it. `FOR UPDATE SKIP
LOCKED` means a sweep landing mid-checkout **skips** that row instead of
blocking on it — so one slow checkout cannot stall recovery for every other
drop. If the hold is still due next tick it is picked up then; if the purchase
committed, it is no longer `'active'` and is correctly ignored. The unit can be
sold or reclaimed — never both.

Every deadline is written and compared using the **database clock** (`now()`),
never `Date.now()` on an app server. This is not theoretical: the machine this
was verified on runs **792ms ahead of** the Neon instance. An early version
defaulted a new drop's `starts_at` to `new Date()`, which wrote a timestamp in
the *database's* future and made freshly created drops reject reservations with
`DROP_NOT_STARTED` for the first ~800ms of their life. Drop creation now uses
`fn('NOW')` so "starts immediately" means immediate on the clock that decides.

The browser countdown is presentation only: the client tracks its offset from
the server's clock (see [`clock.js`](client/src/lib/clock.js)), and hitting zero
locally just greys the buttons out and resyncs — the server still decides.

### Real-time propagation

| Event | Direction | Payload |
|---|---|---|
| `drops:snapshot` | server → socket, on connect/reconnect | Full drop list, so a tab that slept through a network blip re-syncs without polling |
| `drop:updated` | server → **all** | One drop's new public state: counters *and* refreshed top-3 feed |
| `drop:created` | server → **all** | A new drop appears on open dashboards |
| `reservation:expired` | server → **one user's room** | Your hold lapsed |
| `identify` | client → server | Move this socket into `user:<id>` after sign-in |

Broadcasts are deliberately **user-agnostic** — `myReservation` is stripped
before fanning out, so a payload meant for everyone can never leak one
shopper's state. The client merges by id and keeps its own locally-known hold,
which means a remote user's reserve can never wipe your countdown off screen.

Every broadcast is read **after the transaction commits**, so clients only ever
see states the database actually reached.

### The activity feed, in one query

`GET /api/drops` returns each drop with its top 3 buyers already nested — no
N+1, no second round trip. A `LATERAL` join lets Postgres run a 3-row indexed
lookup per drop against `purchases_feed_idx (drop_id, created_at DESC, id DESC)`:

```sql
LEFT JOIN LATERAL (
  SELECT json_agg(row_to_json(latest)) AS recent
  FROM (
    SELECT u.id AS "userId", u.username, p.created_at AS "purchasedAt"
    FROM purchases p JOIN users u ON u.id = p.user_id
    WHERE p.drop_id = d.id
    ORDER BY p.created_at DESC, p.id DESC
    LIMIT 3
  ) latest
) feed ON TRUE
```

A second `LATERAL` attaches the requesting user's own live hold, so the whole
dashboard — stock, feed, and your countdown — is one query.

---

## Data model

```
users                drops                         reservations                purchases
-----                -----                         ------------                ---------
id                   id                            id                          id
username (uniq ci)   name                          drop_id  ──> drops          drop_id  ──> drops
created_at           description                   user_id  ──> users          user_id  ──> users
updated_at           image_url                     status (enum)               reservation_id (uniq)
                     price_cents                     active|completed|         price_cents
                     total_stock                     expired|cancelled         created_at
                     reserved_count                expires_at
                     sold_count                    created_at
                     reservation_window_seconds    updated_at
                     starts_at
                     ends_at
                     created_at / updated_at
```

Notable choices:

- **Money is integer cents.** No floats anywhere near a price.
- **`purchases.price_cents` is snapshotted** at purchase time — editing a drop's
  price later must not rewrite history.
- **`reservation_window_seconds` is per drop**, defaulting to the required 60.
  A drop can be created with a different window, which makes demos and stress
  runs practical without touching config.
- **`starts_at` / `ends_at`** make a drop schedulable. `starts_at` defaults to
  `now()` (live immediately); reserving before it returns `DROP_NOT_STARTED`.
  `ends_at` is optional — an open-ended drop simply runs until it sells out.
  Drop status (`scheduled` / `live` / `sold_out` / `ended`) is **derived** from
  timestamps and counters, never stored, so it can never go stale.
- **Reservations are never deleted.** `expired` and `cancelled` rows stay as an
  audit trail of demand.

Indexes are chosen for the three hot paths: the partial
`reservations_due_idx (expires_at) WHERE status = 'active'` keeps the sweep
O(due rows) regardless of history, `purchases_feed_idx` serves the feed, and the
partial unique index enforces one live hold per user per drop.

---

## API reference

All errors share one shape, with a stable machine-readable `code` so the client
never string-matches on prose:

```json
{ "error": { "code": "OUT_OF_STOCK", "message": "Sold out — someone beat you to the last one." } }
```

Authenticated routes take an `x-user-id` header.

| Method | Route | Auth | Notes |
|---|---|---|---|
| `GET` | `/api/health` | — | Also pings the DB |
| `POST` | `/api/auth/login` | — | `{ username }` → get-or-create, case-insensitive |
| `GET` | `/api/drops` | optional | Drops + nested top-3 feed + your live hold |
| `POST` | `/api/drops` | admin* | Initialise a merch drop |
| `GET` | `/api/drops/:id` | optional | Same shape, one drop |
| `POST` | `/api/drops/:id/reserve` | ✅ | Atomic hold, `201` or `409` |
| `POST` | `/api/reservations/:id/purchase` | ✅ | Converts a live hold into a sale |
| `POST` | `/api/reservations/:id/cancel` | ✅ | Releases a hold early |
| `GET` | `/api/reservations/mine` | ✅ | Your last 25 holds and their outcome |

\* `POST /api/drops` requires `x-admin-token` **only if** `ADMIN_TOKEN` is set.
It is left unset locally to keep setup frictionless; set it in any deployed
environment.

**Create a drop:**

```bash
curl -X POST http://localhost:4000/api/drops \
  -H 'content-type: application/json' \
  -d '{
    "name": "Air Jordan 1 — Chicago",
    "description": "The original colourway.",
    "priceCents": 22000,
    "totalStock": 100,
    "reservationWindowSeconds": 60,
    "startsAt": "2026-08-18T18:00:00Z"
  }'
```

Only `total_stock` is settable — `reserved_count` and `sold_count` always start
at 0 and are derived from then on, so the availability invariant holds from the
first row.

**Error codes:** `OUT_OF_STOCK`, `ALREADY_RESERVED`, `RESERVATION_EXPIRED`,
`ALREADY_PURCHASED`, `NOT_YOUR_RESERVATION`, `DROP_NOT_STARTED`, `DROP_ENDED`,
`DROP_NOT_FOUND`, `RESERVATION_NOT_FOUND`, `VALIDATION_FAILED`,
`UNAUTHENTICATED`, `ADMIN_TOKEN_REQUIRED`.

---

## Deployment

**Database:** [Neon](https://neon.tech). Copy the pooled connection string into
`DATABASE_URL`; TLS is auto-detected for `neon.tech` hosts. Apply the schema
once with `npm run db:migrate` (or `psql "$DATABASE_URL" -f server/sql/schema.sql`).

**App:** the spec suggests Vercel, and that works for the React client — but
**not for this backend**. Socket.io needs a persistent process holding open
connections, and Vercel's Node functions are short-lived and serverless; a
socket server deployed there will connect, then drop. Two honest options:

1. **Single origin (recommended).** Deploy the whole repo to Render / Railway /
   Fly as one long-lived Node service. `npm run build` produces `client/dist`,
   which Express serves automatically, so the SPA and the WebSocket share a
   host and CORS is a non-issue. [`render.yaml`](render.yaml) is included:
   build `npm install && npm run build`, start `npm start`, health check
   `/api/health`.

2. **Split hosts.** Client on Vercel, API on Render/Railway/Fly. Set
   `VITE_API_URL=https://your-api-host` at client build time and
   `CLIENT_ORIGIN=https://your-vercel-app.vercel.app` on the server.

Never commit `server/.env` — it is gitignored. Set `DATABASE_URL`,
`CLIENT_ORIGIN` and `ADMIN_TOKEN` through the host's environment settings.

---

## Project layout

```
server/
  sql/schema.sql              canonical schema (source of truth)
  scripts/
    migrate.js                applies schema.sql        (npm run db:migrate)
    seed.js                   demo users + drops        (npm run db:seed)
    stress-reserve.js         oversell proof            (npm run stress)
  src/
    config/                   env parsing, Sequelize instance
    models/                   Sequelize models mirroring schema.sql
    lib/                      typed errors, deadlock retry
    services/
      inventory.service.js    reserve / purchase / cancel / sweep  ← the core
      expiration.service.js   timers + periodic sweep + startup rehydrate
      drops.query.js          dashboard read model (LATERAL joins)
    realtime/                 Socket.io wiring, broadcast helpers
    routes/                   HTTP surface, zod validation
    middleware/               identity, error shaping
client/
  src/
    lib/                      api client, socket singleton, server-clock sync
    hooks/useDrops.js         live dashboard state (REST + WebSocket merge)
    hooks/useCountdown.js     server-time countdown
    components/               DropCard, StockMeter, ReservationBar, ActivityFeed…
```

---

## Trade-offs and known limits

Called out deliberately rather than left for you to find:

- **Passwordless identity.** `x-user-id` is trusted after the server confirms
  the row exists. Swapping in a signed session cookie or JWT means changing
  [`middleware/auth.js`](server/src/middleware/auth.js) only — nothing
  downstream reads the header.
- **Single-instance expiry timers.** The `setTimeout` layer is per process. Run
  two instances and each only holds timers for holds it created — which is
  exactly why the durable set-based sweep exists, and why it is the layer that
  defines correctness. Horizontal scaling therefore works today, with expiry
  latency bounded by `SWEEP_INTERVAL_MS` for holds created on another instance.
- **Socket.io broadcasts are in-process.** Multi-instance deployments need the
  Redis adapter (`@socket.io/redis-adapter`) so a reservation on instance A
  reaches tabs connected to instance B. Single instance needs nothing.
- **No payment step.** "Complete Purchase" is the commit point; a real
  integration would hold the reservation across a payment-intent round trip and
  only then flip `reserved → sold`.
- **No rate limiting.** A production drop would need per-IP and per-user limits
  in front of `/reserve` to blunt bots.
