import { useEffect, useState } from 'react';
import { Toaster } from 'react-hot-toast';
import { useAuth } from './context/AuthContext';
import { useDrops } from './hooks/useDrops';
import { socket } from './lib/socket';
import { Header } from './components/Header';
import { LoginScreen } from './components/LoginScreen';
import { DropCard } from './components/DropCard';
import { CreateDropPanel } from './components/CreateDropPanel';
import { Button } from './components/Button';

function SkeletonCard() {
  return (
    <div className="h-72 animate-pulse rounded-xl bg-zinc-900 ring-1 ring-inset ring-zinc-800" />
  );
}

function Dashboard() {
  const { user } = useAuth();
  const { drops, loading, loadError, pending, connected, refresh, reserve, purchase, cancel, handleLocalExpiry } =
    useDrops(user);
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="min-h-full">
      <Header connected={connected} createOpen={createOpen} onToggleCreate={() => setCreateOpen((open) => !open)} />

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
        {createOpen && <CreateDropPanel onCreated={() => refresh({ silent: true })} onClose={() => setCreateOpen(false)} />}

        {loading && (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {[0, 1, 2].map((key) => (
              <SkeletonCard key={key} />
            ))}
          </div>
        )}

        {!loading && loadError && (
          <div className="rounded-xl bg-rose-500/5 p-6 text-center ring-1 ring-inset ring-rose-500/30">
            <p className="text-sm text-rose-200">
              Could not load drops: {loadError.message}
            </p>
            <Button variant="secondary" className="mt-3" onClick={() => refresh()}>
              Try again
            </Button>
          </div>
        )}

        {!loading && !loadError && drops.length === 0 && (
          <div className="rounded-xl bg-zinc-900 p-10 text-center ring-1 ring-inset ring-zinc-800">
            <p className="text-sm text-zinc-400">
              No drops yet. Run <code className="font-mono text-zinc-200">npm run db:seed</code> or create one
              with the “New drop” button.
            </p>
          </div>
        )}

        {!loading && drops.length > 0 && (
          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {drops.map((drop) => (
              <DropCard
                key={drop.id}
                drop={drop}
                currentUser={user}
                pending={pending[drop.id]}
                onReserve={reserve}
                onPurchase={purchase}
                onCancel={cancel}
                onExpire={handleLocalExpiry}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

export default function App() {
  const { user } = useAuth();

  // One socket for the tab's whole lifetime. Connecting here (rather than at
  // module scope) keeps StrictMode's double-mount from opening two sockets.
  useEffect(() => {
    socket.connect();
    return () => socket.disconnect();
  }, []);

  return (
    <>
      {user ? <Dashboard /> : <LoginScreen />}
      <Toaster
        position="bottom-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: '#18181b',
            color: '#fafafa',
            border: '1px solid #3f3f46',
            fontSize: '0.875rem',
          },
          success: { iconTheme: { primary: '#10b981', secondary: '#052e1b' } },
          error: { iconTheme: { primary: '#f43f5e', secondary: '#3f0d1a' } },
        }}
      />
    </>
  );
}
