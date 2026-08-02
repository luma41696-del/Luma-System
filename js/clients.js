/**
 * Client directory + create/edit modal.
 * Credentials are deliberately absent from this module — they live only in the
 * encrypted vault reachable from the client profile.
 */

import { session } from './auth.js';
import { can } from './permissions.js';
import {
  $, $$, esc, attr, refreshIcons, render as mount, emptyState, debounce, setBusy, avatarHTML
} from './utils/dom.js';
import { toastSuccess, toastError, reportError } from './utils/toast.js';
import { openModal, confirmDialog } from './utils/modal.js';
import {
  col, ref, query, orderBy, limit, onSnapshot, addDoc, updateDoc, getDirectory, ts
} from './utils/api.js';
import { formatDate } from './utils/format.js';
import { sanitizeText, sanitizeMultiline, isValidEmail, isValidPhone, safeUrl } from './utils/sanitize.js';
import { uploadFile, compressImage, pickFiles, paths } from './utils/upload.js';
import { uploadsEnabled, uploadsDisabledNotice } from './features.js';

export const SERVICES = {
  social: 'إدارة السوشال ميديا',
  design: 'التصميم الجرافيكي',
  video: 'إنتاج الفيديو',
  photo: 'التصوير',
  web: 'تطوير المواقع',
  ads: 'الحملات الإعلانية',
  branding: 'الهوية البصرية',
  seo: 'تحسين محركات البحث'
};

export const PLATFORMS = {
  facebook:  { ar: 'فيسبوك',   icon: 'facebook' },
  instagram: { ar: 'إنستغرام', icon: 'instagram' },
  tiktok:    { ar: 'تيك توك',  icon: 'music-2' },
  linkedin:  { ar: 'لينكدإن',  icon: 'linkedin' },
  youtube:   { ar: 'يوتيوب',   icon: 'youtube' },
  website:   { ar: 'الموقع الإلكتروني', icon: 'globe' },
  x:         { ar: 'إكس (تويتر)', icon: 'twitter' },
  snapchat:  { ar: 'سناب شات', icon: 'ghost' }
};

