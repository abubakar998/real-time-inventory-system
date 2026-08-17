'use strict';

/**
 * Applies server/sql/schema.sql.
 *
 * Uses the raw pg client rather than Sequelize because the schema file is a
 * multi-statement script, and deliberately never calls sequelize.sync() — the
 * SQL file is the single source of truth for the database shape.
 *
 *   node scripts/migrate.js          apply schema (idempotent)
 *   node scripts/migrate.js --drop   DESTRUCTIVE: drop everything, then apply
 */

const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');
const config = require('../src/config/env');

const sqlDir = path.join(__dirname, '..', 'sql');

async function main() {
  const shouldDrop = process.argv.includes('--drop');

  const client = new Client({
    connectionString: config.databaseUrl,
    ssl: config.useSsl ? { rejectUnauthorized: false } : undefined,
  });

  await client.connect();

  try {
    if (shouldDrop) {
      console.log('[migrate] --drop given: removing existing tables');
      await client.query(fs.readFileSync(path.join(sqlDir, 'drop-all.sql'), 'utf8'));
    }

    await client.query(fs.readFileSync(path.join(sqlDir, 'schema.sql'), 'utf8'));

    const { rows } = await client.query(`
      SELECT table_name AS name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);

    console.log('[migrate] schema applied. Tables:', rows.map((r) => r.name).join(', '));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('[migrate] failed:', error.message);
  process.exit(1);
});
