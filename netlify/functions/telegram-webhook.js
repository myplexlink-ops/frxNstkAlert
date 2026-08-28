'use strict';

const { sql } = require('./_lib/db');
const { sendTelegram } = require('./_lib/notify');

const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET;

// POST /api/telegram-webhook  (set as Telegram bot webhook target)
// Handles: /start <CODE>  -> links chat.id to the user holding that link code.
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method not allowed' };

  // Telegram sends the configured secret in this header.
  if (WEBHOOK_SECRET) {
    const got = event.headers['x-telegram-bot-api-secret-token'];
    if (got !== WEBHOOK_SECRET) {
      console.warn('[telegram-webhook] bad secret token');
      return { statusCode: 401, body: 'unauthorized' };
    }
  }

  let update;
  try {
    update = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 200, body: 'ok' }; // never make Telegram retry on garbage
  }

  const msg = update.message || update.edited_message;
  const text = msg && msg.text ? msg.text.trim() : '';
  const chatId = msg && msg.chat && msg.chat.id;

  try {
    if (chatId && /^\/start(\s|$)/i.test(text)) {
      const parts = text.split(/\s+/);
      const code = (parts[1] || '').toUpperCase();

      if (!code) {
        await sendTelegram(chatId, 'Send /start followed by the link code shown on your alerts account page.');
        return { statusCode: 200, body: 'ok' };
      }

      const rows = await sql`
        UPDATE users
        SET telegram_chat_id = ${String(chatId)}, telegram_link_code = NULL
        WHERE telegram_link_code = ${code}
        RETURNING email`;

      if (rows.length === 0) {
        await sendTelegram(chatId, 'That link code was not recognised (it may have already been used). Generate a fresh one on your account page.');
      } else {
        await sendTelegram(chatId, `Linked. This chat will now receive price alerts for ${rows[0].email}.`);
      }
    } else if (chatId && text) {
      await sendTelegram(chatId, 'This bot only delivers price alerts. Use /start <code> from your account page to link.');
    }
  } catch (err) {
    console.error('[telegram-webhook]', err);
  }

  return { statusCode: 200, body: 'ok' };
};
