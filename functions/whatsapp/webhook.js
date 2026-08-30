/**
 * Receiving WhatsApp messages from Meta's Cloud API.
 *
 * Two jobs. Meta verifies the endpoint once with a GET carrying a challenge,
 * and then POSTs every incoming message to it.
 *
 * The signature check is the whole security model. This endpoint is public by
 * necessity — Meta has to reach it — so without verifying that a request was
 * actually signed by our app secret, anyone who learns the URL could post
 * messages that look like they came from a client, and the assistant would
 * dutifully turn them into tasks. It is checked against the raw body, before
 * anything is parsed, and compared in constant time.
 */

const crypto = require('crypto');

const APP_SECRET = () => process.env.WHATSAPP_APP_SECRET || '';
const VERIFY_TOKEN = () => process.env.WHATSAPP_VERIFY_TOKEN || '';

/**
 * Is this POST really from Meta?
 *
 * @param {Buffer|string} rawBody  exactly the bytes received, not a re-encode
 * @param {string} header          the X-Hub-Signature-256 header
 */
function verifySignature(rawBody, header) {
  const secret = APP_SECRET();
  if (!secret) return false;
  if (typeof header !== 'string' || !header.startsWith('sha256=')) return false;

  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody), 'utf8'))
    .digest('hex');

  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, which is itself a signal —
  // so the lengths are compared first and the result is the same either way.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * The GET Meta sends once to prove we own the endpoint.
 * @returns {{status:number, body:string}}
 */
function handleVerification(queryParams = {}) {
  const mode = queryParams['hub.mode'];
  const token = queryParams['hub.verify_token'];
  const challenge = queryParams['hub.challenge'];

  const expected = VERIFY_TOKEN();
  if (!expected) return { status: 500, body: 'WHATSAPP_VERIFY_TOKEN is not configured.' };
  if (mode === 'subscribe' && token === expected) {
    return { status: 200, body: String(challenge || '') };
  }
  return { status: 403, body: 'Verification failed.' };
}

/**
 * Pull the messages out of Meta's envelope.
 *
 * The payload nests entries inside changes inside values, carries statuses
 * (delivered/read receipts) in the same shape as messages, and may batch
 * several. Only inbound messages are of interest; everything else is dropped
 * rather than stored, because a read receipt is not a client request.
 *
 * @returns {Array<{waMessageId,from,name,type,text,mediaId,timestamp}>}
 */
function extractMessages(payload) {
  const out = [];
  for (const entry of payload?.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const contacts = value.contacts || [];
      for (const message of value.messages || []) {
        const contact = contacts.find((c) => c.wa_id === message.from);
        const base = {
          waMessageId: message.id,
          from: message.from,
          name: contact?.profile?.name || '',
          type: message.type,
          timestamp: Number(message.timestamp) * 1000 || Date.now(),
          text: '',
          mediaId: null
        };

        if (message.type === 'text') base.text = message.text?.body || '';
        else if (message.type === 'image') {
          base.text = message.image?.caption || '';
          base.mediaId = message.image?.id || null;
        } else if (message.type === 'document') {
          base.text = message.document?.caption || message.document?.filename || '';
          base.mediaId = message.document?.id || null;
        } else if (message.type === 'audio' || message.type === 'voice') {
          base.mediaId = message.audio?.id || null;
        } else if (message.type === 'button') {
          base.text = message.button?.text || '';
        } else if (message.type === 'interactive') {
          base.text = message.interactive?.list_reply?.title
            || message.interactive?.button_reply?.title || '';
        }

        if (base.waMessageId && base.from) out.push(base);
      }
    }
  }
  return out;
}

module.exports = { verifySignature, handleVerification, extractMessages };
