'use strict';

const JSON_HEADERS = { 'Content-Type': 'application/json' };

function json(statusCode, body) {
  return { statusCode, headers: JSON_HEADERS, body: JSON.stringify(body) };
}

const ok = (body) => json(200, body ?? { ok: true });
const badRequest = (msg) => json(400, { error: msg || 'Bad request' });
const unauthorized = (msg) => json(401, { error: msg || 'Not authenticated' });
const forbidden = (msg) => json(403, { error: msg || 'Not allowed' });
const notFound = (msg) => json(404, { error: msg || 'Not found' });
const methodNotAllowed = () => json(405, { error: 'Method not allowed' });
const serverError = (msg) => json(500, { error: msg || 'Internal error' });

function parseBody(event) {
  if (!event.body) return {};
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body;
    return JSON.parse(raw);
  } catch {
    return null; // caller should treat null as a parse failure
  }
}

module.exports = {
  json,
  ok,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  methodNotAllowed,
  serverError,
  parseBody,
};
