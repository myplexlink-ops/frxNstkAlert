'use strict';

const { sql } = require('./db');

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ONESIGNAL_APP_ID = process.env.ONESIGNAL_APP_ID;
const ONESIGNAL_REST_API_KEY = process.env.ONESIGNAL_REST_API_KEY;

async function logAttempt(alertId, channel, status, error) {
  try {
    await sql`
      INSERT INTO notification_log (alert_id, channel, status, error)
      VALUES (${alertId}, ${channel}, ${status}, ${error || null})`;
  } catch (err) {
    console.error('[notify] failed to write notification_log:', err.message);
  }
}

async function sendTelegram(chatId, text) {
  if (!TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN not set');
  const res = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) {
    throw new Error(data.description || `Telegram HTTP ${res.status}`);
  }
}

async function sendOneSignal(playerId, title, message) {
  if (!ONESIGNAL_APP_ID || !ONESIGNAL_REST_API_KEY) {
    throw new Error('OneSignal not configured');
  }
  // 2026 endpoint + key-based auth (not the legacy /api/v1 + Basic pattern).
  const res = await fetch('https://api.onesignal.com/notifications', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Key ${ONESIGNAL_REST_API_KEY}`,
    },
    body: JSON.stringify({
      app_id: ONESIGNAL_APP_ID,
      include_player_ids: [playerId],
      headings: { en: title },
      contents: { en: message },
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || (data.errors && data.errors.length)) {
    throw new Error(
      (data.errors && JSON.stringify(data.errors)) || `OneSignal HTTP ${res.status}`
    );
  }
}

/**
 * Fire both channels independently for one triggered alert. Never throws.
 * `user` must carry telegram_chat_id and onesignal_player_id.
 */
async function notifyAlert(alert, user, message) {
  const title = 'Price Alert';

  if (user.telegram_chat_id) {
    try {
      await sendTelegram(user.telegram_chat_id, message);
      await logAttempt(alert.id, 'telegram', 'sent', null);
    } catch (err) {
      console.error(`[notify] telegram alert ${alert.id}:`, err.message);
      await logAttempt(alert.id, 'telegram', 'failed', err.message);
    }
  }

  if (user.onesignal_player_id) {
    try {
      await sendOneSignal(user.onesignal_player_id, title, message);
      await logAttempt(alert.id, 'onesignal', 'sent', null);
    } catch (err) {
      console.error(`[notify] onesignal alert ${alert.id}:`, err.message);
      await logAttempt(alert.id, 'onesignal', 'failed', err.message);
    }
  }
}

module.exports = { notifyAlert, sendTelegram, sendOneSignal, logAttempt };
