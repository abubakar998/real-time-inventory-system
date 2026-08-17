'use strict';

const { QueryTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const config = require('../config/env');
const inventory = require('./inventory.service');
const dropsQuery = require('./drops.query');
const realtime = require('../realtime');

/**
 * Reservation expiry — two layers on purpose.
 *
 *  1. A per-reservation `setTimeout`, armed the moment a hold is created, so a
 *     unit comes back on sale within ~200ms of its deadline. This is the
 *     latency layer. It is best-effort: timers die with the process.
 *
 *  2. A periodic set-based sweep (SWEEP_INTERVAL_MS). This is the correctness
 *     layer. It asks the database "what is due *now*?" and fixes it, so nothing
 *     leaks if a timer was never armed, the process restarted, or a second
 *     instance created the reservation.
 *
 * Both layers call the exact same idempotent `sweepExpired()` transaction, so
 * they can never disagree or double-refund a unit. Deadlines are stored and
 * compared using the database clock (`now()`), never the Node clock, so app
 * servers with skewed clocks stay consistent.
 */

const timers = new Map(); // reservationId -> Timeout
let interval = null;
let sweeping = false;
let sweepQueued = false;

// Fire a hair after the deadline so the DB's `expires_at <= now()` is
// definitely true by the time the sweep runs.
const TIMER_GRACE_MS = 200;

async function runSweep(reason = 'interval') {
  // Collapse overlapping sweeps: if one is already running, remember that
  // another was requested and re-run once instead of piling up transactions.
  if (sweeping) {
    sweepQueued = true;
    return;
  }
  sweeping = true;

  try {
    const { expired, dropIds } = await inventory.sweepExpired();

    if (expired.length) {
      for (const reservation of expired) {
        clearTimerFor(reservation.id);
        realtime.toUser(reservation.userId, 'reservation:expired', {
          reservationId: reservation.id,
          dropId: reservation.dropId,
        });
      }

      // One broadcast per affected drop, carrying the freshly committed state.
      const drops = await Promise.all(dropIds.map((id) => dropsQuery.getPublicDrop(id)));
      for (const drop of drops) realtime.broadcastDrop(drop);

      console.log(
        `[expiry] reclaimed ${expired.length} reservation(s) across ${dropIds.length} drop(s) (${reason})`
      );
    }
  } catch (error) {
    // Never let a sweep failure kill the interval — the next tick retries.
    console.error('[expiry] sweep failed:', error.message);
  } finally {
    sweeping = false;
    if (sweepQueued) {
      sweepQueued = false;
      setImmediate(() => runSweep('coalesced'));
    }
  }
}

/** Arm the low-latency timer for a freshly created reservation. */
function scheduleFor(reservation) {
  if (!reservation?.id || !reservation.expiresAt) return;

  clearTimerFor(reservation.id);

  const delay = Math.max(0, new Date(reservation.expiresAt).getTime() - Date.now()) + TIMER_GRACE_MS;
  const timer = setTimeout(() => {
    timers.delete(reservation.id);
    runSweep('timer');
  }, delay);

  if (typeof timer.unref === 'function') timer.unref();
  timers.set(reservation.id, timer);
}

/** Disarm a timer once its reservation was purchased or cancelled. */
function clearTimerFor(reservationId) {
  const timer = timers.get(reservationId);
  if (timer) {
    clearTimeout(timer);
    timers.delete(reservationId);
  }
}

/**
 * On boot: reclaim anything that expired while the process was down, then
 * re-arm timers for holds that are still live.
 */
async function rehydrate() {
  await runSweep('startup');

  const rows = await sequelize.query(
    /* sql */ `
      SELECT id, expires_at AS "expiresAt"
      FROM reservations
      WHERE status = 'active' AND expires_at > now()
    `,
    { type: QueryTypes.SELECT }
  );

  for (const row of rows) scheduleFor(row);
  if (rows.length) console.log(`[expiry] re-armed ${rows.length} in-flight reservation timer(s)`);
}

function start() {
  if (interval) return;
  interval = setInterval(() => runSweep('interval'), config.sweepIntervalMs);
  if (typeof interval.unref === 'function') interval.unref();
  console.log(`[expiry] sweeper running every ${config.sweepIntervalMs}ms`);
}

function stop() {
  if (interval) clearInterval(interval);
  interval = null;
  for (const timer of timers.values()) clearTimeout(timer);
  timers.clear();
}

module.exports = { start, stop, rehydrate, scheduleFor, clearTimerFor, runSweep };
