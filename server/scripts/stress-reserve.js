'use strict';

/**
 * Oversell proof.
 *
 * Creates a drop with N units, then fires C reserve requests at it from C
 * distinct users in the same tick. Exactly N must succeed and C - N must be
 * rejected with OUT_OF_STOCK — never N + 1.
 *
 *   npm run stress                        # 1 unit,  100 racers
 *   npm run stress -- --stock 5 --clients 250
 *
 * Requires the API to be running (npm run dev:server).
 */

const { QueryTypes } = require('sequelize');
const { sequelize } = require('../src/config/database');
const config = require('../src/config/env');

const API = process.env.API_URL || `http://localhost:${config.port}`;

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = Number.parseInt(process.argv[index + 1], 10);
  return Number.isFinite(value) ? value : fallback;
}

const STOCK = arg('stock', 1);
const CLIENTS = arg('clients', 100);

async function api(path, { method = 'GET', body, userId } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(userId ? { 'x-user-id': String(userId) } : {}),
      ...(config.adminToken ? { 'x-admin-token': config.adminToken } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const payload = await response.json().catch(() => ({}));
  return { status: response.status, payload };
}

async function main() {
  console.log(`\n=== Oversell stress test ===`);
  console.log(`API      : ${API}`);
  console.log(`Stock    : ${STOCK}`);
  console.log(`Racers   : ${CLIENTS}\n`);

  const health = await api('/api/health').catch(() => null);
  if (!health || health.status !== 200) {
    console.error(`Cannot reach the API at ${API}. Start it with \`npm run dev:server\`.`);
    process.exit(1);
  }

  // 1. A dedicated drop, so the run is repeatable and isolated.
  const dropRes = await api('/api/drops', {
    method: 'POST',
    body: {
      name: `Stress Test Drop ${new Date().toISOString()}`,
      description: `${STOCK} unit(s), ${CLIENTS} simultaneous racers.`,
      priceCents: 19_900,
      totalStock: STOCK,
      reservationWindowSeconds: 300,
    },
  });

  if (dropRes.status !== 201) {
    console.error('Could not create the test drop:', dropRes.payload);
    process.exit(1);
  }
  const dropId = dropRes.payload.drop.id;
  console.log(`Created drop #${dropId}`);

  // 2. Distinct users up front, so login latency is not part of the race.
  const users = await Promise.all(
    Array.from({ length: CLIENTS }, (_, i) =>
      api('/api/auth/login', { method: 'POST', body: { username: `racer-${i}` } }).then(
        (r) => r.payload.user
      )
    )
  );
  console.log(`Signed in ${users.length} racers`);

  // 3. Release every request in the same tick.
  console.log('Firing...\n');
  const startedAt = Date.now();
  const results = await Promise.all(
    users.map((user) =>
      api(`/api/drops/${dropId}/reserve`, { method: 'POST', userId: user.id }).catch((error) => ({
        status: 0,
        payload: { error: { code: 'NETWORK', message: error.message } },
      }))
    )
  );
  const elapsedMs = Date.now() - startedAt;

  // 4. Tally.
  const tally = new Map();
  let succeeded = 0;
  for (const { status, payload } of results) {
    if (status === 201) {
      succeeded += 1;
      continue;
    }
    const code = payload?.error?.code || `HTTP_${status}`;
    tally.set(code, (tally.get(code) || 0) + 1);
  }

  // 5. Ground truth from the database, not from the API responses.
  const [row] = await sequelize.query(
    /* sql */ `
      SELECT d.total_stock                                    AS "totalStock",
             d.reserved_count                                 AS "reservedCount",
             d.sold_count                                     AS "soldCount",
             (d.total_stock - d.reserved_count - d.sold_count) AS available,
             (SELECT count(*)::int FROM reservations r
               WHERE r.drop_id = d.id AND r.status = 'active') AS "activeReservations"
      FROM drops d WHERE d.id = $1
    `,
    { bind: [dropId], type: QueryTypes.SELECT }
  );

  console.log('--- Responses ------------------------------------');
  console.log(`  201 reserved            : ${succeeded}`);
  for (const [code, count] of [...tally].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${code.padEnd(24)}: ${count}`);
  }
  console.log(`  wall clock              : ${elapsedMs}ms\n`);

  console.log('--- Database -------------------------------------');
  console.log(`  total_stock             : ${row.totalStock}`);
  console.log(`  reserved_count          : ${row.reservedCount}`);
  console.log(`  sold_count              : ${row.soldCount}`);
  console.log(`  available               : ${row.available}`);
  console.log(`  active reservation rows : ${row.activeReservations}\n`);

  const expected = Math.min(STOCK, CLIENTS);
  const checks = [
    ['successful reservations == stock', succeeded === expected],
    ['reserved_count == stock', row.reservedCount === expected],
    ['reservation rows == stock', row.activeReservations === expected],
    ['available never negative', row.available >= 0],
  ];

  let passed = true;
  console.log('--- Assertions -----------------------------------');
  for (const [label, ok] of checks) {
    console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}`);
    if (!ok) passed = false;
  }
  console.log(`\n${passed ? 'NO OVERSELL — all assertions passed.' : 'OVERSOLD — assertions failed.'}\n`);

  await sequelize.close();
  process.exit(passed ? 0 : 1);
}

main().catch(async (error) => {
  console.error('[stress] failed:', error);
  await sequelize.close().catch(() => {});
  process.exit(1);
});
