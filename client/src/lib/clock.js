/**
 * Server-clock alignment.
 *
 * Reservation deadlines are decided by Postgres' `now()`, but the countdown is
 * rendered by the browser. A laptop whose clock is a few seconds fast would
 * show "expired" while the hold is still perfectly valid. Every API response
 * that carries `serverTime` feeds this offset, so the countdown always ticks in
 * server time.
 */

let offsetMs = 0;

export function syncFromServerTime(serverTime) {
  if (!serverTime) return;
  const parsed = Date.parse(serverTime);
  if (Number.isFinite(parsed)) offsetMs = parsed - Date.now();
}

/** Current time in the server's frame of reference. */
export function serverNow() {
  return Date.now() + offsetMs;
}

export function msUntil(isoTimestamp) {
  if (!isoTimestamp) return 0;
  return Math.max(0, Date.parse(isoTimestamp) - serverNow());
}
