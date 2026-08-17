const currency = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

export const formatPrice = (cents) => currency.format((cents ?? 0) / 100);

export function formatClock(ms) {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function formatRelative(isoTimestamp) {
  const then = Date.parse(isoTimestamp);
  if (!Number.isFinite(then)) return '';

  const seconds = Math.round((Date.now() - then) / 1000);
  if (seconds < 45) return 'just now';
  if (seconds < 90) return '1 min ago';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86_400)} d ago`;
}

export const STATUS_LABELS = {
  live: 'Live now',
  scheduled: 'Scheduled',
  sold_out: 'Sold out',
  ended: 'Ended',
};
