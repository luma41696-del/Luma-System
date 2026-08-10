/**
 * Monthly payroll sheets.
 *
 * A run moves through draft → approved → paid, and each step is a different
 * decision with a different permission behind it. Only a draft is editable;
 * once approved the figures are fixed, and paying it posts a single withdrawal
 * against a treasury account so the cash movement is part of the same ledger as
 * everything else.
 *
 * Amounts here are piastres, like the rest of finance. The conversion from the
 * dinar-denominated salary records happens server-side, once.
 */

import { session } from './auth.js';
import { can } from './permissions.js';
import {
  $, $$, esc, attr, refreshIcons, render as mount, emptyState, setBusy, on
} from './utils/dom.js';
import { toastSuccess, toastError, reportError } from './utils/toast.js';
import { openModal, confirmDialog } from './utils/modal.js';
import { col, ref, query, orderBy, limit, onSnapshot, getMany, callFn } from './utils/api.js';
import { formatMinor, toMinor, toDateInput } from './utils/format.js';

const RUN_STATUS = {
  draft:    { ar: 'مسودة',  badge: 'warning' },
  approved: { ar: 'معتمد',  badge: 'info' },
  paid:     { ar: 'مدفوع',  badge: 'success' }
};

export function paintPayroll(host, unsubs) {
  const canManage = can(session.claims, 'finance.payroll');
  const canApprove = can(session.claims, 'finance.approve');
  let openRunId = null;

  host.innerHTML = `
    <div class="security-note mt-4">
      <i data-lucide="shield"></i>
      <div>
        كشوف الرواتب تحتوي رواتب جميع الموظفين، ولذلك تقع خلف صلاحية مستقلة
        لا يمنحها دور «محاسب» تلقائياً إلا بقرار صريح.
      </div>
    </div>
    ${canManage ? `
      <div class="flex gap-2 mt-4" style="flex-wrap:wrap">
        <button class="btn btn--primary" id="pr-new"><i data-lucide="plus"></i> كشف رواتب جديد</button>
      </div>` : ''}
    <div id="pr-list" class="mt-4">${'<div class="skeleton skeleton--row"></div>'.repeat(3)}</div>
    <div id="pr-detail"></div>`;
  refreshIcons(host);

  $('#pr-new')?.addEventListener('click', () => openCreateModal());

  let runs = [];
  unsubs.push(onSnapshot(
    query(col('payrollRuns'), orderBy('period', 'desc'), limit(60)),
    (snap) => {
      runs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      paintRuns();
      if (openRunId) paintDetail(openRunId);
    },
    (err) => mount($('#pr-list'), emptyState({
      icon: 'shield-alert', title: 'تعذّر تحميل كشوف الرواتب', text: err.message
    }))
  ));

  function paintRuns() {
    const node = $('#pr-list');
    if (!node) return;
    if (!runs.length) {
      mount(node, emptyState({
        icon: 'users', title: 'لا توجد كشوف رواتب',
        text: 'أنشئ كشفاً لشهر ليُبنى تلقائياً من رواتب الموظفين المسجّلة.'
      }));
      return;
    }

    node.innerHTML = `
      <div class="table-wrap"><table class="table">
        <thead><tr>
          <th>الكشف</th><th>الشهر</th><th>الموظفون</th><th>الإجمالي</th>
          <th>الخصومات</th><th>الصافي</th><th>الحالة</th>
        </tr></thead>
        <tbody>${runs.map((r) => `
          <tr data-run="${attr(r.id)}" style="cursor:pointer" class="${openRunId === r.id ? 'is-active' : ''}">
            <td class="ltr is-strong">${esc(r.payrollNo || '—')}</td>
            <td class="num">${esc(r.period)}</td>
            <td class="num">${r.employeeCount || 0}</td>
            <td class="num">${esc(formatMinor(r.totalGross))}</td>
            <td class="num">${esc(formatMinor(r.totalDeductions))}</td>
            <td class="num fw-700">${esc(formatMinor(r.totalNet))}</td>
            <td><span class="badge badge--${attr(RUN_STATUS[r.status]?.badge || '')}">
              ${esc(RUN_STATUS[r.status]?.ar || r.status)}</span></td>
          </tr>`).join('')}
        </tbody>
      </table></div>`;

    on(node, 'click', '[data-run]', (e, n) => {
      openRunId = openRunId === n.dataset.run ? null : n.dataset.run;
      paintRuns();
      if (openRunId) paintDetail(openRunId); else $('#pr-detail').innerHTML = '';
    });
  }

  async function paintDetail(runId) {
    const run = runs.find((r) => r.id === runId);
    const node = $('#pr-detail');
    if (!run || !node) return;

    const lines = await getMany(query(col('payrollRuns', runId, 'lines'), limit(200))).catch(() => []);
    lines.sort((a, b) => (b.net || 0) - (a.net || 0));
    const editable = run.status === 'draft' && canManage;
    const missingSalary = lines.filter((l) => !l.hasSalaryOnFile).length;

    node.innerHTML = `
      <div class="card mt-4">
        <div class="card__head">
          <div class="card__title">
            <i data-lucide="users"></i> تفاصيل الكشف ${esc(run.payrollNo || '')} — ${esc(run.period)}
          </div>
          <div class="flex gap-2">
            ${run.status === 'draft' && canApprove
              ? '<button class="btn btn--success btn--sm" id="pr-approve"><i data-lucide="check"></i> اعتماد</button>' : ''}
            ${run.status === 'approved' && canManage
              ? '<button class="btn btn--primary btn--sm" id="pr-pay"><i data-lucide="banknote"></i> صرف الرواتب</button>' : ''}
          </div>
        </div>

        ${missingSalary ? `
          <div class="security-note mb-4" style="background:var(--warning-soft);border-color:rgba(251,191,36,.35)">
            <i data-lucide="alert-triangle" style="color:var(--warning)"></i>
            <div>${missingSalary} موظف بلا راتب مسجّل — أُدرجوا بصفر ليكون النقص ظاهراً لا مخفياً.</div>
          </div>` : ''}

        <div class="table-wrap"><table class="table">
          <thead><tr>
            <th>الموظف</th><th>الأساسي</th><th>البدلات</th><th>العمولة</th>
            <th>الإضافي</th><th>سلف</th><th>خصومات</th><th>الصافي</th>
          </tr></thead>
          <tbody>${lines.map((l) => `
            <tr>
              <td class="is-strong">${esc(l.employeeName || '—')}
                ${!l.hasSalaryOnFile ? '<span class="badge badge--warning">بلا راتب</span>' : ''}</td>
              <td class="num">${esc(formatMinor(l.baseSalary))}</td>
              <td class="num">${esc(formatMinor(l.allowances))}</td>
              <td class="num">${esc(formatMinor(l.commission))}</td>
              <td class="num">${esc(formatMinor(l.overtime))}</td>
              <td class="num" style="color:var(--danger)">${esc(formatMinor(l.advanceDeduction))}</td>
              <td class="num" style="color:var(--danger)">${esc(formatMinor(l.otherDeductions))}</td>
              <td class="num fw-700">${esc(formatMinor(l.net))}
                ${editable ? `<button class="btn btn--ghost btn--sm" data-edit-line="${attr(l.employeeId)}"
                  style="margin-inline-start:6px"><i data-lucide="pencil" class="icon-sm"></i></button>` : ''}</td>
            </tr>`).join('')}
          </tbody>
          <tfoot><tr style="border-top:2px solid var(--border-strong)">
            <td class="fw-700">الإجمالي</td>
            <td colspan="6"></td>
            <td class="num fw-700">${esc(formatMinor(run.totalNet))}</td>
          </tr></tfoot>
        </table></div>

        <div class="fs-xs text-muted mt-3">
          السلف تُستقطع بالقسط عند اعتماد الكشف، لا عند إنشائه — حتى لا تستهلك مسودةٌ
          مُلغاة قسطاً ما زال مستحقاً على الموظف.
        </div>
      </div>`;

    refreshIcons(node);

    on(node, 'click', '[data-edit-line]', (e, n) => {
      const line = lines.find((l) => l.employeeId === n.dataset.editLine);
      if (line) openLineModal(runId, line);
    });

    $('#pr-approve')?.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'اعتماد كشف الرواتب',
        message: `سيُثبَّت الكشف ولا يمكن تعديله بعدها، وتُسجَّل أقساط السلف المستقطَعة.
                  الصافي: ${formatMinor(run.totalNet)}`,
        confirmText: 'اعتماد'
      });
      if (!ok) return;
      try {
        await callFn('approvePayrollRun', { runId });
        toastSuccess('تم اعتماد الكشف.');
      } catch (err) { reportError(err, 'approve-payroll'); }
    });

    $('#pr-pay')?.addEventListener('click', () => openPayModal(runId, run));
  }
}

