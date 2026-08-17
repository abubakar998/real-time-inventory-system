'use strict';

const { Server } = require('socket.io');
const config = require('../config/env');
const dropsQuery = require('../services/drops.query');

/**
 * Socket.io wiring.
 *
 * Two channels:
 *   - a global broadcast for stock/feed changes, which every tab must see;
 *   - a per-user room (`user:<id>`) for events that only concern one shopper,
 *     such as their own reservation expiring.
 */

let io = null;

const userRoom = (userId) => `user:${userId}`;

function attach(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: config.clientOrigins, credentials: true },
    // Long-polling fallback stays enabled so the demo still works behind
    // proxies that mangle WebSocket upgrades.
    transports: ['websocket', 'polling'],
  });

  io.on('connection', async (socket) => {
    const initialUserId = Number.parseInt(socket.handshake.auth?.userId, 10);
    if (Number.isFinite(initialUserId)) {
      socket.data.userId = initialUserId;
      socket.join(userRoom(initialUserId));
    }

    // Lets a tab move rooms after sign-in / sign-out without reconnecting.
    socket.on('identify', (userId) => {
      const next = Number.parseInt(userId, 10);
      if (socket.data.userId) socket.leave(userRoom(socket.data.userId));
      if (Number.isFinite(next)) {
        socket.data.userId = next;
        socket.join(userRoom(next));
      } else {
        socket.data.userId = null;
      }
    });

    // Push a full snapshot on connect (and on every reconnect), so a tab that
    // slept through a network blip re-syncs without polling.
    try {
      socket.emit('drops:snapshot', await dropsQuery.listDrops({ userId: null }));
    } catch (error) {
      console.error('[realtime] failed to send snapshot:', error.message);
    }
  });

  console.log('[realtime] socket.io attached');
  return io;
}

/** Fan a drop's new public state out to every connected tab. */
function broadcastDrop(drop) {
  if (io && drop) io.emit('drop:updated', drop);
}

/** Announce a brand-new drop so open dashboards pick it up without a refresh. */
function broadcastDropCreated(drop) {
  if (io && drop) io.emit('drop:created', drop);
}

/** Send to one shopper's tabs only. */
function toUser(userId, event, payload) {
  if (io) io.to(userRoom(userId)).emit(event, payload);
}

function close() {
  if (io) io.close();
  io = null;
}

module.exports = { attach, broadcastDrop, broadcastDropCreated, toUser, close };
