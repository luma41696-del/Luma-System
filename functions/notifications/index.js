/**
 * Notification fan-out.
 *
 * Firestore triggers create `notifications` documents (clients can only mark
 * them read) and push a Web Push message to any registered device. Per-user
 * preferences in `users/{uid}.notifPrefs` decide what actually gets delivered.
 */

const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore');
const { onSchedule } = require('firebase-functions/v2/scheduler');
const { db, messaging, FieldValue, REGION, TIMEZONE } = require('../lib/admin');

const region = { region: REGION };

/* -------------------------------------------------------------- delivery */

/**
 * @param {string[]} userIds
 * @param {{kind,title,body,link,icon,prefKey}} payload
 */
async function notify(userIds, payload) {
  try {
    await deliver(userIds, payload);
  } catch (err) {
    // Notifications are best-effort: an unhandled throw here would kill the
    // functions runtime and take any concurrent request down with it.
    console.error('[notify] delivery failed', payload?.kind, err);
  }
}

async function deliver(userIds, payload) {
  const recipients = [...new Set(userIds.filter(Boolean))];
  if (!recipients.length) return;

  const profiles = await db.getAll(
    ...recipients.map((uid) => db.collection('users').doc(uid))
  ).catch(() => []);

  const batch = db.batch();
  const tokens = [];

  for (const snap of profiles) {
    if (!snap.exists) continue;
    const data = snap.data();
    if (data.status === 'disabled') continue;
    // An explicit `false` opts out; anything else (including undefined) opts in.
    if (payload.prefKey && data.notifPrefs?.[payload.prefKey] === false) continue;

    batch.set(db.collection('notifications').doc(), {
      userId: snap.id,
      kind: payload.kind,
      title: payload.title,
      body: payload.body || '',
      link: payload.link || null,
      icon: payload.icon || null,
      read: false,
      createdAt: FieldValue.serverTimestamp()
    });

    if (Array.isArray(data.fcmTokens)) tokens.push(...data.fcmTokens.slice(-3));
  }

  await batch.commit().catch((err) => console.error('[notify] batch failed', err));

  if (tokens.length) {
    try {
      const response = await messaging().sendEachForMulticast({
        tokens: [...new Set(tokens)].slice(0, 400),
        notification: { title: payload.title, body: payload.body || '' },
        webpush: {
          fcmOptions: { link: payload.link ? `/dashboard.html${payload.link}` : '/dashboard.html' },
          notification: { icon: '/assets/logo/luma-mark-yellow.png', dir: 'rtl', lang: 'ar' }
        }
      });
      // Drop tokens the service rejected so the list does not grow stale.
      response.responses.forEach((result, index) => {
        if (!result.success && result.error?.code?.includes('registration-token-not-registered')) {
          const dead = [...new Set(tokens)][index];
          profiles.forEach((snap) => {
            if (snap.exists && (snap.data().fcmTokens || []).includes(dead)) {
              db.collection('users').doc(snap.id)
                .update({ fcmTokens: FieldValue.arrayRemove(dead) }).catch(() => {});
            }
          });
        }
      });
    } catch (err) {
      console.warn('[notify] push delivery failed', err.message);
    }
  }
}

/* ============================================================ task events */

exports.onTaskCreated = onDocumentCreated(
  { ...region, document: 'tasks/{taskId}' },
  async (event) => {
    const task = event.data?.data();
    if (!task || task.isPersonal) return;

    const recipients = (task.assignees || []).filter((uid) => uid !== task.createdBy);
    await notify(recipients, {
      kind: 'task_assigned',
      prefKey: 'taskAssigned',
      title: 'مهمة جديدة مُسندة إليك',
      body: task.title,
      link: `#/tasks/${event.params.taskId}`,
      icon: 'check-square'
    });
  }
);

exports.onTaskUpdated = onDocumentUpdated(
  { ...region, document: 'tasks/{taskId}' },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!before || !after) return;

    // Newly added assignees get the same notification as on creation.
    const added = (after.assignees || []).filter((uid) => !(before.assignees || []).includes(uid));
    if (added.length) {
      await notify(added, {
        kind: 'task_assigned',
        prefKey: 'taskAssigned',
        title: 'تم إسناد مهمة إليك',
        body: after.title,
        link: `#/tasks/${event.params.taskId}`,
        icon: 'check-square'
      });
    }

    // Completion notifies the creator (unless they completed it themselves).
    if (before.status !== 'completed' && after.status === 'completed' && after.createdBy) {
      await notify([after.createdBy], {
        kind: 'task_completed',
        prefKey: 'taskComment',
        title: 'تم إنجاز مهمة',
        body: after.title,
        link: `#/tasks/${event.params.taskId}`,
        icon: 'check-circle-2'
      });
    }
  }
);

