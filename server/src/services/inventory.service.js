'use strict';

const { QueryTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const { withRetry, sqlState } = require('../lib/retry');
const { notFound, conflict, forbidden, AppError } = require('../lib/errors');
const dropsQuery = require('./drops.query');

/* ---------------------------------------------------------------------------
 * RESERVE
 *
 * The whole anti-oversell story lives in this one statement.
 *
 * `UPDATE ... WHERE available > 0` is atomic because Postgres takes a row-level
 * lock on the drop before applying the update. Under READ COMMITTED, a
 * transaction that blocks on that lock *re-evaluates its WHERE clause against
 * the newly committed row* once the lock is released. So if 100 requests race
 * for the last unit, they serialise on the lock, the first one sets available
 * to 0, and the other 99 re-check, fail the predicate, and update zero rows.
 *
 * That is why this is a single conditional UPDATE and not
 * `SELECT available -> if (available > 0) -> UPDATE`: the read-then-write
 * version has a window between the two statements where every request sees the
 * same stale count, which is exactly how overselling happens.
 * ------------------------------------------------------------------------- */
const CLAIM_UNIT_SQL = /* sql */ `
  UPDATE drops
     SET reserved_count = reserved_count + 1,
         updated_at     = now()
   WHERE id = $1
     AND now() >= starts_at
     AND (ends_at IS NULL OR now() < ends_at)
     AND total_stock - reserved_count - sold_count > 0
  RETURNING id,
            price_cents                AS "priceCents",
            reservation_window_seconds AS "reservationWindowSeconds"
`;

const CREATE_RESERVATION_SQL = /* sql */ `
  INSERT INTO reservations (drop_id, user_id, status, expires_at, created_at, updated_at)
  VALUES ($1, $2, 'active', now() + make_interval(secs => $3::int), now(), now())
  RETURNING id,
            drop_id    AS "dropId",
            user_id    AS "userId",
            status,
            expires_at AS "expiresAt",
            created_at AS "createdAt"
`;

/**
 * Works out *why* the conditional claim matched no rows, for a useful message.
 *
 * Runs on the caller's own transaction on purpose. Borrowing a second pool
 * connection here would starve the pool under load: every in-flight
 * transaction already holds one connection, so 20 losing racers each waiting
 * for a 21st would deadlock the pool until `acquire` timed out.
 */
async function explainFailedClaim(dropId, transaction) {
  const [row] = await sequelize.query(
    /* sql */ `
      SELECT id,
             now() < starts_at                                AS "notStarted",
             (ends_at IS NOT NULL AND now() >= ends_at)        AS "ended",
             (total_stock - reserved_count - sold_count)       AS available
      FROM drops
      WHERE id = $1
    `,
    { bind: [dropId], type: QueryTypes.SELECT, transaction }
  );

  if (!row) return notFound('DROP_NOT_FOUND', 'That drop no longer exists.');
  if (row.notStarted) return conflict('DROP_NOT_STARTED', 'This drop has not started yet.');
  if (row.ended) return conflict('DROP_ENDED', 'This drop has ended.');
  return conflict('OUT_OF_STOCK', 'Sold out — someone beat you to the last one.');
}

/**
 * Atomically hold one unit of `dropId` for `userId`.
 * Resolves with `{ reservation, drop }` where `drop` is the fresh public state.
 */
async function reserve({ dropId, userId }) {
  const reservation = await withRetry(
    () =>
      sequelize.transaction(async (transaction) => {
        const [claimed] = await sequelize.query(CLAIM_UNIT_SQL, {
          bind: [dropId],
          transaction,
        });

        if (!claimed.length) throw await explainFailedClaim(dropId, transaction);

        const { reservationWindowSeconds } = claimed[0];

        try {
          const [created] = await sequelize.query(CREATE_RESERVATION_SQL, {
            bind: [dropId, userId, reservationWindowSeconds],
            transaction,
          });
          return created[0];
        } catch (error) {
          // Partial unique index `reservations_one_active_per_user_drop`.
          // Rolling back also releases the unit we just claimed above — the
          // claim and the reservation row live or die together.
          if (sqlState(error) === '23505') {
            throw conflict(
              'ALREADY_RESERVED',
              'You already have a live reservation for this drop.'
            );
          }
          if (sqlState(error) === '23503') {
            throw notFound('USER_NOT_FOUND', 'Your session is stale — sign in again.');
          }
          throw error;
        }
      }),
    { label: 'reserve' }
  );

  const drop = await dropsQuery.getPublicDrop(dropId);
  return { reservation, drop };
}

/* ---------------------------------------------------------------------------
 * PURCHASE
 * ------------------------------------------------------------------------- */
const COMPLETE_RESERVATION_SQL = /* sql */ `
  UPDATE reservations
     SET status     = 'completed',
         updated_at = now()
   WHERE id      = $1
     AND user_id = $2
     AND status  = 'active'
     AND expires_at > now()
  RETURNING id, drop_id AS "dropId"
`;

const SETTLE_STOCK_SQL = /* sql */ `
  UPDATE drops
     SET reserved_count = reserved_count - 1,
         sold_count     = sold_count + 1,
         updated_at     = now()
   WHERE id = $1
     AND reserved_count > 0
  RETURNING price_cents AS "priceCents"
`;

const RECORD_PURCHASE_SQL = /* sql */ `
  INSERT INTO purchases (drop_id, user_id, reservation_id, price_cents, created_at)
  VALUES ($1, $2, $3, $4, now())
  RETURNING id,
            drop_id        AS "dropId",
            user_id        AS "userId",
            reservation_id AS "reservationId",
            price_cents    AS "priceCents",
            created_at     AS "createdAt"
`;

/** Same pool-safety rule as explainFailedClaim: reuse the caller's connection. */
async function explainFailedCompletion(reservationId, userId, transaction) {
  const [row] = await sequelize.query(
    /* sql */ `
      SELECT id, user_id AS "userId", status, expires_at <= now() AS "isDue"
      FROM reservations
      WHERE id = $1
    `,
    { bind: [reservationId], type: QueryTypes.SELECT, transaction }
  );

  if (!row) return notFound('RESERVATION_NOT_FOUND', 'That reservation does not exist.');
  if (row.userId !== userId) {
    return forbidden('NOT_YOUR_RESERVATION', 'That reservation belongs to someone else.');
  }
  if (row.status === 'completed') {
    return conflict('ALREADY_PURCHASED', 'You have already completed this purchase.');
  }
  if (row.status === 'cancelled') {
    return conflict('RESERVATION_CANCELLED', 'You cancelled this reservation.');
  }
  // 'expired', or still 'active' but past its deadline and not yet swept.
  return conflict('RESERVATION_EXPIRED', 'Your 60-second hold expired — the item went back on sale.');
}

/**
 * Convert a live reservation into a permanent sale.
 * Resolves with `{ purchase, dropId, drop }`.
 */
async function purchase({ reservationId, userId }) {
  const result = await withRetry(
    () =>
      sequelize.transaction(async (transaction) => {
        // Claiming the reservation row first also locks it, which is what stops
        // the expiry sweeper from reclaiming this unit mid-checkout: the sweeper
        // blocks on the same row, then re-evaluates `status = 'active'` and
        // skips it.
        const [completed] = await sequelize.query(COMPLETE_RESERVATION_SQL, {
          bind: [reservationId, userId],
          transaction,
        });

        if (!completed.length) {
          throw await explainFailedCompletion(reservationId, userId, transaction);
        }

        const { dropId } = completed[0];

        const [settled] = await sequelize.query(SETTLE_STOCK_SQL, {
          bind: [dropId],
          transaction,
        });

        if (!settled.length) {
          // Unreachable unless the counters have been corrupted out of band.
          throw new AppError(500, 'STOCK_INCONSISTENT', 'Stock counters are inconsistent.');
        }

        const [recorded] = await sequelize.query(RECORD_PURCHASE_SQL, {
          bind: [dropId, userId, reservationId, settled[0].priceCents],
          transaction,
        });

        return { purchase: recorded[0], dropId };
      }),
    { label: 'purchase' }
  );

  const drop = await dropsQuery.getPublicDrop(result.dropId);
  return { ...result, drop };
}

/* ---------------------------------------------------------------------------
 * CANCEL — voluntary early release of a hold.
 * ------------------------------------------------------------------------- */
const CANCEL_RESERVATION_SQL = /* sql */ `
  UPDATE reservations
     SET status     = 'cancelled',
         updated_at = now()
   WHERE id      = $1
     AND user_id = $2
     AND status  = 'active'
  RETURNING id, drop_id AS "dropId"
`;

async function cancel({ reservationId, userId }) {
  const result = await withRetry(
    () =>
      sequelize.transaction(async (transaction) => {
        const [cancelled] = await sequelize.query(CANCEL_RESERVATION_SQL, {
          bind: [reservationId, userId],
          transaction,
        });

        if (!cancelled.length) {
          throw await explainFailedCompletion(reservationId, userId, transaction);
        }

        const { dropId } = cancelled[0];

        await sequelize.query(
          /* sql */ `
            UPDATE drops
               SET reserved_count = reserved_count - 1,
                   updated_at     = now()
             WHERE id = $1 AND reserved_count > 0
          `,
          { bind: [dropId], transaction }
        );

        return { reservationId: cancelled[0].id, dropId };
      }),
    { label: 'cancel' }
  );

  const drop = await dropsQuery.getPublicDrop(result.dropId);
  return { ...result, drop };
}

/* ---------------------------------------------------------------------------
 * SWEEP — reclaim every hold whose 60 seconds are up.
 *
 * Set-based and idempotent: it expires whatever is due *right now* according to
 * the database clock, so it behaves identically whether it is triggered by a
 * per-reservation timer, the periodic interval, or a fresh process booting
 * after a crash.
 * ------------------------------------------------------------------------- */
/**
 * Expire due holds and return their units to available stock in ONE statement.
 *
 * Chained data-modifying CTEs share a single snapshot and commit together, so
 * this is atomic without an explicit BEGIN/COMMIT — which matters more than it
 * looks: expiry latency is user-visible, and against a remote database the
 * multi-statement version spent four network round trips where this spends one.
 *
 * `FOR UPDATE SKIP LOCKED` is what keeps checkout and expiry out of each
 * other's way. A reservation locked by an in-flight purchase is skipped rather
 * than waited on, so one slow checkout cannot stall recovery for every other
 * drop. If that hold is still due on the next tick it gets picked up then; if
 * the purchase committed, it is no longer 'active' and is correctly ignored.
 */
const SWEEP_SQL = /* sql */ `
  WITH due AS (
    SELECT id
    FROM reservations
    WHERE status = 'active' AND expires_at <= now()
    FOR UPDATE SKIP LOCKED
  ),
  expired AS (
    UPDATE reservations r
       SET status     = 'expired',
           updated_at = now()
      FROM due
     WHERE r.id = due.id
    RETURNING r.id, r.drop_id AS "dropId", r.user_id AS "userId"
  ),
  counts AS (
    SELECT "dropId", count(*)::int AS n
    FROM expired
    GROUP BY "dropId"
  ),
  restocked AS (
    UPDATE drops d
       SET reserved_count = d.reserved_count - c.n,
           updated_at     = now()
      FROM counts c
     WHERE d.id = c."dropId"
    RETURNING d.id
  )
  SELECT id, "dropId", "userId" FROM expired
`;

/**
 * Resolves with `{ expired: [{ id, dropId, userId }], dropIds: [] }`.
 * Returns empty arrays when nothing was due — callers use that to stay quiet.
 */
async function sweepExpired() {
  return withRetry(
    async () => {
      const expired = await sequelize.query(SWEEP_SQL, { type: QueryTypes.SELECT });

      if (!expired.length) return { expired: [], dropIds: [] };

      return { expired, dropIds: [...new Set(expired.map((row) => row.dropId))] };
    },
    { label: 'sweep' }
  );
}

module.exports = { reserve, purchase, cancel, sweepExpired };
