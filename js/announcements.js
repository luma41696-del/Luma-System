/**
 * Announcements — what management wants everyone to know.
 *
 * Lives on the dashboard rather than behind a menu item, because the whole
 * point is being seen without being looked for. An announcement with an end
 * date disappears on its own: a holiday notice for a week that has passed is
 * worse than no notice, and nobody remembers to tidy those up.
 *
 * Read by every active employee, posted only with `announcements.manage`.
 * Publishing also pushes a notification (functions/notifications), so the
 * board is where it stays, not how it first arrives.
 */

import { session } from './auth.js';
import { can } from './permissions.js';
import { $, $$, esc, attr, refreshIcons, setBusy } from './utils/dom.js';
import {
  col, ref, doc, query, where, orderBy, limit, onSnapshot,
  addDoc, updateDoc, deleteDoc, ts
} from './utils/api.js';
import { openModal, confirmDialog } from './utils/modal.js';
import { toastSuccess, toastError, reportError } from './utils/toast.js';
import { sanitizeText, sanitizeMultiline } from './utils/sanitize.js';
import { formatDate, timeAgo, toMillis, toDateTimeInput } from './utils/format.js';

export const KINDS = {
  general: { ar: 'إعلان عام', icon: 'megaphone', tone: 'brand' },
  holiday: { ar: 'إجازة / عطلة', icon: 'palmtree', tone: 'success' },
  urgent: { ar: 'عاجل', icon: 'alert-triangle', tone: 'danger' }
};

const isLive = (a) => {
  const ends = toMillis(a.expiresAt);
  return !ends || ends > Date.now();
};

/**
 * Mount the board into a host element.
 *
 * @param {HTMLElement} host
 * @returns {Function} unsubscribe
 */
export function mountAnnouncements(host) {
  const mayPost = can(session.claims, 'announcements.manage');
  let items = [];
  /** Set when the list cannot be read — see the snapshot error handler. */
  let failure = null;

  const paint = () => {
    const live = items.filter(isLive);

    // The board is the announcements, not a container for them: with none to
    // show it takes no room at all. Posting lives in the quick-add menu, so
    // an empty card is not needed to keep that reachable.
    //
    // A failed read is different from an empty one and is surfaced — but only
    // to someone who could act on it. Everyone else would get a warning about
    // a thing they cannot fix, in place of the notices they came for.
    const showFailure = !!failure && mayPost;
    if (!live.length && !showFailure) { host.innerHTML = ''; return; }

    host.innerHTML = `
      <section class="card announce">
        <div class="card__head">
          <div class="card__title"><i data-lucide="megaphone"></i> إعلانات الوكالة</div>
        </div>

        ${showFailure ? `
          <div class="notice notice--warn">
            <i data-lucide="triangle-alert"></i>
            <span>
              تعذّر قراءة الإعلانات${failure === 'permission-denied'
                ? ' — قواعد Firestore الخاصة بالإعلانات غير منشورة على المشروع بعد.'
                : '.'}
              يمكنك النشر من زر «+»، لكن القائمة لن تظهر حتى تُحلّ المشكلة.
            </span>
          </div>` : `
          <div class="announce__list">
            ${live.map(renderOne).join('')}
          </div>`}
      </section>`;

    refreshIcons(host);

    $$('[data-ann-edit]', host).forEach((b) => b.addEventListener('click', () => {
      openAnnouncementModal(items.find((a) => a.id === b.dataset.annEdit));
    }));
    $$('[data-ann-del]', host).forEach((b) => b.addEventListener('click', async () => {
      const item = items.find((a) => a.id === b.dataset.annDel);
      if (!await confirmDialog({
        title: 'حذف الإعلان', message: `سيُحذف «${item?.title || ''}» نهائياً.`,
        confirmText: 'حذف', danger: true
      })) return;
      try {
        await deleteDoc(ref('announcements', b.dataset.annDel));
        toastSuccess('حُذف الإعلان.');
      } catch (err) { reportError(err, 'announcement-delete'); }
    }));
  };

  const renderOne = (a) => {
    const kind = KINDS[a.kind] || KINDS.general;
    const ends = toMillis(a.expiresAt);
    return `
      <article class="announce__item announce__item--${attr(a.kind || 'general')}">
        <span class="announce__icon"><i data-lucide="${attr(kind.icon)}"></i></span>
        <div class="announce__body">
          <div class="announce__head">
            <span class="announce__title">${esc(a.title)}</span>
            <span class="badge badge--${attr(kind.tone)} fs-2xs">${esc(kind.ar)}</span>
          </div>
          ${a.body ? `<div class="announce__text">${esc(a.body)}</div>` : ''}
          <div class="announce__meta">
            <span>${esc(a.createdByName || '—')}</span>
            <span>·</span>
            <span>${esc(a.createdAt ? timeAgo(toMillis(a.createdAt)) : '')}</span>
            ${ends ? `<span>·</span><span>حتى ${esc(formatDate(ends))}</span>` : ''}
          </div>
        </div>
        ${mayPost ? `
          <div class="announce__actions">
            <button class="icon-btn" data-ann-edit="${attr(a.id)}" aria-label="تعديل">
              <i data-lucide="pencil"></i></button>
            <button class="icon-btn" data-ann-del="${attr(a.id)}" aria-label="حذف">
              <i data-lucide="trash-2"></i></button>
          </div>` : ''}
      </article>`;
  };

  // Newest first, and a small ceiling: this is a board, not an archive.
  const unsub = onSnapshot(
    query(col('announcements'), orderBy('createdAt', 'desc'), limit(20)),
    (snap) => {
      failure = null;
      items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      paint();
    },
    (err) => {
      // Emptying the host on error used to take the compose button with it —
      // the button appeared on first paint and vanished a moment later, so
      // the one person who could fix the situation lost the control for
      // doing so. Failing to read the list says nothing about the right to
      // publish, and the two are no longer tied together.
      console.warn('[luma] announcements', err?.code, err?.message);
      failure = err?.code || 'unknown';
      paint();
    }
  );

  paint();
  return unsub;
}

