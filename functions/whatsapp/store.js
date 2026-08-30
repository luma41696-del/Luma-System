/**
 * Where an incoming WhatsApp message lands.
 *
 * One document per conversation (`whatsappChats/{waId}`) carrying who it is
 * and what was said last, and the messages themselves in a subcollection. The
 * conversation document exists so an inbox can be listed with one query
 * instead of reading every message to work out who has written.
 *
 * Nothing here is written by a browser. The webhook runs with the Admin SDK
 * and the rules deny client writes outright, so a conversation cannot be
 * fabricated from the front end — which matters, because these become task
 * drafts that look like they came from a real client.
 */

const { db, FieldValue, Timestamp } = require('../lib/admin');
const { normalizeWaId, matchClient } = require('./phone');

/** Read once per batch rather than per message. */
async function loadClients() {
  try {
    const snap = await db.collection('clients').get();
    return snap.docs.map((d) => ({ id: d.id, name: d.data().name, phone: d.data().phone }));
  } catch (err) {
    console.error('[whatsapp] could not read clients for matching', err);
    return [];
  }
}

/**
 * Persist a batch of inbound messages.
 *
 * Meta retries a webhook it thinks failed, and a retried batch carries the
 * same message ids — so the message id is the document id, and a repeat
 * overwrites rather than creating a second copy of the same request.
 *
 * @returns {Promise<{stored:number, chats:string[]}>}
 */
async function storeIncoming(messages = []) {
  if (!messages.length) return { stored: 0, chats: [] };

  const clients = await loadClients();
  const batch = db.batch();
  const touched = new Set();

  for (const message of messages) {
    const waId = normalizeWaId(message.from);
    if (!waId) continue;

    const client = matchClient(waId, clients);
    const chatRef = db.collection('whatsappChats').doc(waId);

    batch.set(chatRef, {
      waId,
      contactName: message.name || '',
      clientId: client?.id || null,
      clientName: client?.name || null,
      lastText: (message.text || `[${message.type}]`).slice(0, 200),
      lastAt: Timestamp.fromMillis(message.timestamp),
      unread: FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    // The provider's id as our id: a redelivered webhook rewrites the same
    // document instead of duplicating the request.
    batch.set(chatRef.collection('messages').doc(message.waMessageId), {
      waMessageId: message.waMessageId,
      direction: 'in',
      type: message.type,
      text: message.text || '',
      mediaId: message.mediaId || null,
      at: Timestamp.fromMillis(message.timestamp),
      createdAt: FieldValue.serverTimestamp()
    }, { merge: true });

    touched.add(waId);
  }

  await batch.commit();
  return { stored: messages.length, chats: [...touched] };
}

module.exports = { storeIncoming, loadClients };
