/**
 * Notifications for a deployment that has no Firestore triggers.
 *
 * The triggers in index.js are the right way to do this and they stay. But
 * they need the Blaze plan, and on the free tier the callables are served by a
 * Netlify function instead — which can only answer HTTP, so nothing in this
 * system reacts to a document being written. The result was quiet: tokens
 * registered, `notifications` never written, no push ever sent.
 *
 * So the client says *that* something happened and the server works out what
 * it means. The client sends an event name and a document id — never a title,
 * a body or a recipient list. Everything a person actually reads is decided
 * here, from the document itself, exactly as the trigger decides it.
 *
 * Two guards make that safe to expose:
 *
 *   - the caller must be the person who wrote the thing (its author, sender or
 *     creator), so this cannot be used to send messages as somebody else;
 *   - each source document is stamped `notifiedAt` inside a transaction, so a
 *     retry, a double-click or a second open tab cannot notify twice.
 *
 * The honest limitation: this runs because a client asked it to. A tab closed
 * in the second between the write and this call means that one notification is
 * never sent. A trigger would not have that gap. It is the price of the free
 * tier, and it is written here rather than discovered later.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { db, REGION, FieldValue } = require('../lib/admin');
const { requireAuth } = require('../lib/permissions');
const { str } = require('../lib/validate');
const { notify } = require('./deliver');

const opts = { region: REGION, cors: true };

/** Request types, mirroring REQUEST_TYPES in js/documents.js. */
const REQUEST_TYPES = {
  leave: 'طلب إجازة',
  departure: 'طلب مغادرة',
  late: 'إذن تأخير',
  advance: 'طلب سلفة',
  sick: 'طلب إجازة مرضية'
};

const ANNOUNCEMENT_ICONS = {
  holiday: 'palmtree',
  urgent: 'alert-triangle',
  general: 'megaphone'
};

/**
 * Claim the right to notify about a document.
 *
 * Returns the document's data the first time and null every time after, so the
 * caller can simply stop. The read and the stamp are one transaction because
 * two tabs saving at once would otherwise both pass the check.
 */
async function claim(ref) {
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;

    const data = snap.data();
    if (data.notifiedAt) return null;

    tx.update(ref, { notifiedAt: FieldValue.serverTimestamp() });
    return data;
  });
}

/** Everyone who may approve requests. */
async function approvers(exclude) {
  const people = await db.collection('users').where('status', '==', 'active').get();
  return people.docs
    .filter((doc) => {
      const data = doc.data();
      return data.accountRole === 'admin' || (data.perms || []).includes('ra');
    })
    .map((doc) => doc.id)
    .filter((uid) => uid !== exclude);
}

/** The active directory, minus one person. */
async function everyone(exclude) {
  const people = await db.collection('users')
    .where('status', '==', 'active').get()
    .catch(() => ({ docs: [] }));
  return people.docs.map((doc) => doc.id).filter((uid) => uid !== exclude);
}

/**
 * One handler per event. Each returns quietly when there is nothing to send —
 * a personal task, a draft request, a group message with no mention.
 *
 * `owner` is the field naming whoever wrote the document; the caller must
 * match it.
 */
