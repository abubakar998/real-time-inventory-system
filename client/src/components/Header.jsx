import { useAuth } from '../context/AuthContext';

/** Connection state is surfaced permanently — a dead socket means stale stock. */
function ConnectionBadge({ connected }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${
        connected
          ? 'bg-emerald-500/10 text-emerald-300 ring-emerald-500/30'
          : 'bg-amber-500/10 text-amber-300 ring-amber-500/30'
      }`}
      title={connected ? 'Receiving live updates' : 'Reconnecting to the live feed…'}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'bg-emerald-400' : 'bg-amber-400 animate-pulse'}`} />
      {connected ? 'Live' : 'Reconnecting…'}
    </span>
  );
}

export function Header({ connected, onToggleCreate, createOpen }) {
  const { user, signOut } = useAuth();

  return (
    <header className="sticky top-0 z-10 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-bold tracking-tight text-zinc-50">Drop Room</h1>
          <ConnectionBadge connected={connected} />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={onToggleCreate}
            className="rounded-lg px-3 py-2 text-sm font-medium text-zinc-400 ring-1 ring-inset
              ring-zinc-800 transition-colors hover:bg-zinc-900 hover:text-zinc-100"
            aria-expanded={createOpen}
          >
            {createOpen ? 'Close' : 'New drop'}
          </button>

          {user && (
            <div className="flex items-center gap-2 rounded-lg bg-zinc-900 py-1.5 pl-2.5 pr-1.5 ring-1 ring-inset ring-zinc-800">
              <span className="text-sm text-zinc-300">
                <span className="text-zinc-500">as </span>
                <span className="font-semibold text-zinc-100">{user.username}</span>
              </span>
              <button
                type="button"
                onClick={signOut}
                className="rounded-md px-2 py-1 text-xs text-zinc-500 transition-colors hover:bg-zinc-800 hover:text-zinc-200"
              >
                Switch
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
