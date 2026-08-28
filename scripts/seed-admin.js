'use strict';

/**
 * Promote a user to approved admin directly in the DB.
 *   DATABASE_URL="postgres://..." node scripts/seed-admin.js you@example.com
 * (or run via `netlify dev:exec` so the site env is injected)
 *
 * The user must have signed in through the app at least once so their row
 * exists. Also set app_metadata { approved:true, is_admin:true } for that user
 * in the Netlify Identity dashboard so the flags ride on the JWT.
 */

const { sql } = require('../netlify/functions/_lib/db');

const email = (process.argv[2] || '').toLowerCase();
if (!email) {
  console.error('Usage: DATABASE_URL=... node scripts/seed-admin.js <email>');
  process.exit(1);
}

(async () => {
  const rows = await sql`
    UPDATE users SET approved = TRUE, is_admin = TRUE
    WHERE email = ${email}
    RETURNING id, email, approved, is_admin`;
  if (rows.length === 0) {
    console.error(`No user with email ${email}. Have them sign in to the app once, then re-run.`);
    process.exit(1);
  }
  console.log('Admin seeded:', rows[0]);
})();
