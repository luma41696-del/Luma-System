/**
 * Arabic RTL document export.
 *
 * Why it is done this way: embedding a TTF into jsPDF and calling `doc.text()`
 * with Arabic produces disconnected, reversed letters, because jsPDF does no
 * bidi reordering and no Arabic contextual shaping. So instead we let the
 * *browser* lay the document out — it shapes and orders Arabic correctly — and
 * then rasterise that layout into the PDF page.
 *
 *   downloadPdf()  → html2canvas + jsPDF, real .pdf file, perfect Arabic.
 *   printSheet()   → native print dialog ("Save as PDF"), vector text output.
 *
 * Both consume the same `.doc-sheet` markup defined in css/print.css.
 */

import { esc } from './dom.js';
import { formatDate, formatDateTime, formatDuration } from './format.js';
import { toastError, toastInfo } from './toast.js';

const A4 = { width: 794, height: 1123 }; // px @96dpi

/* ------------------------------------------------------------ templates */

const REQUEST_TYPES = {
  leave:     { ar: 'طلب إجازة',            icon: 'calendar' },
  departure: { ar: 'طلب مغادرة / خروج مبكر', icon: 'log-out' },
  advance:   { ar: 'طلب سلفة على الراتب',   icon: 'wallet' },
  sick:      { ar: 'طلب إجازة مرضية',       icon: 'stethoscope' }
};

const STATUS_META = {
  draft:     { ar: 'مسودة',            cls: 'neutral' },
  submitted: { ar: 'مقدَّم',            cls: 'pending' },
  review:    { ar: 'قيد المراجعة',     cls: 'pending' },
  approved:  { ar: 'موافق عليه',       cls: 'approved' },
  rejected:  { ar: 'مرفوض',            cls: 'rejected' },
  cancelled: { ar: 'ملغى',             cls: 'neutral' }
};

function row(key, value, ltr = false) {
  return `<div class="doc-row">
    <span class="doc-row__k">${esc(key)}</span>
    <span class="doc-row__v${ltr ? ' ltr' : ''}">${esc(value ?? '—')}</span>
  </div>`;
}

function sheetHeader(docTitle, subtitle, number) {
  return `
    <div class="doc-sheet__header">
      <div class="doc-sheet__brand">
        <img src="assets/logo/luma-mark-dark.png" alt="Luma Agency"
             style="width:34px;height:95px;object-fit:contain">
        <div>
          <div class="doc-sheet__brand-name">LUMA</div>
          <div class="doc-sheet__brand-word">AGENCY</div>
          <div class="doc-sheet__brand-sub">وكالة لوما</div>
        </div>
      </div>
      <div class="doc-sheet__meta">
        ${number ? `<div class="doc-sheet__no">${esc(number)}</div>` : ''}
        <div>${esc(formatDate(new Date()))}</div>
      </div>
    </div>
    <div class="doc-sheet__title">${esc(docTitle)}</div>
    ${subtitle ? `<div class="doc-sheet__subtitle">${esc(subtitle)}</div>` : ''}`;
}

function sheetFooter(note = '') {
  return `<div class="doc-sheet__footer">
    <span>${esc(note || 'مستند صادر عن نظام إدارة وكالة لوما')}</span>
    <span>${esc(formatDateTime(new Date()))}</span>
  </div>`;
}

/**
 * Build the printable HTML for an administrative request.
 * @param {object} request  Firestore request document (+ id)
 * @param {object} employee employee profile
 * @param {object} manager  approver profile (optional)
 */
