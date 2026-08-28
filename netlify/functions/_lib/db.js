'use strict';

// Postgres access. Netlify's built-in DB (Neon extension) was discontinued for
// new databases, so the connection string is supplied explicitly via env var:
//   DATABASE_URL           (preferred)
//   NETLIFY_DATABASE_URL   (legacy / if a claimed Netlify DB still exists)
// Any Neon / standard Postgres pooled connection string works.
const { getDatabase } = require('@netlify/database');

function connectionString() {
  return (
    process.env.DATABASE_URL ||
    process.env.NETLIFY_DATABASE_URL ||
    process.env.NEON_DATABASE_URL ||
    null
  );
}

let _db = null;
function db() {
  if (_db) return _db;
  const cs = connectionString();
  if (!cs) {
    throw new Error(
      'No database connection string. Set DATABASE_URL (a Neon/Postgres pooled URL) in the site env.'
    );
  }
  _db = getDatabase({ connectionString: cs });
  return _db;
}

// Tagged-template query fn: sql`SELECT ... WHERE id = ${id}` -> Promise<row[]>.
const sql = (...args) => db().sql(...args);
sql.values = (rows) => db().sql.values(rows);
sql.identifier = (v) => db().sql.identifier(v);
sql.unsafe = (q, p) => db().sql.unsafe(q, p);

module.exports = { sql, db };
