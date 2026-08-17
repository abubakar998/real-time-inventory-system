'use strict';

const http = require('node:http');
const config = require('./config/env');
const { sequelize } = require('./config/database');
const { createApp } = require('./app');
const realtime = require('./realtime');
const expiration = require('./services/expiration.service');

async function main() {
  try {
    await sequelize.authenticate();
    console.log('[db] connected');
  } catch (error) {
    console.error('[db] connection failed:', error.message);
    console.error('     Check DATABASE_URL in server/.env, then run `npm run db:migrate`.');
    process.exit(1);
  }

  // Fail fast with a useful message rather than 500ing on the first request.
  try {
    await sequelize.query('SELECT 1 FROM drops LIMIT 1');
  } catch {
    console.error('[db] the `drops` table is missing. Run `npm run db:migrate` first.');
    process.exit(1);
  }

  const app = createApp();
  const server = http.createServer(app);

  realtime.attach(server);

  // Reclaim anything that expired while we were down, re-arm live timers, then
  // start the periodic sweep.
  await expiration.rehydrate();
  expiration.start();

  server.listen(config.port, () => {
    console.log(`[http] listening on http://localhost:${config.port} (${config.env})`);
    console.log(`[http] allowed client origins: ${config.clientOrigins.join(', ')}`);
  });

  const shutdown = (signal) => {
    console.log(`\n[shutdown] ${signal} received, closing...`);
    expiration.stop();
    realtime.close();
    server.close(() => {
      sequelize.close().finally(() => process.exit(0));
    });
    // Don't hang forever on lingering keep-alive sockets.
    setTimeout(() => process.exit(1), 8000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('[fatal]', error);
  process.exit(1);
});