export async function render(container) {
  const unsubs = [];
  let clients = [];
  let filters = { search: '', status: 'all', manager: 'all' };

  const directory = await getDirectory().catch(() => []);
  const people = Object.fromEntries(directory.map((u) => [u.id, u]));

  container.innerHTML = `
    <div class="page__inner">
      <div class="page-head">
        <div>
          <div class="page-head__title">العملاء</div>
          <div class="page-head__sub" id="client-count">…</div>
        </div>
        <div class="page-head__actions">
          ${can(session.claims, 'clients.create')
            ? '<button class="btn btn--primary" id="new-client"><i data-lucide="plus"></i> عميل جديد</button>' : ''}
        </div>
      </div>

      <div class="filter-bar">
        <span class="filter-bar__label"><i data-lucide="filter"></i> تصفية</span>
        <input class="input" id="f-search" type="search" placeholder="ابحث باسم العميل…">
        <select class="select" id="f-status">
          <option value="all">كل الحالات</option>
          <option value="active">نشط</option>
          <option value="paused">متوقف مؤقتاً</option>
          <option value="ended">منتهي</option>
        </select>
        <select class="select" id="f-manager">
          <option value="all">كل مديري الحسابات</option>
          ${directory.map((u) => `<option value="${attr(u.id)}">${esc(u.displayName)}</option>`).join('')}
        </select>
      </div>

      <div id="client-list">${'<div class="skeleton skeleton--row"></div>'.repeat(5)}</div>
    </div>`;

  refreshIcons(container);
  $('#new-client')?.addEventListener('click', () => openClientModal());

  const applyFilters = () => {
    filters = {
      search: $('#f-search').value.trim().toLowerCase(),
      status: $('#f-status').value,
      manager: $('#f-manager').value
    };
    paint();
  };
  $('#f-search').addEventListener('input', debounce(applyFilters, 220));
  ['#f-status', '#f-manager'].forEach((s) => $(s).addEventListener('change', applyFilters));

  unsubs.push(onSnapshot(
    query(col('clients'), orderBy('name'), limit(300)),
    (snap) => { clients = snap.docs.map((d) => ({ id: d.id, ...d.data() })); paint(); },
    (err) => mount($('#client-list'), emptyState({
      icon: 'shield-alert', title: 'لا تملك صلاحية عرض العملاء', text: err.message
    }))
  ));

  function paint() {
    const rows = clients.filter((c) => {
      if (filters.search && !`${c.name} ${c.contactPerson || ''}`.toLowerCase().includes(filters.search)) return false;
      if (filters.status !== 'all' && (c.status || 'active') !== filters.status) return false;
      if (filters.manager !== 'all' && c.accountManagerId !== filters.manager) return false;
      return true;
    });

    $('#client-count').textContent = `${rows.length} عميل من أصل ${clients.length}`;

    const host = $('#client-list');
    if (!rows.length) {
      mount(host, emptyState({
        icon: 'briefcase',
        title: 'لا يوجد عملاء',
        text: 'ابدأ بإضافة أول عميل للوكالة.',
        action: can(session.claims, 'clients.create')
          ? '<button class="btn btn--primary" onclick="document.getElementById(\'new-client\').click()">إضافة عميل</button>' : ''
      }));
      return;
    }

    const STATUS = {
      active: ['نشط', 'success'], paused: ['متوقف مؤقتاً', 'warning'], ended: ['منتهي', '']
    };

    host.innerHTML = `<div class="grid grid-auto">${rows.map((c) => {
      const [label, tone] = STATUS[c.status || 'active'] || STATUS.active;
      const manager = people[c.accountManagerId];
      return `
        <a class="card" href="#/clients/${attr(c.id)}" style="text-decoration:none;color:inherit">
          <div class="flex gap-3 items-start">
            ${c.logoURL
              ? `<img src="${attr(c.logoURL)}" alt="${attr(c.name)}"
                   style="width:52px;height:52px;border-radius:var(--radius-md);object-fit:cover;flex:none">`
              : `<span class="stat__icon stat__icon--brand" style="width:52px;height:52px">
                   <i data-lucide="briefcase"></i></span>`}
            <div class="flex-1" style="min-width:0">
              <div class="fw-700 truncate">${esc(c.name)}</div>
              <div class="fs-xs text-muted truncate">${esc(c.contactPerson || 'بدون مسؤول تواصل')}</div>
              <span class="badge badge--${attr(tone)} mt-2">${esc(label)}</span>
            </div>
          </div>

          <div class="tag-list mt-3">
            ${(c.services || []).slice(0, 3).map((s) => `<span class="badge">${esc(SERVICES[s] || s)}</span>`).join('')}
            ${(c.services || []).length > 3 ? `<span class="badge">+${(c.services || []).length - 3}</span>` : ''}
          </div>

          <div class="list-divider"></div>
          <div class="flex justify-between items-center fs-xs text-muted">
            <span class="flex items-center gap-2">
              ${manager ? avatarHTML(manager, 'xs') : ''}
              ${esc(manager?.displayName || 'بدون مدير حساب')}
            </span>
            <span>${c.contractEnd ? `ينتهي ${esc(formatDate(c.contractEnd, { short: true }))}` : ''}</span>
          </div>
        </a>`;
    }).join('')}</div>`;
    refreshIcons(host);
  }

  return () => unsubs.forEach((fn) => { try { fn(); } catch {} });
}

/* ========================================================================== */
/* Create / edit                                                              */
/* ========================================================================== */

