'use strict';

const { sql } = require('./_lib/db');
const { requireUser } = require('./_lib/auth');
const {
  ok, badRequest, notFound, methodNotAllowed, serverError, parseBody,
} = require('./_lib/http');
const { updateIdentityMetadata } = require('./_lib/identity');

// POST /api/admin-approve-user  { user_id, approve: true|false, make_admin?: bool }
exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed();

  const gate = await requireUser(event, context, { requireAdmin: true });
  if (gate.response) return gate.response;

  const body = parseBody(event);
  if (body === null) return badRequest('Invalid JSON');
  const userId = body.user_id;
  if (!userId) return badRequest('user_id is required');
  const approve = body.approve !== false; // default true
  const makeAdmin = body.make_admin === true;

  try {
    const target = await sql`SELECT * FROM users WHERE id = ${userId}`;
    if (target.length === 0) return notFound('User not found');

    const rows = makeAdmin
      ? await sql`
          UPDATE users SET approved = ${approve}, is_admin = TRUE
          WHERE id = ${userId} RETURNING id, email, approved, is_admin`
      : await sql`
          UPDATE users SET approved = ${approve}
          WHERE id = ${userId} RETURNING id, email, approved, is_admin`;

    const idResult = await updateIdentityMetadata(context, userId, {
      approved: rows[0].approved,
      is_admin: rows[0].is_admin,
    });

    return ok({ user: rows[0], identity_sync: idResult });
  } catch (err) {
    console.error('[admin-approve-user]', err);
    return serverError();
  }
};