exports.onTaskComment = onDocumentCreated(
  { ...region, document: 'tasks/{taskId}/comments/{commentId}' },
  async (event) => {
    const comment = event.data?.data();
    if (!comment) return;

    const taskSnap = await db.collection('tasks').doc(event.params.taskId).get();
    if (!taskSnap.exists) return;
    const task = taskSnap.data();

    const audience = [...(task.assignees || []), task.createdBy, ...(task.watchers || [])]
      .filter((uid) => uid && uid !== comment.authorId);

    await notify(audience, {
      kind: 'task_comment',
      prefKey: 'taskComment',
      title: `تعليق جديد على «${task.title}»`,
      body: (comment.body || '').slice(0, 120),
      link: `#/tasks/${event.params.taskId}`,
      icon: 'message-square'
    });
  }
);

/* ========================================================= request events */

exports.onRequestCreated = onDocumentCreated(
  { ...region, document: 'requests/{requestId}' },
  async (event) => {
    const request = event.data?.data();
    if (!request || request.status === 'draft') return;

    // Everyone who can approve requests hears about it.
    const approvers = await db.collection('users')
      .where('status', '==', 'active').get();
    const recipients = approvers.docs
      .filter((doc) => {
        const data = doc.data();
        return data.accountRole === 'admin' || (data.perms || []).includes('ra');
      })
      .map((doc) => doc.id)
      .filter((uid) => uid !== request.employeeId);

    const TYPES = {
      leave: 'طلب إجازة', departure: 'طلب مغادرة',
      advance: 'طلب سلفة', sick: 'طلب إجازة مرضية'
    };

    await notify(recipients, {
      kind: 'request_new',
      prefKey: 'requestNew',
      title: `${TYPES[request.type] || 'طلب إداري'} جديد`,
      body: `من ${request.employeeName || 'موظف'}`,
      link: `#/documents/${event.params.requestId}`,
      icon: 'inbox'
    });
  }
);

exports.onRequestDecided = onDocumentUpdated(
  { ...region, document: 'requests/{requestId}' },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!before || !after || before.status === after.status) return;
    if (!['approved', 'rejected', 'review'].includes(after.status)) return;

    const LABELS = {
      approved: 'تمت الموافقة على طلبك',
      rejected: 'تم رفض طلبك',
      review: 'طلبك قيد المراجعة'
    };

    await notify([after.employeeId], {
      kind: 'request_decided',
      prefKey: 'requestDecision',
      title: LABELS[after.status],
      body: after.managerResponse || '',
      link: `#/documents/${event.params.requestId}`,
      icon: 'gavel'
    });
  }
);

exports.onRequestThreadMessage = onDocumentCreated(
  { ...region, document: 'requests/{requestId}/thread/{messageId}' },
  async (event) => {
    const message = event.data?.data();
    if (!message) return;

    const requestSnap = await db.collection('requests').doc(event.params.requestId).get();
    if (!requestSnap.exists) return;
    const request = requestSnap.data();

    // Employee wrote → tell the approvers; a manager wrote → tell the employee.
    let recipients = [];
    if (message.authorId === request.employeeId) {
      const managers = await db.collection('users').where('status', '==', 'active').get();
      recipients = managers.docs
        .filter((d) => d.data().accountRole === 'admin' || (d.data().perms || []).includes('ra'))
        .map((d) => d.id);
    } else {
      recipients = [request.employeeId];
    }

    await notify(recipients.filter((uid) => uid !== message.authorId), {
      kind: 'request_message',
      prefKey: 'requestDecision',
      title: 'رسالة جديدة بخصوص طلب إداري',
      body: (message.body || '').slice(0, 120),
      link: `#/documents/${event.params.requestId}`,
      icon: 'message-circle'
    });
  }
);

/* ============================================================= chat events */

exports.onChatMessage = onDocumentCreated(
  { ...region, document: 'chats/{chatId}/messages/{messageId}' },
  async (event) => {
    const message = event.data?.data();
    if (!message || message.deleted) return;

    const chatSnap = await db.collection('chats').doc(event.params.chatId).get();
    if (!chatSnap.exists) return;
    const chat = chatSnap.data();

    const recipients = (chat.members || []).filter((uid) => uid !== message.senderId);
    const isDirect = chat.type === 'direct';

    // A group message only pings people who were mentioned by name.
    const mentioned = isDirect ? recipients : recipients.filter((uid) =>
      (message.body || '').includes(`@${(chat.memberNames || {})[uid] || ' '}`));

    if (isDirect) {
      await notify(recipients, {
        kind: 'chat_message',
        prefKey: 'chatMessage',
        title: `رسالة من ${message.senderName || 'زميل'}`,
        body: (message.body || '📎 مرفق').slice(0, 120),
        link: `#/chat/${event.params.chatId}`,
        icon: 'message-circle'
      });
    } else if (mentioned.length) {
      await notify(mentioned, {
        kind: 'chat_mention',
        prefKey: 'chatMention',
        title: `أشار إليك ${message.senderName || 'زميل'} في ${chat.name || 'مجموعة'}`,
        body: (message.body || '').slice(0, 120),
        link: `#/chat/${event.params.chatId}`,
        icon: 'at-sign'
      });
    }
  }
);

/* ----------------------------------------------------------- announcements */

