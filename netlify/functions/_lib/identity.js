'use strict';

/**
 * Write app_metadata back to Netlify Identity so flags (approved / is_admin)
 * also live on the user's JWT. Netlify injects an admin token + base URL into
 * the function context: context.clientContext.identity.{url,token}.
 * Shape: PUT {identity.url}/admin/users/{id}  body { app_metadata: {...} }
 */
async function updateIdentityMetadata(context, userId, appMetadata) {
  const identity = context && context.clientContext && context.clientContext.identity;
  if (!identity || !identity.url || !identity.token) {
    return { ok: false, reason: 'no-identity-context' };
  }
  try {
    const res = await fetch(`${identity.url}/admin/users/${userId}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${identity.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ app_metadata: appMetadata }),
    });
    if (!res.ok) {
      const t = await res.text().catch(() => '');
      return { ok: false, reason: `identity ${res.status} ${t}`.trim() };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

module.exports = { updateIdentityMetadata };
