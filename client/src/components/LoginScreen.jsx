import { useState } from 'react';
import toast from 'react-hot-toast';
import { Button } from './Button';
import { useAuth } from '../context/AuthContext';

const SUGGESTIONS = ['bakar', 'jordan', 'imran', 'sara', 'devon'];

/**
 * Passwordless sign-in: pick a name, get a user row. Enough to demo two
 * shoppers racing in two browser windows without building an auth system.
 */
export function LoginScreen() {
  const { signIn, signingIn } = useAuth();
  const [username, setUsername] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    const trimmed = username.trim();
    if (trimmed.length < 2) {
      toast.error('Pick a name with at least 2 characters.');
      return;
    }
    try {
      const user = await signIn(trimmed);
      toast.success(`Welcome, ${user.username}.`);
    } catch (error) {
      toast.error(error.message ?? 'Could not sign in.');
    }
  };

  return (
    <main className="grid min-h-full place-items-center px-4 py-16">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-50">Drop Room</h1>
        <p className="mt-1 text-sm text-zinc-400">
          Pick a shopper name to join the drop. Open a second browser window with a different name to
          watch stock sync live.
        </p>

        <form onSubmit={submit} className="mt-6 space-y-3">
          <label className="block">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
              Shopper name
            </span>
            <input
              autoFocus
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="e.g. bakar"
              maxLength={32}
              className="mt-1.5 w-full rounded-lg bg-zinc-900 px-3 py-2.5 text-sm text-zinc-100
                placeholder:text-zinc-600 ring-1 ring-inset ring-zinc-800
                focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </label>

          <Button type="submit" className="w-full" loading={signingIn} loadingLabel="Signing in…">
            Enter the drop
          </Button>
        </form>

        <div className="mt-5">
          <p className="text-xs text-zinc-600">Seeded shoppers</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {SUGGESTIONS.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => setUsername(name)}
                className="rounded-md bg-zinc-900 px-2.5 py-1 text-xs text-zinc-400 ring-1 ring-inset
                  ring-zinc-800 transition-colors hover:text-zinc-100 hover:ring-zinc-600"
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
