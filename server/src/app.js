'use strict';

const path = require('node:path');
const fs = require('node:fs');
const express = require('express');
const cors = require('cors');
const config = require('./config/env');
const { sequelize } = require('./config/database');
const { loadUser } = require('./middleware/auth');
const { notFoundHandler, errorHandler, asyncHandler } = require('./middleware/errorHandler');

const authRoutes = require('./routes/auth.routes');
const dropRoutes = require('./routes/drops.routes');
const reservationRoutes = require('./routes/reservations.routes');

function createApp() {
  const app = express();

  app.set('trust proxy', 1);
  app.use(cors({ origin: config.clientOrigins, credentials: true }));
  app.use(express.json({ limit: '100kb' }));
  app.use(loadUser);

  app.get(
    '/api/health',
    asyncHandler(async (_req, res) => {
      await sequelize.query('SELECT 1');
      res.json({ ok: true, uptimeSeconds: Math.round(process.uptime()) });
    })
  );

  app.use('/api/auth', authRoutes);
  app.use('/api/drops', dropRoutes);
  app.use('/api/reservations', reservationRoutes);

  // Single-origin deployment: if the client has been built, serve it from here
  // so the API and the SPA share a host (and therefore share the WebSocket).
  const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get(/^(?!\/api\/|\/socket\.io\/).*/, (_req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
    console.log('[http] serving client build from', clientDist);
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
