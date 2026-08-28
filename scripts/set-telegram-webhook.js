'use strict';

/**
 * Register the Telegram webhook.
 *   TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... \
 *   node scripts/set-telegram-webhook.js https://your-site.netlify.app/api/telegram-webhook
 *
 * Pass "delete" as the URL to remove the webhook.
 */

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET || '';
const target = process.argv[2];

if (!token || !target) {
  console.error('Usage: TELEGRAM_BOT_TOKEN=... node scripts/set-telegram-webhook.js <public-webhook-url|delete>');
  process.exit(1);
}

(async () => {
  if (target === 'delete') {
    const res = await fetch(`https://api.telegram.org/bot${token}/deleteWebhook`);
    console.log(await res.json());
    return;
  }
  const body = { url: target, allowed_updates: ['message', 'edited_message'] };
  if (secret) body.secret_token = secret;

  const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  console.log(await res.json());

  const info = await fetch(`https://api.telegram.org/bot${token}/getWebhookInfo`);
  console.log(await info.json());
})();
