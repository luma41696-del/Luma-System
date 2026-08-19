/**
 * The knowledge base — research notes saved from Luma AI, plus anything a
 * person writes by hand.
 *
 * Notes reached here through the assistant began as text from the open web,
 * so two things hold throughout: the body is rendered escaped (never as
 * markup), and every source is shown as a link the reader can check for
 * themselves. A note is only ever written by a person pressing save.
 */

import { session } from './auth.js';
import { can } from './permissions.js';
import {
  $, $$, esc, attr, refreshIcons, render as mount, emptyState, setBusy, debounce, on
} from './utils/dom.js';
import { toastSuccess, toastError, reportError } from './utils/toast.js';
import { openModal, confirmDialog } from './utils/modal.js';
import {
  col, ref, query, orderBy, limit, onSnapshot, addDoc, deleteDoc, getMany, ts
} from './utils/api.js';
import { formatDate, timeAgo } from './utils/format.js';
import { sanitizeText, sanitizeMultiline, safeUrl, linkHost } from './utils/sanitize.js';

export async function render(container, ctx) {
  const unsubs = [];
  const canManage = can(session.claims, 'knowledge.manage');
  let notes = [];
  let term = '';

  container.innerHTML = `
    <div class="page__inner">
      <div class="page-head">
        <div>
          <div class="page-head__title">قاعدة المعرفة</div>
          <div class="page-head__sub" id="kb-count">ملاحظات وأبحاث محفوظة</div>
        </div>
        <div class="page-head__actions">
          ${can(session.claims, 'tasks.ai')
            ? `<button class="btn btn--ai" id="kb-ai-btn">
                 <i data-lucide="sparkles"></i> Luma AI
               </button>` : ''}
          ${canManage
            ? '<button class="btn btn--primary" id="kb-new"><i data-lucide="plus"></i> ملاحظة جديدة</button>' : ''}
        </div>
      </div>

      ${can(session.claims, 'tasks.ai') ? '<div id="kb-ai" hidden></div>' : ''}

      <div class="filter-bar mt-4">
        <span class="filter-bar__label"><i data-lucide="search"></i> بحث</span>
        <input class="input" id="kb-search" type="search" placeholder="ابحث في العناوين والمحتوى والوسوم…">
      </div>

      <div id="kb-list" class="mt-4">${'<div class="skeleton skeleton--row"></div>'.repeat(3)}</div>
    </div>`;

  refreshIcons(container);

  $('#kb-search').addEventListener('input', debounce((e) => { term = e.target.value.trim().toLowerCase(); paint(); }, 200));
  $('#kb-new')?.addEventListener('click', () => openNoteModal());

  /* ------------------------------------------------------------- Luma AI */
  attachAssistant();
  async function attachAssistant() {
    const { attachManagerAssistant } = await import('./manager-ai.js');
    const { openDraft } = await import('./ai-draft.js');
    const { buildSuggestions } = await import('./ai-suggestions.js');
    const clients = can(session.claims, 'clients.view')
      ? await getMany(query(col('clients'), orderBy('name'), limit(200))).catch(() => [])
      : [];
    unsubs.push(attachManagerAssistant({
      button: $('#kb-ai-btn'),
      host: $('#kb-ai'),
      onDraft: (draft) => openDraft(draft),
      panel: {
        subtitle: 'ابحث في الإنترنت، حلّل، واحفظ الخلاصة',
        placeholder: 'مثال: ابحث عن أحدث مقاسات منشورات إنستغرام 2026',
        suggestions: () => buildSuggestions({ page: 'knowledge', clients })
      }
    }));
  }

  /* ---------------------------------------------------------------- data */
  unsubs.push(onSnapshot(
    query(col('knowledge'), orderBy('createdAt', 'desc'), limit(300)),
    (snap) => { notes = snap.docs.map((d) => ({ id: d.id, ...d.data() })); paint(); },
    (err) => mount($('#kb-list'), emptyState({
      icon: 'shield-alert',
      title: 'تعذّر تحميل قاعدة المعرفة',
      text: err.code === 'permission-denied'
        ? 'قواعد الحماية لا تعرف بعد مجموعة «knowledge». انشرها: firebase deploy --only firestore:rules'
        : err.message
    }))
  ));

  function paint() {
    const host = $('#kb-list');
    if (!host) return;

    const rows = notes.filter((n) => !term
      || `${n.title} ${n.content} ${(n.tags || []).join(' ')} ${n.clientName || ''}`
        .toLowerCase().includes(term));

    $('#kb-count').textContent = notes.length
      ? `${rows.length} من ${notes.length} ملاحظة`
      : 'ملاحظات وأبحاث محفوظة';

    if (!rows.length) {
      mount(host, emptyState({
        icon: 'book-open',
        title: notes.length ? 'لا نتائج' : 'لا ملاحظات بعد',
        text: notes.length
          ? 'جرّب كلمة بحث أخرى.'
          : 'اسأل Luma AI أن يبحث لك في الإنترنت ويحفظ الخلاصة هنا.'
      }));
      return;
    }

    host.innerHTML = `<div class="grid grid-auto">${rows.map((note) => `
      <article class="card kb-note">
        <div class="flex justify-between items-start gap-2">
          <div style="min-width:0">
            <div class="fw-700">${esc(note.title)}</div>
            <div class="fs-2xs text-muted mt-1">
              ${esc(note.clientName ? `${note.clientName} · ` : '')}${esc(timeAgo(note.createdAt))}
            </div>
          </div>
          ${canManage
            ? `<button class="icon-btn" data-del="${attr(note.id)}" title="حذف" aria-label="حذف">
                 <i data-lucide="trash-2" class="icon-sm"></i></button>` : ''}
        </div>

        <div class="kb-note__body fs-sm">${esc(note.content)}</div>

        ${note.tags?.length ? `<div class="tag-list mt-3">
          ${note.tags.map((t) => `<span class="badge">${esc(t)}</span>`).join('')}
        </div>` : ''}

        ${note.sources?.length ? `
          <div class="list-divider"></div>
          <div class="fs-2xs text-muted mb-2">
            <i data-lucide="link" class="icon-sm"></i> المصادر
          </div>
          <div class="flex-col gap-1">
            ${note.sources.map((url) => {
              const href = safeUrl(url);
              return href
                ? `<a class="fs-2xs truncate" href="${attr(href)}" target="_blank"
                      rel="noopener noreferrer nofollow">${esc(linkHost(href) || href)}</a>`
                : '';
            }).join('')}
          </div>` : ''}
      </article>`).join('')}</div>`;

    refreshIcons(host);

    on(host, 'click', '[data-del]', async (e, node) => {
      const note = notes.find((n) => n.id === node.dataset.del);
      if (!note) return;
      const ok = await confirmDialog({
        title: 'حذف الملاحظة',
        message: `سيتم حذف «${esc(note.title)}» نهائياً.`,
        confirmText: 'حذف',
        danger: true
      });
      if (!ok) return;
      try {
        await deleteDoc(ref('knowledge', note.id));
        toastSuccess('تم حذف الملاحظة.');
      } catch (err) { reportError(err, 'knowledge-delete'); }
    });
  }

  return () => unsubs.forEach((fn) => { try { fn(); } catch {} });
}

