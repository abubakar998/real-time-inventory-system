import { useEffect, useRef, useState } from 'react';

/**
 * The live stock readout.
 *
 * The big number is the single most important thing on the card, so it is
 * oversized, monospaced (no width jitter as digits change) and pulses whenever
 * the value changes — which, thanks to the WebSocket, happens without the user
 * touching anything.
 */
export function StockMeter({ availableStock, reservedCount, soldCount, totalStock }) {
  const [pulse, setPulse] = useState(false);
  const previous = useRef(availableStock);

  useEffect(() => {
    if (previous.current === availableStock) return undefined;
    previous.current = availableStock;
    setPulse(true);
    const timer = setTimeout(() => setPulse(false), 700);
    return () => clearTimeout(timer);
  }, [availableStock]);

  const pct = (value) => (totalStock > 0 ? (value / totalStock) * 100 : 0);

  return (
    <div>
      <div className="flex items-end justify-between gap-3">
        <div className="flex items-baseline gap-2">
          <span
            key={availableStock}
            className={`font-mono text-4xl font-bold tabular-nums text-zinc-50 ${
              pulse ? 'animate-stock-pulse' : ''
            }`}
            aria-live="polite"
            aria-atomic="true"
          >
            {availableStock}
          </span>
          <span className="text-sm text-zinc-400">of {totalStock} available</span>
        </div>
      </div>

      {/* sold | reserved | available, always summing to total_stock */}
      <div
        className="mt-3 flex h-2 w-full overflow-hidden rounded-full bg-zinc-800"
        role="img"
        aria-label={`${soldCount} sold, ${reservedCount} on hold, ${availableStock} available`}
      >
        <div className="bg-rose-500/80 transition-all duration-500" style={{ width: `${pct(soldCount)}%` }} />
        <div className="bg-amber-400/80 transition-all duration-500" style={{ width: `${pct(reservedCount)}%` }} />
        <div className="bg-emerald-500/80 transition-all duration-500" style={{ width: `${pct(availableStock)}%` }} />
      </div>

      <dl className="mt-2 flex gap-4 text-xs text-zinc-400">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-emerald-500/80" />
          <dt className="sr-only">Available</dt>
          <dd className="tabular-nums">{availableStock} available</dd>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-amber-400/80" />
          <dt className="sr-only">On hold</dt>
          <dd className="tabular-nums">{reservedCount} on hold</dd>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-rose-500/80" />
          <dt className="sr-only">Sold</dt>
          <dd className="tabular-nums">{soldCount} sold</dd>
        </div>
      </dl>
    </div>
  );
}
