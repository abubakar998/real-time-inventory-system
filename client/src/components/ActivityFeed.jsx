import { formatRelative } from '../lib/format';

const initials = (username) => username.slice(0, 2).toUpperCase();

/**
 * "Drop Activity Feed" — the 3 most recent successful purchasers, delivered
 * pre-nested by GET /api/drops and refreshed by every `drop:updated` broadcast.
 */
export function ActivityFeed({ purchasers = [], currentUserId }) {
  return (
    <section className="rounded-lg bg-zinc-950/60 p-3 ring-1 ring-inset ring-zinc-800">
      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
        Latest purchases
      </h4>

      {purchasers.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-600">No one has bought this yet. Be first.</p>
      ) : (
        <ol className="mt-2 space-y-1.5">
          {purchasers.map((purchaser) => {
            const isYou = purchaser.userId === currentUserId;
            return (
              <li
                key={`${purchaser.userId}-${purchaser.purchasedAt}`}
                className="animate-fade-slide-in flex items-center gap-2.5 text-sm"
              >
                <span
                  className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[10px] font-bold ${
                    isYou ? 'bg-emerald-500 text-emerald-950' : 'bg-zinc-800 text-zinc-300'
                  }`}
                  aria-hidden="true"
                >
                  {initials(purchaser.username)}
                </span>
                <span className={`truncate ${isYou ? 'font-semibold text-emerald-300' : 'text-zinc-200'}`}>
                  {purchaser.username}
                  {isYou && <span className="ml-1 text-xs font-normal text-emerald-400/80">(you)</span>}
                </span>
                <time
                  className="ml-auto shrink-0 text-xs text-zinc-500"
                  dateTime={purchaser.purchasedAt}
                >
                  {formatRelative(purchaser.purchasedAt)}
                </time>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