export function buildRequestSheet(request, employee = {}, manager = {}) {
  const type = REQUEST_TYPES[request.type] || { ar: 'طلب إداري' };
  const status = STATUS_META[request.status] || STATUS_META.draft;

  const periodRows = [];
  if (request.fromDate) periodRows.push(row('من تاريخ', formatDate(request.fromDate)));
  if (request.toDate) periodRows.push(row('إلى تاريخ', formatDate(request.toDate)));
  if (request.days) periodRows.push(row('عدد الأيام', `${request.days}`));
  if (request.fromTime) periodRows.push(row('من الساعة', request.fromTime, true));
  if (request.toTime) periodRows.push(row('إلى الساعة', request.toTime, true));
  if (request.amount) periodRows.push(row('المبلغ المطلوب', `${request.amount} د.أ`));
  if (request.installments) periodRows.push(row('عدد الأقساط', `${request.installments}`));

  return `
    <div class="doc-sheet">
      ${sheetHeader(type.ar, 'نموذج طلب إداري داخلي', request.requestNo || request.id?.slice(0, 8))}

      <div class="doc-section">
        <div class="doc-section__title">بيانات الموظف</div>
        <div class="doc-grid">
          ${row('الاسم', employee.displayName)}
          ${row('اسم المستخدم', employee.username, true)}
          ${row('المسمى الوظيفي', (employee.rolesLabel || '—'))}
          ${row('القسم', employee.departmentLabel || employee.department)}
          ${row('رقم الهاتف', employee.phone, true)}
          ${row('البريد الإلكتروني', employee.personalEmail, true)}
        </div>
      </div>

      <div class="doc-section">
        <div class="doc-section__title">تفاصيل الطلب</div>
        <div class="doc-grid">
          ${row('نوع الطلب', type.ar)}
          ${row('تاريخ التقديم', formatDate(request.createdAt))}
          ${periodRows.join('')}
        </div>
      </div>

      <div class="doc-section">
        <div class="doc-section__title">سبب الطلب</div>
        <div class="doc-box">${esc(request.reason || 'لا يوجد')}</div>
      </div>

      <div class="doc-section">
        <div class="doc-section__title">قرار الإدارة</div>
        <div class="doc-grid" style="margin-bottom:12px">
          ${row('الحالة', status.ar)}
          ${row('تاريخ القرار', request.decidedAt ? formatDate(request.decidedAt) : '—')}
          ${row('صاحب القرار', manager.displayName || '—')}
        </div>
        <span class="doc-status doc-status--${status.cls}">${esc(status.ar)}</span>
        ${request.managerResponse
          ? `<div class="doc-box" style="margin-top:12px">${esc(request.managerResponse)}</div>`
          : ''}
      </div>

      <div class="doc-signatures">
        <div class="doc-sign">
          <div class="doc-sign__line"></div>
          <div class="doc-sign__label">توقيع الموظف</div>
        </div>
        <div class="doc-sign">
          <div class="doc-sign__line"></div>
          <div class="doc-sign__label">توقيع الإدارة</div>
        </div>
      </div>

      ${sheetFooter()}
    </div>`;
}

