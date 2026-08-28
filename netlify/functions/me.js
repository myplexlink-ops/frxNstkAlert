'use strict';

const { sql } = require('./_lib/db');
const { identityUser, syncUser } = require('./_lib/auth');
const { ok, unauthorized, methodNotAllowed, serverError } = require('./_lib/http');

// GET /api/me — bootstrap the frontend: who am I, am I approved/admin,
// notification-channel link status. Does NOT require approval.
exports.handler = async (event, context) => {
  if (event.httpMethod !== 'GET') return methodNotAllowed();

  const idUser = identityUser(context);
  if (!idUser) return unauthorized();

  try {
    const user = await syncUser(idUser);

    let pendingCount = null;
    if (user.is_admin) {
      const rows = await sql`SELECT count(*)::int AS n FROM users WHERE approved = FALSE`;
      pendingCount = rows[0].n;
    }

    return ok({
      id: user.id,
      email: user.email,
      approved: user.approved,
      is_admin: user.is_admin,
      telegram_linked: !!user.telegram_chat_id,
      telegram_link_code: user.telegram_link_code || null,
      onesignal_linked: !!user.onesignal_player_id,
      pending_count: pendingCount,
    });
  } catch (err) {
    console.error('[me]', err);
    return serverError();
  }
};
