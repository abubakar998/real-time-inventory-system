const VARIANTS = {
  primary:
    'bg-emerald-500 text-emerald-950 hover:bg-emerald-400 focus-visible:outline-emerald-400 disabled:bg-emerald-500/40 disabled:text-emerald-950/60',
  secondary:
    'bg-zinc-800 text-zinc-100 ring-1 ring-inset ring-zinc-700 hover:bg-zinc-700 focus-visible:outline-zinc-400 disabled:opacity-50',
  ghost:
    'bg-transparent text-zinc-400 ring-1 ring-inset ring-zinc-800 hover:text-zinc-100 hover:bg-zinc-900 focus-visible:outline-zinc-500 disabled:opacity-50',
  danger:
    'bg-rose-500/90 text-white hover:bg-rose-500 focus-visible:outline-rose-400 disabled:opacity-50',
};

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-90"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4z"
      />
    </svg>
  );
}

/**
 * Every action button funnels through here so loading state is impossible to
 * forget: `loading` disables the button, swaps in a spinner, and exposes
 * aria-busy for screen readers.
 */
export function Button({
  children,
  variant = 'primary',
  loading = false,
  disabled = false,
  loadingLabel,
  className = '',
  ...props
}) {
  return (
    <button
      type="button"
      aria-busy={loading || undefined}
      disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold
        transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2
        disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
      {...props}
    >
      {loading && <Spinner />}
      <span>{loading && loadingLabel ? loadingLabel : children}</span>
    </button>
  );
}