/** Printable employee / team report. `sections` = [{title, rows:[[k,v],…]}] */
export function buildReportSheet({ title, subtitle, periodLabel, employee = {}, sections = [], tables = [] }) {
  return `
    <div class="doc-sheet">
      ${sheetHeader(title, subtitle, '')}
      <div class="doc-section">
        <div class="doc-grid">
          ${employee.displayName ? row('الموظف', employee.displayName) : ''}
          ${employee.rolesLabel ? row('المسمى الوظيفي', employee.rolesLabel) : ''}
          ${row('الفترة', periodLabel)}
          ${row('تاريخ الإصدار', formatDate(new Date()))}
        </div>
      </div>
      ${sections.map((section) => `
        <div class="doc-section">
          <div class="doc-section__title">${esc(section.title)}</div>
          <div class="doc-grid">
            ${section.rows.map(([k, v]) => row(k, v)).join('')}
          </div>
        </div>`).join('')}
      ${tables.map((table) => `
        <div class="doc-section">
          <div class="doc-section__title">${esc(table.title)}</div>
          <table class="doc-table">
            <thead><tr>${table.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
            <tbody>${table.rows.map((r) =>
              `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>
          </table>
        </div>`).join('')}
      ${sheetFooter('تقرير آلي — البيانات مستخرجة من قاعدة بيانات النظام')}
    </div>`;
}

/* ---------------------------------------------------------- rendering */

function stage(html) {
  const host = document.createElement('div');
  host.className = 'pdf-stage print-root';
  host.innerHTML = html;
  document.body.append(host);
  return host;
}

async function ensureLibs() {
  const missing = [];
  if (!window.html2canvas) missing.push('html2canvas');
  if (!window.jspdf?.jsPDF) missing.push('jsPDF');
  if (missing.length) throw new Error(`مكتبة ${missing.join(' و ')} غير محمّلة.`);
}

/**
 * Rasterise a `.doc-sheet` into a multi-page A4 PDF and download it.
 * @param {string} html     markup from one of the build*Sheet helpers
 * @param {string} fileName without extension
 */
export async function downloadPdf(html, fileName = 'luma-document') {
  const host = stage(html);
  try {
    await ensureLibs();
    await document.fonts?.ready;

    const sheet = host.querySelector('.doc-sheet');
    const canvas = await window.html2canvas(sheet, {
      scale: 2,
      backgroundColor: '#ffffff',
      useCORS: true,
      logging: false,
      windowWidth: A4.width
    });

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: 'portrait', unit: 'pt', format: 'a4' });
    const pageW = pdf.internal.pageSize.getWidth();
    const pageH = pdf.internal.pageSize.getHeight();
    const imgH = (canvas.height * pageW) / canvas.width;

    let remaining = imgH;
    let position = 0;
    const image = canvas.toDataURL('image/jpeg', 0.94);

    pdf.addImage(image, 'JPEG', 0, 0, pageW, imgH, undefined, 'FAST');
    remaining -= pageH;
    while (remaining > 0) {
      position -= pageH;
      pdf.addPage();
      pdf.addImage(image, 'JPEG', 0, position, pageW, imgH, undefined, 'FAST');
      remaining -= pageH;
    }

    pdf.setProperties({ title: fileName, creator: 'Luma Agency Management System' });
    pdf.save(`${fileName}.pdf`);
    return true;
  } catch (err) {
    console.error('[luma] PDF export failed', err);
    toastError('تعذّر إنشاء ملف PDF. سيتم فتح نافذة الطباعة بدلاً من ذلك.');
    printSheet(html);
    return false;
  } finally {
    host.remove();
  }
}

/**
 * Native print path. Produces selectable (vector) Arabic text — the highest
 * quality output — at the cost of going through the browser's print dialog.
 */
export function printSheet(html) {
  const host = stage(html);
  host.classList.remove('pdf-stage');
  document.body.classList.add('is-printing');
  toastInfo('اختر "حفظ كملف PDF" من نافذة الطباعة.');

  const cleanup = () => {
    document.body.classList.remove('is-printing');
    host.remove();
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);

  setTimeout(() => {
    window.print();
    setTimeout(cleanup, 1500);
  }, 220);
}

/* ------------------------------------------------------------- CSV --- */

/**
 * Export rows to CSV. A UTF-8 BOM is prepended so Excel on Windows opens the
 * Arabic text correctly instead of showing mojibake.
 */
export function downloadCsv(rows, fileName = 'luma-export', headers = null) {
  if (!rows?.length) { toastError('لا توجد بيانات للتصدير.'); return; }

  const cols = headers || Object.keys(rows[0]);
  const cell = (value) => {
    const str = value === null || value === undefined ? '' : String(value);
    return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };

  const csv = [
    cols.map(cell).join(','),
    ...rows.map((r) => cols.map((c) => cell(Array.isArray(r) ? r[cols.indexOf(c)] : r[c])).join(','))
  ].join('\r\n');

  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = Object.assign(document.createElement('a'), {
    href: url, download: `${fileName}.csv`
  });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export { REQUEST_TYPES, STATUS_META, formatDuration };