/* ------------------------------------------------------------- modals */

function openCreateModal() {
  const now = new Date();
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  openModal({
    title: 'كشف رواتب جديد',
    size: 'sm',
    bodyHTML: `
      <div class="field">
        <label class="field__label" for="pc-period">الشهر <span class="req">*</span></label>
        <input class="input ltr" id="pc-period" type="month" value="${period}">
        <div class="field__hint">
          يُبنى الكشف من رواتب الموظفين النشطين المسجّلة في ملفاتهم، مع اقتطاع أقساط السلف المعتمدة.
        </div>
      </div>`,
    footerHTML: `
      <button class="btn btn--ghost" data-modal-close>إلغاء</button>
      <button class="btn btn--primary" id="pc-go">إنشاء</button>`,
    onMount: (api) => {
      api.$('#pc-go').addEventListener('click', async () => {
        const value = api.$('#pc-period').value;
        if (!value) return toastError('حدد الشهر.');
        const button = api.$('#pc-go');
        setBusy(button, true);
        try {
          const result = await callFn('createPayrollRun', { period: value });
          toastSuccess(`تم إنشاء الكشف ${result.payrollNo} لـ ${result.employeeCount} موظف.`);
          api.close();
        } catch (err) { reportError(err, 'create-payroll'); }
        finally { setBusy(button, false); }
      });
    }
  });
}

