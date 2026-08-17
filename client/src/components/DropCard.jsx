import { Button } from './Button';
import { StockMeter } from './StockMeter';
import { ActivityFeed } from './ActivityFeed';
import { ReservationBar } from './ReservationBar';
import { formatPrice, STATUS_LABELS } from '../lib/format';

const STATUS_STYLES = {
  live: 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30',
  scheduled: 'bg-sky-500/10 text-sky-300 ring-sky-500/30',
  sold_out: 'bg-rose-500/10 text-rose-300 ring-rose-500/30',
  ended: 'bg-zinc-700/30 text-zinc-400 ring-zinc-600/40',
};

function StatusPill({ status }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${
        STATUS_STYLES[status] ?? STATUS_STYLES.ended
      }`}
    >
      {status === 'live' && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
        </span>
      )}
      {STATUS_LABELS[status] ?? status}
    </span>
  );
}

export function DropCard({ drop, currentUser, pending, onReserve, onPurchase, onCancel, onExpire }) {
  const isSignedIn = Boolean(currentUser);
  const canReserve = drop.status === 'live' && drop.availableStock > 0;

  const reserveBlockedReason = !isSignedIn
    ? 'Sign in to reserve'
    : drop.status === 'scheduled'
      ? `Opens ${new Date(drop.startsAt).toLocaleString()}`
      : drop.status === 'ended'
        ? 'Drop ended'
        : drop.availableStock <= 0
          ? 'Sold out'
          : null;

  return (
    <article className="flex flex-col gap-4 rounded-xl bg-zinc-900 p-5 ring-1 ring-inset ring-zinc-800">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-zinc-50" title={drop.name}>
            {drop.name}
          </h3>
          <p className="mt-0.5 font-mono text-lg font-semibold text-zinc-300">
            {formatPrice(drop.priceCents)}
          </p>
        </div>
        <StatusPill status={drop.status} />
      </header>

      {drop.description && (
        <p className="line-clamp-2 text-sm leading-relaxed text-zinc-400">{drop.description}</p>
      )}

      <StockMeter
        availableStock={drop.availableStock}
        reservedCount={drop.reservedCount}
        soldCount={drop.soldCount}
        totalStock={drop.totalStock}
      />

      {drop.myReservation ? (
        <ReservationBar
          dropId={drop.id}
          reservation={drop.myReservation}
          pending={pending}
          onPurchase={onPurchase}
          onCancel={onCancel}
          onExpire={onExpire}
        />
      ) : (
        <div>
          <Button
            className="w-full"
            loading={pending === 'reserve'}
            loadingLabel="Reserving…"
            disabled={!canReserve || !isSignedIn}
            onClick={() => onReserve(drop.id)}
          >
            {reserveBlockedReason ?? `Reserve for ${drop.reservationWindowSeconds}s`}
          </Button>
          {canReserve && isSignedIn && (
            <p className="mt-1.5 text-center text-xs text-zinc-500">
              Holds one pair for {drop.reservationWindowSeconds} seconds
            </p>
          )}
        </div>
      )}

      <ActivityFeed purchasers={drop.recentPurchasers} currentUserId={currentUser?.id} />
    </article>
  );
}
