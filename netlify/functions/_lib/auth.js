'use strict';

const { sql } = require('./db');
const { unauthorized, forbidden } = require('./http');

/**
 * Extract the verified Netlify Identity user from the function context.
 * Netlify verifies the JWT signature before invoking the function and puts the
 * decoded token on context.clientContext.user. If it's absent, the request is
 * unauthenticated (or the Bearer token was invalid/expired).
 */
function identityUser(context) {
  const user = context && context.clientContext && context.clientContext.user;
  if (!user || !user.sub || !user.email) return null;
  return {
    id: user.sub,
    email: String(user.email).toLowerCase(),
    appMetadata: user.app_metadata || {},
  };
}

/**
 * Ensure a users row exists for this Identity user and keep approved/is_admin
 * in sync with Identity app_metadata (which only an admin can edit).
 * Returns the DB row — the server-side source of truth for authorization.
 */
async function syncUser(idUser) {
  const approvedClaim = idUser.appMetadata.approved === true;
  const adminClaim = idUser.appMetadata.is_admin === true || idUser.appMetadata.roles?.includes?.('admin') === true;

  const rows = await sql`
    INSERT INTO users (id, email, approved, is_admin)
    VALUES (${idUser.id}, ${idUser.email}, ${approvedClaim}, ${adminClaim})
    ON CONFLICT (id) DO UPDATE SET
      email = EXCLUDED.email,
      -- Identity app_metadata wins when it grants a flag; never downgrade a
      -- flag that was set directly in the DB.
      approved = users.approved OR EXCLUDED.approved,
      is_admin = users.is_admin OR EXCLUDED.is_admin
    RETURNING *`;
  return rows[0];
}

/**
 * Guard for standard endpoints. Options:
 *   requireApproved (default true), requireAdmin (default false)
 * On success returns { user } (DB row). On failure returns { response } to return directly.
 */
async function requireUser(event, context, opts = {}) {
  const { requireApproved = true, requireAdmin = false } = opts;

  const idUser = identityUser(context);
  if (!idUser) return { response: unauthorized() };

  const user = await syncUser(idUser);

  if (requireAdmin && !user.is_admin) {
    return { response: forbidden('Admin only') };
  }
  if (requireApproved && !user.approved && !user.is_admin) {
    return { response: forbidden('Your account is pending admin approval') };
  }
  return { user };
}

module.exports = { identityUser, syncUser, requireUser };
