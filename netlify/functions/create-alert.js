'use strict';

const { sql } = require('./_lib/db');
const { requireUser } = require('./_lib/auth');
const { ok, badRequest, methodNotAllowed, serverError, parseBody } = require('./_lib/http');
const { validateAlert } = require('./_lib/validate');

// POST /api/create-alert — auth + approval required.
exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed();

  const gate = await requireUser(event, context);
  if (gate.response) return gate.response;

  const body = parseBody(event);
  if (body === null) return badRequest('Invalid JSON');

  const { value, error } = validateAlert(body);
  if (error) return badRequest(error);

  try {
    const rows = await sql`
      INSERT INTO alerts (
        user_id, symbol, asset_type, condition_type, target_value,
        reference_price, poll_interval_seconds, recurring, active, armed, next_check_due
      ) VALUES (
        ${gate.user.id}, ${value.symbol}, ${value.asset_type}, ${value.condition_type},
        ${value.target_value}, ${value.reference_price ?? null},
        ${value.poll_interval_seconds}, ${value.recurring ?? false},
        TRUE, TRUE, now()
      )
      RETURNING *`;

    // Make sure the symbol is in the user's watchlist too (best effort).
    await sql`
      INSERT INTO watchlist (user_id, symbol, asset_type)
      VALUES (${gate.user.id}, ${value.symbol}, ${value.asset_type})
      ON CONFLICT (user_id, symbol) DO NOTHING`;

    return ok({ alert: rows[0] });
  } catch (err) {
    console.error('[create-alert]', err);
    return serverError();
  }
};
