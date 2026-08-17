import { useCallback } from 'react';
import { Button } from './Button';
import { useCountdown } from '../hooks/useCountdown';
import { formatClock } from '../lib/format';

/**
 * The checkout window. Shows exactly how long is left on the hold, turning
 * amber then rose as it runs down, so "hurry up" is legible at a glance.
 */
export function ReservationBar({ dropId, reservation, pending, onPurchase, onCancel, onExpire }) {
  const handleExpire = useCallback(() => onExpire(dropId), [dropId, onExpire]);
  const remainingMs = useCountdown(reservation.expiresAt, handleExpire);

  const seconds = remainingMs / 1000;
  const tone =
    seconds > 30
      ? 'text-emerald-300 ring-emerald-500/30 bg-emerald-500/5'
      : seconds > 10
        ? 'text-amber-300 ring-amber-500/30 bg-amber-500/5'
        : 'text-rose-300 ring-rose-500/40 bg-rose-500/10';

  const isExpired = remainingMs <= 0;

  return (
    <div className={`rounded-lg p-3 ring-1 ring-inset ${tone}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider">
          {isExpired ? 'Hold expired' : 'Reserved for you'}
        </span>
        <span
          className="font-mono text-2xl font-bold tabular-nums"
          role="timer"
          aria-live="off"
          aria-label={`${Math.ceil(seconds)} seconds remaining`}
        >
          {formatClock(remainingMs)}
        </span>
      </div>

      <div className="mt-3 flex gap-2">
        <Button
          variant="primary"
          className="flex-1"
          loading={pending === 'purchase'}
          loadingLabel="Completing…"
          disabled={isExpired || pending === 'cancel'}
          onClick={() => onPurchase(dropId, reservation.id)}
        >
          Complete Purchase
        </Button>
        <Button
          variant="ghost"
          loading={pending === 'cancel'}
          loadingLabel="Releasing…"
          disabled={isExpired || pending === 'purchase'}
          onClick={() => onCancel(dropId, reservation.id)}
        >
          Release
        </Button>
      </div>
    </div>
  );
}
