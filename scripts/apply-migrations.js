'use strict';

// Apply SQL migrations to the Neon/Postgres database.
//
//   DATABASE_URL="postgres://..." node scripts/apply-migrations.js
//       -> applies every netlify/database/migrations/*/migration.sql in name order
//   DATABASE_URL="postgres://..." node scripts/apply-migrations.js 002_symbol_metadata
//       -> applies just that one (accepts a dir name or a full path)
//
// Every migration.sql is written to be idempotent (IF NOT EXISTS), so re-running
// the whole set is safe.

const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const url =
  process.env.DATABASE_URL ||
  process.env.NETLIFY_DATABASE_URL ||
  process.env.NEON_DATABASE_URL;

if (!url) {
  console.error('Set DATABASE_URL (a Neon/Postgres connection string) in the environment.');
  process.exit(1);
}

const MIG_DIR = path.join(process.cwd(), 'netlify', 'database', 'migrations');

function resolveTargets(arg) {
  if (!arg) {
    return fs
      .readdirSync(MIG_DIR)
      .filter((d) => fs.statSync(path.join(MIG_DIR, d)).isDirectory())
      .sort()
      .map((d) => path.join(MIG_DIR, d, 'migration.sql'));
  }
  if (arg.endsWith('.sql')) return [path.resolve(arg)];
  return [path.join(MIG_DIR, arg, 'migration.sql')];
}

(async () => {
  const targets = resolveTargets(process.argv[2]);
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    for (const file of targets) {
      const sql = fs.readFileSync(file, 'utf8');
      const rel = path.relative(process.cwd(), file);
      process.stdout.write(`applying ${rel} ... `);
      await client.query(sql);
      console.log('ok');
    }
  } finally {
    await client.end();
  }
  console.log('done.');
})().catch((err) => {
  console.error('\nFAILED:', err.message);
  process.exit(1);
});
