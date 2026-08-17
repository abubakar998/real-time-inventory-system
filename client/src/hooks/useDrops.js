import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { api, ApiError } from '../lib/api';
import { socket } from '../lib/socket';

/**
 * Owns the dashboard's live state.
 *
 * Two sources feed it:
 *   - REST, for the initial load and for the caller's own reservation;
 *   - WebSocket `drop:updated`, for every change any user causes anywhere.
 *
 * Broadcast payloads are intentionally user-agnostic, so merging keeps the
 * locally-known `myReservation` and takes everything else from the server.
 * That means a remote user's reserve/purchase can never wipe your own hold out
 * of the UI.
 */

/** Human copy for the server's machine-readable error codes. */
const ERROR_COPY = {
  OUT_OF_STOCK: 'Sold out — someone claimed the last one first.',
  ALREADY_RESERVED: 'You already have a live hold on this drop.',
  RESERVATION_EXPIRED: 'Your hold expired. The item went back on sale.',
  ALREADY_PURCHASED: 'You have already bought this one.',
  DROP_NOT_STARTED: 'This drop has not started yet.',
  DROP_ENDED: 'This drop has ended.',
  NOT_YOUR_RESERVATION: 'That reservation belongs to someone else.',
  UNAUTHENTICATED: 'Sign in first.',
  NETWORK_ERROR: 'Cannot reach the server. Is the API running?',
};

function reportError(error) {
  const code = error instanceof ApiError ? error.code : 'UNKNOWN';
  toast.error(ERROR_COPY[code] ?? error.message ?? 'Something went wrong.', {
    id: `err-${code}`,
  });
}

export function useDrops(user) {
  const [drops, setDrops] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [pending, setPending] = useState({}); // dropId -> 'reserve' | 'purchase' | 'cancel'
  const [connected, setConnected] = useState(socket.connected);

  const userId = user?.id ?? null;
  // Read inside socket handlers without making them re-subscribe on every tick.
  const dropsRef = useRef(drops);
  dropsRef.current = drops;

  const setPendingFor = useCallback((dropId, action) => {
    setPending((prev) => {
      if (!action) {
        const { [dropId]: _removed, ...rest } = prev;
        return rest;
      }
      return { ...prev, [dropId]: action };
    });
  }, []);

  /** Replace a drop, keeping whatever we know about *our* hold on it. */
  const mergeDrop = useCallback((incoming) => {
    if (!incoming?.id) return;
    setDrops((prev) => {
      const index = prev.findIndex((drop) => drop.id === incoming.id);
      if (index === -1) return [incoming, ...prev];
      const next = [...prev];
      next[index] = { ...incoming, myReservation: prev[index].myReservation ?? null };
      return next;
    });
  }, []);

  const clearMyReservation = useCallback((dropId) => {
    setDrops((prev) =>
      prev.map((drop) => (drop.id === dropId ? { ...drop, myReservation: null } : drop))
    );
  }, []);

  const refresh = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setLoading(true);
    try {
      const { drops: fresh } = await api.listDrops();
      setDrops(fresh);
      setLoadError(null);
    } catch (error) {
      setLoadError(error);
      if (!silent) reportError(error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Reload whenever the signed-in user changes — `myReservation` is per user.
  useEffect(() => {
    refresh();
  }, [refresh, userId]);

  // ---- realtime ------------------------------------------------------------
  useEffect(() => {
    const onConnect = () => {
      setConnected(true);
      // Re-fetch through REST as well: the snapshot is user-agnostic, and we
      // may have missed our own reservation's state while offline.
      refresh({ silent: true });
    };
    const onDisconnect = () => setConnected(false);

    const onSnapshot = (snapshot) => {
      if (!Array.isArray(snapshot)) return;
      for (const drop of snapshot) mergeDrop(drop);
    };

    const onDropUpdated = (drop) => mergeDrop(drop);

    const onDropCreated = (drop) => {
      mergeDrop(drop);
      toast(`New drop: ${drop.name}`, { icon: '🔥' });
    };

    const onReservationExpired = ({ dropId }) => {
      const drop = dropsRef.current.find((candidate) => candidate.id === dropId);
      clearMyReservation(dropId);
      toast.error(`Your hold on ${drop?.name ?? 'that drop'} expired.`, {
        id: `expired-${dropId}`,
      });
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('drops:snapshot', onSnapshot);
    socket.on('drop:updated', onDropUpdated);
    socket.on('drop:created', onDropCreated);
    socket.on('reservation:expired', onReservationExpired);

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('drops:snapshot', onSnapshot);
      socket.off('drop:updated', onDropUpdated);
      socket.off('drop:created', onDropCreated);
      socket.off('reservation:expired', onReservationExpired);
    };
  }, [mergeDrop, clearMyReservation, refresh]);

  // ---- actions -------------------------------------------------------------
  const reserve = useCallback(
    async (dropId) => {
      setPendingFor(dropId, 'reserve');
      try {
        const { reservation, drop } = await api.reserve(dropId);
        setDrops((prev) =>
          prev.map((candidate) =>
            candidate.id === drop.id ? { ...drop, myReservation: reservation } : candidate
          )
        );
        toast.success('Reserved. Complete your purchase before the timer runs out.');
      } catch (error) {
        reportError(error);
        // A losing racer's view of the stock is stale by definition — resync.
        refresh({ silent: true });
      } finally {
        setPendingFor(dropId, null);
      }
    },
    [refresh, setPendingFor]
  );

  const purchase = useCallback(
    async (dropId, reservationId) => {
      setPendingFor(dropId, 'purchase');
      try {
        const { drop } = await api.purchase(reservationId);
        setDrops((prev) =>
          prev.map((candidate) =>
            candidate.id === drop.id ? { ...drop, myReservation: null } : candidate
          )
        );
        toast.success('Purchased. You are on the activity feed.');
      } catch (error) {
        reportError(error);
        clearMyReservation(dropId);
        refresh({ silent: true });
      } finally {
        setPendingFor(dropId, null);
      }
    },
    [refresh, clearMyReservation, setPendingFor]
  );

  const cancel = useCallback(
    async (dropId, reservationId) => {
      setPendingFor(dropId, 'cancel');
      try {
        const { drop } = await api.cancel(reservationId);
        setDrops((prev) =>
          prev.map((candidate) =>
            candidate.id === drop.id ? { ...drop, myReservation: null } : candidate
          )
        );
        toast('Hold released.', { icon: '↩️' });
      } catch (error) {
        reportError(error);
        clearMyReservation(dropId);
        refresh({ silent: true });
      } finally {
        setPendingFor(dropId, null);
      }
    },
    [refresh, clearMyReservation, setPendingFor]
  );

  /**
   * The countdown hit zero locally. Grey the card's buttons out immediately and
   * ask the server for the truth — the authoritative `reservation:expired`
   * event usually lands within a few hundred ms anyway.
   */
  const handleLocalExpiry = useCallback(
    (dropId) => {
      clearMyReservation(dropId);
      refresh({ silent: true });
    },
    [clearMyReservation, refresh]
  );

  return {
    drops,
    loading,
    loadError,
    pending,
    connected,
    refresh,
    reserve,
    purchase,
    cancel,
    handleLocalExpiry,
  };
}
