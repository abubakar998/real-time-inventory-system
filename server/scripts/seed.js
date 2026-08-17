'use strict';

/**
 * Seeds demo shoppers and three merch drops in different states:
 * one live now, one small "last pair" drop for racing, one scheduled.
 *
 *   node scripts/seed.js          add seed rows if the drops are missing
 *   node scripts/seed.js --fresh  wipe reservations/purchases/drops first
 */

const { QueryTypes, fn } = require('sequelize');
const { sequelize } = require('../src/config/database');
const { Drop } = require('../src/models');

const USERS = ['bakar', 'jordan', 'imran', 'sara', 'devon'];

// "Live now" is resolved by the database, not this machine — see the note in
// routes/drops.routes.js about clock skew between app servers and Postgres.
const NOW = fn('NOW');
const minutesFromNow = (m) => new Date(Date.now() + m * 60_000);

const DROPS = [
  {
    name: 'Air Jordan 1 Retro High "Chicago"',
    description: 'The original colourway. Full-grain leather, 1985 cut, numbered pair card.',
    imageUrl: null,
    priceCents: 22_000, // $220.00
    totalStock: 100,
    reservationWindowSeconds: 60,
    startsAt: NOW,
    endsAt: null,
  },
  {
    name: 'Yeezy Boost 350 V2 "Zebra" — Final Pairs',
    description: 'Three pairs left in the warehouse. Reserve fast; the hold is 60 seconds.',
    imageUrl: null,
    priceCents: 30_000, // $300.00
    totalStock: 3,
    reservationWindowSeconds: 60,
    startsAt: NOW,
    endsAt: null,
  },
  {
    name: 'New Balance 990v6 "Workwear" — Scheduled',
    description: 'Goes live in 10 minutes. Reserve attempts before then are rejected.',
    imageUrl: null,
    priceCents: 21_000, // $210.00
    totalStock: 40,
    reservationWindowSeconds: 60,
    startsAt: minutesFromNow(10),
    endsAt: minutesFromNow(60 * 24),
  },
];

async function main() {
  const fresh = process.argv.includes('--fresh');

  await sequelize.authenticate();

  if (fresh) {
    console.log('[seed] --fresh: truncating drops, reservations and purchases');
    await sequelize.query('TRUNCATE purchases, reservations, drops RESTART IDENTITY CASCADE');
  }

  for (const username of USERS) {
    await sequelize.query(
      `INSERT INTO users (username, created_at, updated_at)
       VALUES ($1, now(), now())
       ON CONFLICT (lower(username)) DO NOTHING`,
      { bind: [username] }
    );
  }
  console.log(`[seed] users ready: ${USERS.join(', ')}`);

  for (const drop of DROPS) {
    const [existing] = await sequelize.query('SELECT id FROM drops WHERE name = $1', {
      bind: [drop.name],
      type: QueryTypes.SELECT,
    });

    if (existing) {
      console.log(`[seed] skip (exists): ${drop.name}`);
      continue;
    }

    const created = await Drop.create(drop);
    console.log(`[seed] created drop #${created.id}: ${drop.name} (${drop.totalStock} units)`);
  }

  await sequelize.close();
  console.log('[seed] done');
}

main().catch(async (error) => {
  console.error('[seed] failed:', error.message);
  await sequelize.close().catch(() => {});
  process.exit(1);
});