export async function openClientModal(client = null) {
  const isEdit = !!client;
  if (!can(session.claims, isEdit ? 'clients.edit' : 'clients.create')) {
    toastError('لا تملك صلاحية تنفيذ هذا الإجراء.');
    return;
  }

  const directory = await getDirectory().catch(() => []);
  const selectedServices = new Set(client?.services || []);
  let logoFile = null;

  openModal({
    title: isEdit ? `تعديل ${client.name}` : 'إضافة عميل جديد',
    size: 'lg',
    bodyHTML: `
      <div class="form-grid">
        <div class="field field--full">
          <label class="field__label" for="c-name">اسم العميل / الشركة <span class="req">*</span></label>
          <input class="input" id="c-name" maxlength="140" required value="${attr(client?.name || '')}">
        </div>

        <div class="field">
          <label class="field__label" for="c-contact">مسؤول التواصل</label>
          <input class="input" id="c-contact" maxlength="120" value="${attr(client?.contactPerson || '')}">
        </div>
        <div class="field">
          <label class="field__label" for="c-phone">رقم الهاتف</label>
          <input class="input ltr" id="c-phone" type="tel" value="${attr(client?.phone || '')}">
        </div>
        <div class="field">
          <label class="field__label" for="c-email">البريد الإلكتروني</label>
          <input class="input ltr" id="c-email" type="email" value="${attr(client?.email || '')}">
        </div>
        <div class="field">
          <label class="field__label" for="c-website">الموقع الإلكتروني</label>
          <input class="input ltr" id="c-website" type="url" placeholder="https://example.com"
                 value="${attr(client?.website || '')}">
        </div>
        <div class="field field--full">
          <label class="field__label" for="c-address">العنوان</label>
          <input class="input" id="c-address" maxlength="200" value="${attr(client?.address || '')}">
        </div>

        <div class="field">
          <label class="field__label" for="c-manager">مدير الحساب</label>
          <select class="select" id="c-manager">
            <option value="">— غير محدد —</option>
            ${directory.map((u) => `<option value="${attr(u.id)}" ${
              client?.accountManagerId === u.id ? 'selected' : ''}>${esc(u.displayName)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label class="field__label" for="c-status">حالة الحساب</label>
          <select class="select" id="c-status">
            <option value="active" ${(client?.status || 'active') === 'active' ? 'selected' : ''}>نشط</option>
            <option value="paused" ${client?.status === 'paused' ? 'selected' : ''}>متوقف مؤقتاً</option>
            <option value="ended" ${client?.status === 'ended' ? 'selected' : ''}>منتهي</option>
          </select>
        </div>

        <div class="field">
          <label class="field__label" for="c-start">بداية العقد</label>
          <input class="input" id="c-start" type="date" value="${attr(client?.contractStart || '')}">
        </div>
        <div class="field">
          <label class="field__label" for="c-end">نهاية العقد</label>
          <input class="input" id="c-end" type="date" value="${attr(client?.contractEnd || '')}">
        </div>

        <div class="field field--full">
          <label class="field__label">الخدمات المقدَّمة</label>
          <div class="chip-select" id="c-services">
            ${Object.entries(SERVICES).map(([k, v]) => `
              <button type="button" class="chip-toggle${selectedServices.has(k) ? ' is-on' : ''}"
                      data-service="${attr(k)}">${esc(v)}</button>`).join('')}
          </div>
        </div>

        ${uploadsEnabled() ? `
        <div class="field field--full">
          <label class="field__label">شعار العميل</label>
          <div class="dropzone" id="c-logo-zone">
            <i data-lucide="image-plus"></i>
            <div class="mt-2" id="c-logo-label">اسحب الصورة هنا أو اضغط للاختيار (حتى 3 ميجابايت)</div>
          </div>
        </div>` : ''}

        <div class="field field--full">
          <label class="field__label" for="c-notes">ملاحظات</label>
          <textarea class="textarea" id="c-notes" maxlength="3000">${esc(client?.notes || '')}</textarea>
        </div>
      </div>

      <div class="security-note">
        <i data-lucide="shield-alert"></i>
        <div>
          لا تُدخل كلمات مرور العميل هنا. تُضاف بيانات الدخول من تبويب
          «خزنة بيانات الدخول» داخل ملف العميل حيث تُشفَّر على الخادم.
        </div>
      </div>`,
    footerHTML: `
      <button class="btn btn--ghost" data-modal-close>إلغاء</button>
      <button class="btn btn--primary" id="c-save">
        <i data-lucide="check"></i> ${isEdit ? 'حفظ التعديلات' : 'إضافة العميل'}
      </button>`,
    onMount: (api) => {
      refreshIcons(api.root);

      $$('[data-service]', api.root).forEach((chip) => chip.addEventListener('click', () => {
        const key = chip.dataset.service;
        if (selectedServices.has(key)) { selectedServices.delete(key); chip.classList.remove('is-on'); }
        else { selectedServices.add(key); chip.classList.add('is-on'); }
      }));

      // The logo dropzone is only rendered while uploads are enabled.
      const zone = api.$('#c-logo-zone');
      if (zone) {
        const pick = async () => {
          const [file] = await pickFiles({ accept: 'image/png,image/jpeg,image/webp,image/svg+xml' });
          if (!file) return;
          logoFile = file;
          api.$('#c-logo-label').textContent = `تم اختيار: ${file.name}`;
        };
        zone.addEventListener('click', pick);
        zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('is-over'); });
        zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
        zone.addEventListener('drop', (e) => {
          e.preventDefault();
          zone.classList.remove('is-over');
          const file = e.dataTransfer.files?.[0];
          if (file?.type.startsWith('image/')) {
            logoFile = file;
            api.$('#c-logo-label').textContent = `تم اختيار: ${file.name}`;
          }
        });
      }

      api.$('#c-save').addEventListener('click', async () => {
        const name = sanitizeText(api.$('#c-name').value, 140);
        if (!name) return toastError('اسم العميل مطلوب.');

        const email = api.$('#c-email').value.trim();
        const phone = api.$('#c-phone').value.trim();
        if (email && !isValidEmail(email)) return toastError('البريد الإلكتروني غير صالح.');
        if (phone && !isValidPhone(phone)) return toastError('رقم الهاتف غير صالح.');

        const payload = {
          name,
          nameLower: name.toLowerCase(),
          contactPerson: sanitizeText(api.$('#c-contact').value, 120),
          phone,
          email,
          website: safeUrl(api.$('#c-website').value),
          address: sanitizeText(api.$('#c-address').value, 200),
          accountManagerId: api.$('#c-manager').value || null,
          status: api.$('#c-status').value,
          contractStart: api.$('#c-start').value || null,
          contractEnd: api.$('#c-end').value || null,
          services: [...selectedServices],
          notes: sanitizeMultiline(api.$('#c-notes').value, 3000),
          updatedAt: ts()
        };

        const button = api.$('#c-save');
        setBusy(button, true);
        try {
          let clientId = client?.id;
          if (isEdit) {
            await updateDoc(ref('clients', clientId), payload);
          } else {
            const created = await addDoc(col('clients'), {
              ...payload, createdBy: session.uid, createdAt: ts(), logoURL: null
            });
            clientId = created.id;
          }

          if (logoFile) {
            const compressed = await compressImage(logoFile, { maxSize: 512 });
            const uploaded = await uploadFile(compressed, paths.client(clientId, compressed), {
              maxMB: 3, kinds: ['image']
            });
            await updateDoc(ref('clients', clientId), { logoURL: uploaded.url, updatedAt: ts() });
          }

          toastSuccess(isEdit ? 'تم حفظ بيانات العميل.' : 'تمت إضافة العميل بنجاح.');
          api.close();
          if (!isEdit) location.hash = `#/clients/${clientId}`;
        } catch (err) {
          reportError(err, 'save-client');
        } finally {
          setBusy(button, false);
        }
      });
    }
  });
}
