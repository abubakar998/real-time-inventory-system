'use strict';

const path = require('node:path');
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

function bool(value, fallback = false) {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error(
    '\n[config] DATABASE_URL is not set.\n' +
      '         Copy server/.env.example to server/.env and point it at a Postgres instance.\n'
  );
  process.exit(1);
}

// Managed Postgres providers require TLS; a local instance usually rejects it.
const MANAGED_HOSTS = ['neon.tech', 'supabase.co', 'render.com', 'rds.amazonaws.com', 'railway.app'];
const useSsl =
  bool(process.env.PGSSL) ||
  databaseUrl.includes('sslmode=require') ||
  MANAGED_HOSTS.some((host) => databaseUrl.includes(host));

module.exports = {
  env: process.env.NODE_ENV || 'development',
  isProduction: process.env.NODE_ENV === 'production',
  port: int(process.env.PORT, 4000),

  databaseUrl,
  useSsl,
  sqlLog: bool(process.env.SQL_LOG),

  // Trailing slashes are stripped because a browser's `Origin` header never has
  // one ("https://app.vercel.app", never "https://app.vercel.app/"), while the
  // CORS check is an exact string match. Pasting the URL straight from the
  // address bar — which does include the slash — would otherwise silently
  // reject every request, and the browser reports it as a missing
  // Access-Control-Allow-Origin rather than as a config typo.
  clientOrigins: (process.env.CLIENT_ORIGIN || 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean),

  reservationTtlSeconds: int(process.env.RESERVATION_TTL_SECONDS, 60),
  sweepIntervalMs: int(process.env.SWEEP_INTERVAL_MS, 2000),

  adminToken: process.env.ADMIN_TOKEN || null,
};
