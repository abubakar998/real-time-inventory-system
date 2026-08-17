'use strict';

// Postgres SQLSTATEs that mean "this transaction lost a race, but retrying is
// safe and will probably win": deadlock detected, serialization failure.
const TRANSIENT_SQLSTATES = new Set(['40P01', '40001']);

function sqlState(error) {
  return error?.parent?.code || error?.original?.code || error?.code || null;
}

function isTransient(error) {
  return TRANSIENT_SQLSTATES.has(sqlState(error));
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `fn` and retries only on transient Postgres contention errors.
 *
 * Reserving, purchasing and sweeping all touch `drops` and `reservations` rows
 * but can acquire them in different orders, so Postgres may pick one
 * transaction as a deadlock victim under heavy load. Every one of those
 * transactions is all-or-nothing, so a retry is always safe — never a partial
 * decrement left behind.
 */
async function withRetry(fn, { attempts = 4, baseDelayMs = 15, label = 'tx' } = {}) {
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (error) {
      if (!isTransient(error)) throw error;
      lastError = error;
      // Exponential backoff plus jitter, so retried transactions do not
      // stampede back into the same lock queue in lockstep.
      const delay = baseDelayMs * 2 ** (attempt - 1) * (0.5 + Math.random());
      console.warn(
        `[retry] ${label} hit ${sqlState(error)} on attempt ${attempt}/${attempts}; retrying in ${Math.round(delay)}ms`
      );
      await sleep(delay);
    }
  }

  throw lastError;
}

module.exports = { withRetry, isTransient, sqlState };