/**
 * A new announcement reaches everyone.
 *
 * The one fan-out in this file that is not scoped to the people involved in a
 * document — an announcement is a broadcast by definition, so the recipient
 * list is the active directory. Disabled accounts are dropped by deliver(),
 * and the urgent kind ignores the per-user opt-out that the others honour:
 * an office closure is not a notification anyone should be able to mute.
 */
exports.onAnnouncementCreated = onDocumentCreated(
  { ...region, document: 'announcements/{id}' },
  async (event) => {
    const data = event.data?.data();
    if (!data) return;

    const people = await db.collection('users').where('status', '==', 'active').get()
      .catch(() => ({ docs: [] }));
    const recipients = people.docs.map((d) => d.id).filter((uid) => uid !== data.createdBy);
    if (!recipients.length) return;

    const ICONS = { holiday: 'palmtree', urgent: 'alert-triangle', general: 'megaphone' };

    await notify(recipients, {
      kind: 'announcement',
      // Urgent bypasses the opt-out; the rest respect it.
      prefKey: data.kind === 'urgent' ? null : 'announcement',
      title: data.title,
      body: String(data.body || '').slice(0, 140),
      link: '#/',
      icon: ICONS[data.kind] || ICONS.general
    });
  }
);

/* ------------------------------------------------------------ client edits */

exports.onClientUpdated = onDocumentUpdated(
  { ...region, document: 'clients/{clientId}' },
  async (event) => {
    const before = event.data?.before?.data();
    const after = event.data?.after?.data();
    if (!before || !after) return;

    const interesting = ['name', 'status', 'accountManagerId', 'contractEnd', 'services'];
    const changed = interesting.filter((key) =>
      JSON.stringify(before[key]) !== JSON.stringify(after[key]));
    if (!changed.length) return;

    const recipients = [after.accountManagerId, before.accountManagerId].filter(Boolean);
    await notify(recipients, {
      kind: 'client_updated',
      prefKey: 'clientUpdated',
      title: `تم تحديث بيانات ${after.name}`,
      body: `الحقول المعدّلة: ${changed.join('، ')}`,
      link: `#/clients/${event.params.clientId}`,
      icon: 'briefcase'
    });
  }
);

/* ========================================================= scheduled jobs */

/**
 * Every morning at 08:00 Amman time: warn about deadlines within 24 hours and
 * flag anything that slipped past its due date.
 */
exports.dailyDeadlineDigest = onSchedule(
  { ...region, schedule: '0 8 * * *', timeZone: TIMEZONE },
  async () => {
    const now = Date.now();
    const soon = new Date(now + 24 * 60 * 60 * 1000);

    const snap = await db.collection('tasks')
      .where('dueAt', '<=', soon)
      .where('dueAt', '>=', new Date(now - 30 * 24 * 60 * 60 * 1000))
      .get();

    const dueSoon = [];
    const overdue = [];

    snap.docs.forEach((doc) => {
      const task = { id: doc.id, ...doc.data() };
      if (['completed', 'cancelled'].includes(task.status) || task.deleted) return;
      const dueMs = task.dueAt?.toMillis?.() || 0;
      if (dueMs < now) overdue.push(task);
      else dueSoon.push(task);
    });

    for (const task of dueSoon) {
      await notify(task.assignees || [], {
        kind: 'task_due',
        prefKey: 'taskDue',
        title: 'اقترب موعد تسليم مهمة',
        body: task.title,
        link: `#/tasks/${task.id}`,
        icon: 'clock'
      });
    }

    for (const task of overdue) {
      await notify(task.assignees || [], {
        kind: 'task_overdue',
        prefKey: 'taskOverdue',
        title: 'لديك مهمة متأخرة',
        body: task.title,
        link: `#/tasks/${task.id}`,
        icon: 'alert-triangle'
      });
    }

    console.log(`[digest] due soon: ${dueSoon.length}, overdue: ${overdue.length}`);
  }
);

/**
 * Nightly cleanup at 03:00: drop read notifications older than 45 days and
 * close break sessions that were never ended (browser closed mid-break).
 */
exports.nightlyMaintenance = onSchedule(
  { ...region, schedule: '0 3 * * *', timeZone: TIMEZONE },
  async () => {
    const cutoff = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);

    const stale = await db.collection('notifications')
      .where('read', '==', true).where('createdAt', '<', cutoff).limit(500).get();
    const batch = db.batch();
    stale.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();

    const openBreaks = await db.collection('breakSessions')
      .where('endedAt', '==', null)
      .where('startedAt', '<', new Date(Date.now() - 12 * 60 * 60 * 1000))
      .limit(200).get();

    const closer = db.batch();
    openBreaks.docs.forEach((doc) => {
      const startedAt = doc.data().startedAt?.toMillis?.() || Date.now();
      closer.update(doc.ref, {
        endedAt: FieldValue.serverTimestamp(),
        // Cap an abandoned break at two hours rather than inventing a number.
        durationMs: Math.min(Date.now() - startedAt, 2 * 60 * 60 * 1000),
        autoClosed: true
      });
    });
    await closer.commit();

    console.log(`[maintenance] removed ${stale.size} notifications, closed ${openBreaks.size} breaks`);
  }
);

module.exports.notify = notify;