/**
 * Compose or edit. Kept in this module so the dashboard does not have to know
 * the shape of an announcement to offer the button.
 */
export async function openAnnouncementModal(existing = null) {
  if (!can(session.claims, 'announcements.manage')) {
    return toastError('لا تملك صلاحية نشر الإعلانات.');
  }
  const editing = !!existing;

  openModal({
    title: editing ? 'تعديل الإعلان' : 'إعلان جديد',
    subtitle: 'سيصل إشعار لكل الموظفين النشطين',
    size: 'md',
    bodyHTML: `
      <form id="ann-form">
        <div class="field">
          <label class="field__label" for="ann-title">العنوان <span class="req">*</span></label>
          <input class="input" id="ann-title" maxlength="160" required
                 value="${attr(existing?.title || '')}"
                 placeholder="مثال: إجازة عيد الفطر">
        </div>

        <div class="field">
          <label class="field__label" for="ann-body">التفاصيل</label>
          <textarea class="textarea" id="ann-body" rows="4" maxlength="4000"
            placeholder="اكتب التفاصيل…">${esc(existing?.body || '')}</textarea>
        </div>

        <div class="form-grid">
          <div class="field">
            <label class="field__label" for="ann-kind">النوع</label>
            <select class="select" id="ann-kind">
              ${Object.entries(KINDS).map(([k, v]) => `
                <option value="${k}" ${(existing?.kind || 'general') === k ? 'selected' : ''}>
                  ${esc(v.ar)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label class="field__label" for="ann-until">يُخفى بعد</label>
            <input class="input" id="ann-until" type="datetime-local"
                   value="${attr(existing?.expiresAt ? toDateTimeInput(toMillis(existing.expiresAt)) : '')}">
            <div class="field__hint">اتركه فارغاً ليبقى ظاهراً.</div>
          </div>
        </div>
      </form>`,
    footerHTML: `
      <button class="btn btn--ghost" data-modal-close>إلغاء</button>
      <button class="btn btn--primary" id="ann-save">
        <i data-lucide="send"></i> ${editing ? 'حفظ' : 'نشر'}
      </button>`,
    onMount: (api) => {
      refreshIcons(api.root);
      api.$('#ann-title').focus();

      api.$('#ann-save').addEventListener('click', async () => {
        const title = sanitizeText(api.$('#ann-title').value, 160);
        if (!title) return toastError('العنوان مطلوب.');

        const untilValue = api.$('#ann-until').value;
        const payload = {
          title,
          body: sanitizeMultiline(api.$('#ann-body').value, 4000),
          kind: api.$('#ann-kind').value,
          expiresAt: untilValue ? new Date(untilValue).getTime() : null,
          updatedAt: ts()
        };

        const button = api.$('#ann-save');
        setBusy(button, true);
        try {
          if (editing) {
            // createdBy is echoed back unchanged — the rules require it, so an
            // edit cannot quietly reassign who published something.
            await updateDoc(ref('announcements', existing.id), {
              ...payload, createdBy: existing.createdBy
            });
            toastSuccess('تم حفظ الإعلان.');
          } else {
            await addDoc(col('announcements'), {
              ...payload,
              createdBy: session.uid,
              createdByName: session.profile?.displayName || '',
              createdAt: ts()
            });
            toastSuccess('نُشر الإعلان ووصل إشعار للفريق.');
          }
          api.close();
        } catch (err) {
          reportError(err, 'announcement-save');
        } finally {
          setBusy(button, false);
        }
      });
    }
  });
}
