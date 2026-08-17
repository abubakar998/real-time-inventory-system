# Testing Guide

How to verify every requirement yourself — an automated path that proves the
hard parts in about a minute, and a manual walkthrough that takes roughly
fifteen.

Each check names the requirement it covers, and what a pass actually looks like.

---

## Setup

```bash
npm install
cp server/.env.example server/.env      # then set DATABASE_URL
npm run db:migrate -- --drop            # clean slate
npm run db:seed                         # 5 shoppers + 3 drops
npm run dev                             # API :4000, client :5173
```

Open <http://localhost:5173> and sign in as `bakar`.

For a second shopper, open a **private/incognito window** and sign in as
`jordan`. Sign-in is stored in `localStorage`, so two normal tabs share one
user. (The **Switch** button in the header also changes user in place.)

Put the two windows side by side.

> If the server refuses to start, something is already listening on port 4000.

The seed gives you three drops chosen to exercise different paths:
**Air Jordan** (100 units, live), **Yeezy** (3 units — small enough to sell out
by hand), and **New Balance** (starts in 10 minutes, so it tests scheduling).

---

## Automated checks

### Oversell proof

With the server running, in a second terminal:

```bash
npm run stress                             # 1 unit, 100 simultaneous buyers
npm run stress -- --stock 5 --clients 250  # 5 units, 250 buyers
```

Creates a fresh drop, signs every racer in beforehand so login latency is not
part of the race, fires all requests in the same tick, then inspects the
**database** rather than trusting the API responses.

**Pass:** ends with `NO OVERSELL — all assertions passed.` Exactly 1 (or 5)
requests get `201`; the rest get `409 OUT_OF_STOCK`. Exit code is non-zero on
failure, so it works in CI.

### Health

```bash
curl -s http://localhost:4000/api/health
```

**Pass:** `{"ok":true,...}` — the API is up and the database answers.

---

## Manual walkthrough

### 1. Dashboard shows live stock — *Requirement 1*

Three cards, each with name, price, a large stock number, and a bar splitting
sold / on-hold / available.

**Pass:** Air Jordan shows `100`, Yeezy shows `3`, New Balance shows a blue
**Scheduled** pill with a disabled button.

### 2. Real-time sync across tabs — *Requirement 1*

With both windows visible, click **Reserve** on the Yeezy in the `bakar` window.

**Pass:** the `jordan` window's counter drops `3 → 2` **without a refresh**, and
the number pulses green. Both headers show a green **Live** badge.

### 3. A hold is not a sale — *Requirement 2*

Read the legend under the number you just reserved.

**Pass:** `2 available · 1 on hold · 0 sold`.

Click **Reserve** again as the same user.

**Pass:** red toast — *"You already have a live hold on this drop."*
(Enforced by a partial unique index, not by the UI.)

### 4. No overselling — *Requirement 2*

Reserve the Yeezy as `bakar`, then as `jordan`, then **Switch** to `imran` and
reserve. All 3 units are now held. Switch to `sara` and try.

**Pass:** red toast — *"Sold out — someone claimed the last one first."* — and
the button reads **Sold out**.

Then run the stress test above for the 100-way concurrent version.

### 5. Stock returns automatically — *Requirement 3*

Don't sit through 60 seconds. Click **New drop** and create one with
**Hold window (seconds) = 10** and stock 2.

Reserve it and watch both windows without touching anything.

**Pass:** the countdown turns amber then red; at zero the unit returns to
available on its own, a toast says *"Your hold on … expired."*, and **the other
window's number also goes back up** with nobody clicking.

### 6. Purchase — *Requirement 4*

Reserve, then click **Complete Purchase** before the timer runs out.

**Pass:** green toast *"Purchased. You are on the activity feed."*, the legend
moves that unit to **sold**, and the other window sees the change.

Let a different hold expire, then try to buy it: the button is already disabled,
and the API rejects it with `RESERVATION_EXPIRED`.

### 7. Drop creation API — *Requirement 5*

Use the **New drop** panel, or call the API directly:

```bash
curl -X POST http://localhost:4000/api/drops \
  -H "content-type: application/json" \
  -d '{"name":"Test Drop","priceCents":19900,"totalStock":10}'
```

**Pass:** `201`, and the drop appears in **both open windows without a refresh**.

Set *Starts at* to 10 minutes ahead to test scheduling: it shows **Scheduled**
and refuses reservations with `DROP_NOT_STARTED`.

### 8. Activity feed — *Requirement 6*

Buy the same drop as four different users, using **Switch** between each.

**Pass:** **Latest purchases** shows only the **3 most recent**, newest first,
with your own name highlighted as *(you)*.

Confirm the feed is nested in the drops response rather than fetched per card:

```bash
curl -s http://localhost:4000/api/drops | grep -o "recentPurchasers"
```

### 9. UI feedback — *what the brief actually grades*

- **Loading state** — Reserve shows a spinner and *"Reserving…"* while in flight
- **Error toast** — losing a race gives readable copy, not a raw error
- **Visible stock** — large, monospaced, pulses on change
- **Connection state** — stop the server with the page open: the header flips to
  amber **Reconnecting…**; restart it and the app recovers on its own

---

## Requirement coverage

| # | Requirement | Covered by |
|---|---|---|
| 1 | Live stock across all tabs | Manual 1–2 |
| 2 | Atomic reservation, no overselling | Manual 3–4 + `npm run stress` |
| 3 | 60s expiry and automatic stock recovery | Manual 5 |
| 4 | Purchase only what you reserved | Manual 6 |
| 5 | Merch drop creation API | Manual 7 |
| 6 | Top-3 activity feed, nested in the response | Manual 8 |
| — | UI feedback | Manual 9 |

Measured results from a verification run against a hosted Neon instance are in
the README under [Measured behaviour](../README.md#measured-behaviour).

---

## Recording the demo

Two things that make the video easier:

- Use the **10-second hold window** trick from step 5. A 60-second wait is dead
  air on camera.
- Open one window on `localhost:5173` and the other on `localhost:4000`. Both
  talk to the same API and database, so they sync with each other — and two
  visibly different addresses makes the point unmistakable.
