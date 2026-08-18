import { io } from 'socket.io-client';

// Trailing slash stripped for the same reason as in api.js.
// undefined => same origin.
const BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/+$/, '') || undefined;

/**
 * One shared connection per tab. Created eagerly but connected by <App/>, so
 * React StrictMode's double-mount cannot open two sockets.
 */
export const socket = io(BASE_URL, {
  autoConnect: false,
  transports: ['websocket', 'polling'],
  reconnectionDelay: 500,
  reconnectionDelayMax: 4000,
});

/** Move this socket into (or out of) the signed-in user's private room. */
export function identify(userId) {
  socket.auth = { userId: userId ?? null };
  if (socket.connected) socket.emit('identify', userId ?? null);
}
