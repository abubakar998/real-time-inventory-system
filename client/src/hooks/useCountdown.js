import { useEffect, useState } from 'react';
import { msUntil } from '../lib/clock';

/**
 * Ticks down to `expiresAt` in *server* time and calls `onExpire` once when it
 * reaches zero.
 *
 * The client-side timer is presentation only — it never decides that a hold is
 * dead. The server's sweeper does that and pushes `reservation:expired`. This
 * just stops the UI from showing a live "Complete Purchase" button for a
 * reservation that is already gone.
 */
export function useCountdown(expiresAt, onExpire) {
  const [remainingMs, setRemainingMs] = useState(() => msUntil(expiresAt));

  useEffect(() => {
    if (!expiresAt) {
      setRemainingMs(0);
      return undefined;
    }

    setRemainingMs(msUntil(expiresAt));
    let fired = false;

    const tick = () => {
      const next = msUntil(expiresAt);
      setRemainingMs(next);
      if (next <= 0 && !fired) {
        fired = true;
        onExpire?.();
      }
    };

    // 250ms keeps the displayed second honest without a visible stutter.
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [expiresAt, onExpire]);

  return remainingMs;
}
