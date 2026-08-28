'use strict';

const { sql } = require('./_lib/db');
const { requireUser } = require('./_lib/auth');
const {
  ok, badRequest, methodNotAllowed, serverError, parseBody,
} = require('./_lib/http');

// POST /api/link-onesignal  { player_id }   (empty/null player_id unlinks)
exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed();

  const gate = await requireUser(event, context, { requireApproved: false });
  if (gate.response) return gate.response;

  const body = parseBody(event);
  if (body === null) return badRequest('Invalid JSON');

  const playerId =
    body.player_id && typeof body.player_id === 'string' ? body.player_id.trim() : null;

  if (playerId && !/^[0-9a-fA-F-]{10,64}$/.test(playerId)) {
    return badRequest('player_id looks invalid');
  }

  try {
    await sql`
      UPDATE users SET onesignal_player_id = ${playerId} WHERE id = ${gate.user.id}`;
    return ok({ onesignal_linked: !!playerId });
  } catch (err) {
    console.error('[link-onesignal]', err);
    return serverError();
  }
};
