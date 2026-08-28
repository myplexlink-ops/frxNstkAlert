'use strict';

const { sql } = require('./_lib/db');
const { requireUser } = require('./_lib/auth');
const {
  ok, badRequest, notFound, methodNotAllowed, serverError, parseBody,
} = require('./_lib/http');

// DELETE /api/delete-alert  body: { id }  (or ?id= query param)
exports.handler = async (event, context) => {
  if (event.httpMethod !== 'DELETE' && event.httpMethod !== 'POST') return methodNotAllowed();

  const gate = await requireUser(event, context);
  if (gate.response) return gate.response;

  const body = parseBody(event) || {};
  const id = body.id || (event.queryStringParameters && event.queryStringParameters.id);
  if (!id) return badRequest('id is required');

  try {
    const rows = await sql`
      DELETE FROM alerts WHERE id = ${id} AND user_id = ${gate.user.id} RETURNING id`;
    if (rows.length === 0) return notFound('Alert not found');
    return ok({ deleted: rows[0].id });
  } catch (err) {
    console.error('[delete-alert]', err);
    return serverError();
  }
};