/**
 * The review-and-save form. Opened empty from "ملاحظة جديدة", or pre-filled
 * from a Luma AI draft — the same form either way, so what gets stored is
 * always what a person looked at.
 *
 * @param {object} [defaults]
 */
export async function openNoteModal(defaults = {}) {
  const clients = can(session.claims, 'clients.view')
    ? await getMany(query(col('clients'), orderBy('name'), limit(200))).catch(() => [])
    : [];

  openModal({
    title: defaults.title ? 'مراجعة الملاحظة وحفظها' : 'ملاحظة جديدة',
    subtitle: defaults.title ? 'راجع المحتوى والمصادر قبل الحفظ' : '',
    size: 'lg',
    bodyHTML: `
      <div class="field">
        <label class="field__label" for="kn-title">العنوان <span class="req">*</span></label>
        <input class="input" id="kn-title" maxlength="200" value="${attr(defaults.title || '')}"
               placeholder="مثال: مقاسات منشورات إنستغرام 2026">
      </div>

      <div class="field">
        <label class="field__label" for="kn-content">المحتوى <span class="req">*</span></label>
        <textarea class="textarea" id="kn-content" rows="10"
                  maxlength="8000">${esc(defaults.content || '')}</textarea>
      </div>

      <div class="form-grid">
        <div class="field">
          <label class="field__label" for="kn-tags">الوسوم</label>
          <input class="input" id="kn-tags" maxlength="200"
                 value="${attr((defaults.tags || []).join('، '))}"
                 placeholder="تصميم، إنستغرام — افصل بفاصلة">
        </div>
        ${clients.length ? `
        <div class="field">
          <label class="field__label" for="kn-client">العميل (اختياري)</label>
          <select class="select" id="kn-client">
            <option value="">— بدون —</option>
            ${clients.map((c) => `<option value="${attr(c.id)}"
              ${defaults.clientId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
          </select>
        </div>` : ''}
      </div>

      <div class="field">
        <label class="field__label" for="kn-sources">المصادر</label>
        <textarea class="textarea" id="kn-sources" rows="3"
                  placeholder="روابط، كل رابط في سطر">${esc((defaults.sources || []).join('\n'))}</textarea>
        <div class="field__hint">افتح الروابط وتأكد من المعلومة قبل الحفظ.</div>
      </div>

      ${defaults.unresolved?.length ? `
        <div class="security-note" style="background:var(--warning-soft);border-color:rgba(251,191,36,.35)">
          <i data-lucide="alert-triangle" style="color:var(--warning)"></i>
          <div>تعذّر ربط: ${esc(defaults.unresolved.join('، '))}</div>
        </div>` : ''}

      ${defaults.title ? `
        <div class="security-note">
          <i data-lucide="info"></i>
          <div>
            هذه المسودة مبنية على نتائج بحث من الإنترنت. راجع المحتوى والمصادر —
            لا تُحفظ أي معلومة قبل أن تتأكد منها.
          </div>
        </div>` : ''}`,
    footerHTML: `
      <button class="btn btn--ghost" data-modal-close>إلغاء</button>
      <button class="btn btn--primary" id="kn-save"><i data-lucide="check"></i> حفظ</button>`,
    onMount: (api) => {
      refreshIcons(api.root);
      api.$('#kn-save').addEventListener('click', async () => {
        const title = sanitizeText(api.$('#kn-title').value, 200);
        const content = sanitizeMultiline(api.$('#kn-content').value, 8000);
        if (!title) return toastError('العنوان مطلوب.');
        if (!content) return toastError('المحتوى مطلوب.');

        const clientSelect = api.$('#kn-client');
        const button = api.$('#kn-save');
        setBusy(button, true);
        try {
          await addDoc(col('knowledge'), {
            title,
            content,
            tags: api.$('#kn-tags').value.split(/[،,]/).map((t) => t.trim()).filter(Boolean).slice(0, 8),
            // Re-filtered on the way in as well as on the way out: a link that
            // is not http(s) has no business being stored.
            sources: api.$('#kn-sources').value
              .split(/\s+/).map((u) => u.trim()).filter((u) => !!safeUrl(u)).slice(0, 12),
            clientId: clientSelect?.value || null,
            clientName: clientSelect?.value
              ? sanitizeText(clientSelect.selectedOptions[0].textContent, 140) : null,
            createdBy: session.uid,
            createdAt: ts()
          });
          toastSuccess('تم حفظ الملاحظة.');
          api.close();
        } catch (err) {
          reportError(err, 'knowledge-save');
        } finally {
          setBusy(button, false);
        }
      });
    }
  });
}
