'use strict';

const { sql } = require('./_lib/db');
const { requireUser } = require('./_lib/auth');
const {
  ok, badRequest, notFound, methodNotAllowed, serverError, parseBody,
} = require('./_lib/http');
const { validateAlert } = require('./_lib/validate');

// PUT /api/update-alert  body: { id, ...fields }
exports.handler = async (event, context) => {
  if (event.httpMethod !== 'PUT' && event.httpMethod !== 'PATCH') return methodNotAllowed();

  const gate = await requireUser(event, context);
  if (gate.response) return gate.response;

  const body = parseBody(event);
  if (body === null) return badRequest('Invalid JSON');
  const id = body.id;
  if (!id || typeof id !== 'string') return badRequest('id is required');

  const existing = await sql`
    SELECT * FROM alerts WHERE id = ${id} AND user_id = ${gate.user.id}`;
  if (existing.length === 0) return notFound('Alert not found');

  // Validate against the merged view so symbol/asset_type cross-checks work.
  const merged = { ...existing[0], ...body };
  const { value, error } = validateAlert(merged, { partial: false });
  if (error) return badRequest(error);

  try {
    const rows = await sql`
      UPDATE alerts SET
        symbol                = ${value.symbol},
        asset_type            = ${value.asset_type},
        condition_type        = ${value.condition_type},
        target_value          = ${value.target_value},
        reference_price       = ${value.reference_price ?? null},
        poll_interval_seconds = ${value.poll_interval_seconds},
        recurring             = ${value.recurring ?? existing[0].recurring},
        active                = ${value.active ?? existing[0].active},
        -- editing an alert re-arms it and schedules an immediate re-check
        armed                 = TRUE,
        next_check_due        = now()
      WHERE id = ${id} AND user_id = ${gate.user.id}
      RETURNING *`;
    return ok({ alert: rows[0] });
  } catch (err) {
    console.error('[update-alert]', err);
    return serverError();
  }
};
