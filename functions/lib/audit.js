/**
 * Append-only audit log for sensitive actions.
 * Firestore rules make `auditLogs` unwritable from any client, so entries can
 * only come from here.
 */

const { db, FieldValue } = require('./admin');

/** Fields that must never end up in a log entry. */
const FORBIDDEN_KEYS = new Set([
  'password', 'tempPassword', 'secret', 'token', 'cipher', 'ciphertext',
  'iv', 'tag', 'key', 'iban', 'salary'
]);

function scrub(meta = {}) {
  const safe = {};
  for (const [key, value] of Object.entries(meta)) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    if (value === null || value === undefined) continue;
    if (typeof value === 'object') {
      safe[key] = Array.isArray(value) ? value.slice(0, 20).join(',') : '[object]';
    } else {
      safe[key] = typeof value === 'string' ? value.slice(0, 300) : value;
    }
  }
  return safe;
}

/**
 * @param {object} params
 * @param {string} params.action      e.g. 'vault.reveal'
 * @param {object} params.caller      result of requireAuth()
 * @param {string} [params.targetId]  the affected document / user id
 * @param {string} [params.targetType]
 * @param {object} [params.meta]      safe metadata only — scrubbed below
 * @param {object} [params.request]   the callable request, for IP extraction
 */
async function writeAudit({
  action,
  caller = {},
  targetId = null,
  targetType = null,
  meta = {},
  request = null
}) {
  try {
    await db.collection('auditLogs').add({
      action,
      actorId: caller.uid || null,
      actorName: caller.name || null,
      actorRole: caller.role || null,
      targetId,
      targetType,
      meta: scrub(meta),
      // The IP only ever comes from the backend request context, never the client.
      ip: request?.rawRequest?.ip || request?.rawRequest?.headers?.['x-forwarded-for'] || null,
      userAgent: (request?.rawRequest?.headers?.['user-agent'] || '').slice(0, 200) || null,
      at: FieldValue.serverTimestamp()
    });
  } catch (err) {
    // Never let logging break the operation it is recording.
    console.error('[audit] failed to write entry', action, err);
  }
}

module.exports = { writeAudit };
