'use strict';

const crypto = require('crypto');
const { sql } = require('./_lib/db');
const { requireUser } = require('./_lib/auth');
const { ok, methodNotAllowed, serverError } = require('./_lib/http');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

function botUsernameHint() {
  // Not authoritative — the frontend shows the /start command; user finds the bot by name.
  return process.env.TELEGRAM_BOT_USERNAME || null;
}

// GET  /api/get-telegram-link-code       -> returns existing or generates one
// POST /api/get-telegram-link-code       -> forces regeneration
exports.handler = async (event, context) => {
  if (!['GET', 'POST'].includes(event.httpMethod)) return methodNotAllowed();

  const gate = await requireUser(event, context);
  if (gate.response) return gate.response;

  try {
    let code = gate.user.telegram_link_code;
    const regen = event.httpMethod === 'POST' || !code;
    if (regen) {
      code = crypto.randomBytes(4).toString('hex').toUpperCase(); // 8 hex chars
      await sql`UPDATE users SET telegram_link_code = ${code} WHERE id = ${gate.user.id}`;
    }

    return ok({
      code,
      linked: !!gate.user.telegram_chat_id,
      start_command: `/start ${code}`,
      bot_username: botUsernameHint(),
      configured: !!TELEGRAM_BOT_TOKEN,
    });
  } catch (err) {
    console.error('[get-telegram-link-code]', err);
    return serverError();
  }
};