const EVENTS = {
  'task.created': {
    ref: (id) => db.collection('tasks').doc(id),
    owner: 'createdBy',
    async run(task, id) {
      if (task.isPersonal) return;
      await notify(
        (task.assignees || []).filter((uid) => uid !== task.createdBy),
        {
          kind: 'task_assigned',
          prefKey: 'taskAssigned',
          title: 'مهمة جديدة مُسندة إليك',
          body: task.title,
          link: `#/tasks/${id}`,
          icon: 'check-square'
        }
      );
    }
  },

  'task.comment': {
    ref: (id, child) => db.collection('tasks').doc(id).collection('comments').doc(child),
    owner: 'authorId',
    needsChild: true,
    async run(comment, id) {
      const taskSnap = await db.collection('tasks').doc(id).get();
      if (!taskSnap.exists) return;
      const task = taskSnap.data();

      const audience = [
        ...(task.assignees || []),
        task.createdBy,
        ...(task.watchers || [])
      ].filter((uid) => uid && uid !== comment.authorId);

      await notify(audience, {
        kind: 'task_comment',
        prefKey: 'taskComment',
        title: `تعليق جديد على «${task.title}»`,
        body: (comment.body || '').slice(0, 120),
        link: `#/tasks/${id}`,
        icon: 'message-square'
      });
    }
  },

  'chat.message': {
    ref: (id, child) => db.collection('chats').doc(id).collection('messages').doc(child),
    owner: 'senderId',
    needsChild: true,
    async run(message, id) {
      if (message.deleted) return;

      const chatSnap = await db.collection('chats').doc(id).get();
      if (!chatSnap.exists) return;
      const chat = chatSnap.data();

      const recipients = (chat.members || []).filter((uid) => uid !== message.senderId);
      if (!recipients.length) return;

      if (chat.type === 'direct') {
        await notify(recipients, {
          kind: 'chat_message',
          prefKey: 'chatMessage',
          title: `رسالة من ${message.senderName || 'زميل'}`,
          body: (message.body || '📎 مرفق').slice(0, 120),
          link: `#/chat/${id}`,
          icon: 'message-circle'
        });
        return;
      }

      // A group message only pings people it named.
      const mentioned = recipients.filter((uid) =>
        (message.body || '').includes(`@${(chat.memberNames || {})[uid] || ' '}`));
      if (!mentioned.length) return;

      await notify(mentioned, {
        kind: 'chat_mention',
        prefKey: 'chatMention',
        title: `أشار إليك ${message.senderName || 'زميل'} في ${chat.name || 'مجموعة'}`,
        body: (message.body || '').slice(0, 120),
        link: `#/chat/${id}`,
        icon: 'at-sign'
      });
    }
  },

  'request.created': {
    ref: (id) => db.collection('requests').doc(id),
    owner: 'employeeId',
    async run(request, id) {
      if (request.status === 'draft') return;

      await notify(await approvers(request.employeeId), {
        kind: 'request_new',
        prefKey: 'requestNew',
        title: `${REQUEST_TYPES[request.type] || 'طلب إداري'} جديد`,
        body: `من ${request.employeeName || 'موظف'}`,
        link: `#/documents/${id}`,
        icon: 'file-text'
      });
    }
  },

  'announcement.created': {
    ref: (id) => db.collection('announcements').doc(id),
    owner: 'createdBy',
    async run(announcement) {
      const recipients = await everyone(announcement.createdBy);
      if (!recipients.length) return;

      await notify(recipients, {
        kind: 'announcement',
        // An office closure is not something anyone should be able to mute.
        prefKey: announcement.kind === 'urgent' ? null : 'announcement',
        title: announcement.title,
        body: String(announcement.body || '').slice(0, 140),
        link: '#/',
        icon: ANNOUNCEMENT_ICONS[announcement.kind] || ANNOUNCEMENT_ICONS.general
      });
    }
  }
};

exports.dispatchNotification = onCall(opts, async (request) => {
  const caller = requireAuth(request);

  const name = str(request.data?.event, { max: 40, required: true, field: 'الحدث' });
  const id = str(request.data?.id, { max: 128, required: true, field: 'المعرّف' });
  const child = str(request.data?.childId, { max: 128, field: 'المعرّف الفرعي' });

  const handler = EVENTS[name];
  if (!handler) throw new HttpsError('invalid-argument', 'حدث غير معروف.');
  if (handler.needsChild && !child) {
    throw new HttpsError('invalid-argument', 'المعرّف الفرعي مطلوب.');
  }

  const ref = handler.ref(id, child);

  // Read once before claiming, only to check who wrote it. Claiming first
  // would stamp a document this caller has no business notifying about, and
  // that stamp would then silence the real author's own call.
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'العنصر غير موجود.');
  if (snap.data()[handler.owner] !== caller.uid) {
    throw new HttpsError('permission-denied', 'لا يمكنك إرسال إشعار عن عنصر ليس لك.');
  }

  const data = await claim(ref);
  // Already announced by another tab, an earlier retry, or a real trigger.
  if (!data) return { sent: false, reason: 'already-notified' };

  await handler.run(data, id, child);
  return { sent: true };
});
