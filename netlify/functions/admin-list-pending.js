'use strict';

const { sql } = require('./_lib/db');
const { requireUser } = require('./_lib/auth');
const { ok, methodNotAllowed, serverError } = require('./_lib/http');

// GET /api/admin-list-pending — admin only. Returns pending + all users.
exports.handler = async (event, context) => {
  if (event.httpMethod !== 'GET') return methodNotAllowed();

  const gate = await requireUser(event, context, { requireAdmin: true });
  if (gate.response) return gate.response;

  try {
    const pending = await sql`
      SELECT id, email, created_at FROM users
      WHERE approved = FALSE ORDER BY created_at ASC`;
    const all = await sql`
      SELECT u.id, u.email, u.approved, u.is_admin, u.created_at,
             (u.telegram_chat_id IS NOT NULL)     AS telegram_linked,
             (u.onesignal_player_id IS NOT NULL)  AS onesignal_linked,
             (SELECT count(*)::int FROM alerts a WHERE a.user_id = u.id) AS alert_count
      FROM users u ORDER BY u.created_at DESC`;
    return ok({ pending, users: all });
  } catch (err) {
    console.error('[admin-list-pending]', err);
    return serverError();
  }
};
