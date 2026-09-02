/**
 * Delivering a notification: the Firestore document people see in the app, and
 * the push message that reaches a device.
 *
 * Split out from the triggers so it can be reused by `dispatch.js`, which does
 * the same fan-out for deployments where Firestore triggers cannot run.
 * Whoever decides *who* hears about something, this is the only thing that
 * decides *how* they hear it.
 */

const { db, messaging, FieldValue } = require('../lib/admin');

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

module.exports = { notify, deliver };