function openLineModal(runId, line) {
  openModal({
    title: `تعديل — ${line.employeeName}`,
    size: 'sm',
    bodyHTML: `
      <div class="kv"><span class="kv__k">الراتب الأساسي</span>
        <span class="kv__v num">${esc(formatMinor(line.baseSalary))}</span></div>
      <div class="kv"><span class="kv__k">البدلات</span>
        <span class="kv__v num">${esc(formatMinor(line.allowances))}</span></div>
      <div class="kv"><span class="kv__k">استقطاع سلف</span>
        <span class="kv__v num">${esc(formatMinor(line.advanceDeduction))}</span></div>
      <div class="fs-xs text-muted mb-4">
        الأساسي والبدلات من ملف الموظف، والسلف محسوبة تلقائياً — تُعدَّل من مكانها لا من هنا.
      </div>
      <div class="field">
        <label class="field__label" for="pl-commission">العمولة (د.أ)</label>
        <input class="input ltr" id="pl-commission" type="number" min="0" step="0.01"
               value="${(line.commission / 100).toFixed(2)}">
      </div>
      <div class="field">
        <label class="field__label" for="pl-overtime">الإضافي (د.أ)</label>
        <input class="input ltr" id="pl-overtime" type="number" min="0" step="0.01"
               value="${(line.overtime / 100).toFixed(2)}">
      </div>
      <div class="field">
        <label class="field__label" for="pl-deduct">خصومات أخرى (د.أ)</label>
        <input class="input ltr" id="pl-deduct" type="number" min="0" step="0.01"
               value="${(line.otherDeductions / 100).toFixed(2)}">
      </div>`,
    footerHTML: `
      <button class="btn btn--ghost" data-modal-close>إلغاء</button>
      <button class="btn btn--primary" id="pl-save">حفظ</button>`,
    onMount: (api) => {
      api.$('#pl-save').addEventListener('click', async () => {
        const button = api.$('#pl-save');
        setBusy(button, true);
        try {
          await callFn('updatePayrollLine', {
            runId, employeeId: line.employeeId,
            commission: toMinor(api.$('#pl-commission').value),
            overtime: toMinor(api.$('#pl-overtime').value),
            otherDeductions: toMinor(api.$('#pl-deduct').value)
          });
          toastSuccess('تم التحديث.');
          api.close();
        } catch (err) { reportError(err, 'payroll-line'); }
        finally { setBusy(button, false); }
      });
    }
  });
}

async function openPayModal(runId, run) {
  const accounts = await getMany(query(col('accounts'), orderBy('name'), limit(50))).catch(() => []);
  if (!accounts.length) return toastError('أضف حساباً في الصندوق والبنوك أولاً.');

  openModal({
    title: 'صرف الرواتب',
    subtitle: `${run.period} — الصافي ${formatMinor(run.totalNet)}`,
    size: 'sm',
    bodyHTML: `
      <div class="field">
        <label class="field__label" for="pp-account">الصرف من حساب <span class="req">*</span></label>
        <select class="select" id="pp-account">
          ${accounts.map((a) => `<option value="${attr(a.id)}">
            ${esc(a.name)} — ${esc(formatMinor(a.balance))}</option>`).join('')}
        </select>
        <div class="field__hint">يُسجَّل سحب واحد بقيمة صافي الكشف في سجل الحركات المالية.</div>
      </div>
      <div class="field">
        <label class="field__label" for="pp-date">تاريخ الصرف <span class="req">*</span></label>
        <input class="input" id="pp-date" type="date" value="${toDateInput(new Date())}">
      </div>`,
    footerHTML: `
      <button class="btn btn--ghost" data-modal-close>إلغاء</button>
      <button class="btn btn--primary" id="pp-go">تأكيد الصرف</button>`,
    onMount: (api) => {
      api.$('#pp-go').addEventListener('click', async () => {
        const button = api.$('#pp-go');
        setBusy(button, true);
        try {
          await callFn('payPayrollRun', {
            runId, accountId: api.$('#pp-account').value, date: api.$('#pp-date').value
          });
          toastSuccess('تم صرف الرواتب وتسجيل الحركة.');
          api.close();
        } catch (err) { reportError(err, 'pay-payroll'); }
        finally { setBusy(button, false); }
      });
    }
  });
}
