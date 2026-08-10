/**
 * AI Accountant — the chat panel inside the finance section.
 *
 * The browser never talks to OpenAI. It calls `askAccountant`, which holds the
 * key, checks permissions, runs the read-only tools and returns the answer
 * together with the structured payload behind it.
 *
 * Figures on screen are rendered from that payload, not parsed out of the
 * model's prose — so what the accountant reads is what the database computed.
 */

import { session } from './auth.js';
import { can } from './permissions.js';
import { $, $$, esc, attr, refreshIcons, on } from './utils/dom.js';
import { callFn } from './utils/api.js';
import { formatMoney } from './utils/format.js';
import { getLang } from './utils/i18n.js';

const STORE_KEY = 'luma.aiConversation';
const MAX_TURNS = 20;

let panel = null;
let messages = [];   // [{ role, content, data }]
let busy = false;

const SUGGESTIONS = [
  'ملخص مالي لهذا الشهر',
  'الفواتير المتأخرة',
  'المبالغ المستحقة',
  'مصاريف هذا الشهر',
  'أعلى العملاء إيراداً',
  'قارن مع الشهر الماضي'
];

/** Mount the launcher. Called by the finance page; no-op without permission. */
export function mountAssistant(host) {
  if (!can(session.claims, 'finance.ai')) return () => {};
  if (document.getElementById('ai-launcher')) return () => {};

  const launcher = document.createElement('button');
  launcher.id = 'ai-launcher';
  launcher.className = 'ai-launcher';
  launcher.innerHTML = `<i data-lucide="sparkles"></i><span>AI Accountant</span>`;
  launcher.setAttribute('aria-label', 'المساعد المالي الذكي');
  document.body.append(launcher);
  refreshIcons(launcher);

  launcher.addEventListener('click', togglePanel);
  restore();

  return () => {
    launcher.remove();
    panel?.remove();
    panel = null;
  };
}

/* ------------------------------------------------------------- storage */

function restore() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORE_KEY) || '[]');
    if (Array.isArray(saved)) messages = saved.slice(-MAX_TURNS);
  } catch { messages = []; }
}

function persist() {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(messages.slice(-MAX_TURNS)));
  } catch { /* private mode */ }
}

/* --------------------------------------------------------------- panel */

function togglePanel() {
  if (panel) { closePanel(); return; }
  openPanel();
}

function closePanel() {
  panel?.classList.remove('is-open');
  const node = panel;
  panel = null;
  setTimeout(() => node?.remove(), 200);
  document.getElementById('ai-launcher')?.classList.remove('is-active');
}

function openPanel() {
  panel = document.createElement('aside');
  panel.className = 'ai-panel';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', 'المساعد المالي الذكي');
  panel.innerHTML = `
    <header class="ai-panel__head">
      <div class="ai-panel__title">
        <span class="ai-panel__avatar"><i data-lucide="sparkles"></i></span>
        <div>
          <div class="fw-700">AI Accountant</div>
          <div class="fs-2xs text-muted">Powered by OpenAI</div>
        </div>
      </div>
      <div class="ai-panel__tools">
        <button class="icon-btn" id="ai-new" title="محادثة جديدة" aria-label="محادثة جديدة">
          <i data-lucide="plus"></i></button>
        <button class="icon-btn" id="ai-close" title="إغلاق" aria-label="إغلاق">
          <i data-lucide="x"></i></button>
      </div>
    </header>

    <div class="ai-panel__body" id="ai-body"></div>

    <form class="ai-panel__foot" id="ai-form">
      <textarea class="input" id="ai-input" rows="1" maxlength="1000"
        placeholder="اسأل عن البيانات المالية..." aria-label="سؤالك"></textarea>
      <button class="btn btn--primary btn--icon" type="submit" id="ai-send" aria-label="إرسال">
        <i data-lucide="send"></i>
      </button>
    </form>`;

  document.body.append(panel);
  refreshIcons(panel);
  requestAnimationFrame(() => panel.classList.add('is-open'));
  document.getElementById('ai-launcher')?.classList.add('is-active');

  $('#ai-close', panel).addEventListener('click', closePanel);
  $('#ai-new', panel).addEventListener('click', () => {
    messages = [];
    persist();
    paint();
  });

  const input = $('#ai-input', panel);
  const form = $('#ai-form', panel);

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    send(input.value);
  });

  // Enter sends, Shift+Enter breaks the line — the messaging convention.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input.value); }
  });
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  });

  on(panel, 'click', '[data-suggest]', (e, node) => send(node.dataset.suggest));

  paint();
  setTimeout(() => input.focus(), 220);
}

/* -------------------------------------------------------------- render */

function paint() {
  const body = $('#ai-body', panel);
  if (!body) return;

  if (!messages.length) {
    body.innerHTML = `
      <div class="ai-empty">
        <span class="ai-empty__icon"><i data-lucide="sparkles"></i></span>
        <div class="fw-700">اسألني عن أرقامك المالية</div>
        <p class="fs-sm text-muted">
          أقرأ الفواتير والعقود والمصاريف من النظام وأحسبها فعلياً — لا أخمّن الأرقام.
        </p>
        <div class="ai-suggest">
          ${SUGGESTIONS.map((s) => `<button class="ai-chip" data-suggest="${attr(s)}">${esc(s)}</button>`).join('')}
        </div>
      </div>`;
    refreshIcons(body);
    return;
  }

  body.innerHTML = messages.map(renderMessage).join('') + (busy ? thinking() : '');
  refreshIcons(body);
  body.scrollTop = body.scrollHeight;
}

function renderMessage(message) {
  if (message.role === 'user') {
    return `<div class="ai-msg ai-msg--user"><div class="ai-bubble">${esc(message.content)}</div></div>`;
  }
  return `
    <div class="ai-msg ai-msg--bot">
      <span class="ai-msg__avatar"><i data-lucide="sparkles"></i></span>
      <div class="ai-bubble">
        ${message.error ? `<div class="ai-error"><i data-lucide="alert-triangle"></i> ${esc(message.content)}</div>`
          : renderCards(message.data) + `<div class="ai-text">${formatText(message.content)}</div>`}
      </div>
    </div>`;
}

function thinking() {
  return `
    <div class="ai-msg ai-msg--bot">
      <span class="ai-msg__avatar"><i data-lucide="sparkles"></i></span>
      <div class="ai-bubble"><div class="ai-typing"><span></span><span></span><span></span></div></div>
    </div>`;
}

/**
 * Turn a tool payload into cards and a table.
 *
 * Only known numeric keys become cards, so an unexpected shape degrades to the
 * written answer rather than rendering nonsense.
 */
const CARD_LABELS = {
  totalBilled: 'إجمالي الفواتير', totalCollected: 'المحصّل', outstanding: 'المستحق',
  totalExpenses: 'المصاريف', netProfit: 'صافي الربح', overdueCount: 'فواتير متأخرة',
  overdueAmount: 'قيمة المتأخرات', totalOutstanding: 'إجمالي المستحق',
  totalOverdue: 'إجمالي المتأخر', billed: 'المفوتر', collected: 'المحصّل',
  totalPaid: 'المدفوع', balance: 'المتبقي', revenue: 'الإيراد',
  directCosts: 'التكاليف', profit: 'الربح', margin: 'هامش الربح',
  received: 'المستلم', spent: 'المصروف', remaining: 'المتبقي',
  total: 'الإجمالي', count: 'العدد', invoiceCount: 'عدد الفواتير'
};
const COUNT_KEYS = new Set(['overdueCount', 'count', 'invoiceCount']);

function renderCards(data) {
  if (!data || typeof data !== 'object') return '';

  if (data.hasData === false) {
    return `<div class="ai-note"><i data-lucide="info"></i> لا توجد بيانات كافية لهذه الفترة في النظام.</div>`;
  }

  const cards = Object.entries(CARD_LABELS)
    .filter(([key]) => typeof data[key] === 'number' || typeof data[key] === 'string')
    .filter(([key]) => data[key] !== null && data[key] !== undefined)
    .slice(0, 6)
    .map(([key, label]) => {
      const raw = data[key];
      const value = COUNT_KEYS.has(key) || typeof raw === 'string'
        ? String(raw)
        : formatMoney(raw, data.currency || 'JOD');
      return `
        <div class="ai-card">
          <div class="ai-card__label">${esc(label)}</div>
          <div class="ai-card__value num">${esc(value)}</div>
        </div>`;
    });

  const comparison = data.direction ? `
    <div class="ai-delta ai-delta--${attr(data.direction)}">
      <i data-lucide="${data.direction === 'up' ? 'trending-up' : data.direction === 'down' ? 'trending-down' : 'minus'}"></i>
      ${esc(data.changePercent || '')} مقارنة بـ ${esc(data.previous?.period || '')}
    </div>` : '';

  const rows = data.invoices || data.payments || data.contracts || data.clients;
  const table = Array.isArray(rows) && rows.length ? renderTable(rows, data.currency || 'JOD') : '';

  if (!cards.length && !table && !comparison) return '';
  return `${cards.length ? `<div class="ai-cards">${cards.join('')}</div>` : ''}${comparison}${table}`;
}

const COLUMN_LABELS = {
  invoiceNo: 'الفاتورة', receiptNo: 'السند', contractNo: 'العقد', client: 'العميل',
  total: 'الإجمالي', paid: 'المدفوع', balance: 'المتبقي', amount: 'المبلغ',
  dueDate: 'الاستحقاق', issueDate: 'الإصدار', paidAt: 'التاريخ', status: 'الحالة',
  daysLate: 'أيام التأخير', method: 'الطريقة', value: 'القيمة', title: 'الباقة',
  billed: 'المفوتر', collected: 'المحصّل', invoices: 'عدد الفواتير',
  startDate: 'البداية', endDate: 'النهاية', billingCycle: 'الدورة'
};
const MONEY_COLUMNS = new Set(['total', 'paid', 'balance', 'amount', 'value', 'billed', 'collected']);

function renderTable(rows, currency) {
  const columns = Object.keys(rows[0]).filter((k) => COLUMN_LABELS[k]).slice(0, 5);
  if (!columns.length) return '';
  return `
    <div class="ai-table-wrap">
      <table class="ai-table">
        <thead><tr>${columns.map((c) => `<th>${esc(COLUMN_LABELS[c])}</th>`).join('')}</tr></thead>
        <tbody>${rows.slice(0, 8).map((row) => `
          <tr>${columns.map((c) => {
            const raw = row[c];
            const value = MONEY_COLUMNS.has(c) && typeof raw === 'number'
              ? formatMoney(raw, currency) : String(raw ?? '—');
            return `<td class="${MONEY_COLUMNS.has(c) ? 'num' : ''}">${esc(value)}</td>`;
          }).join('')}</tr>`).join('')}
        </tbody>
      </table>
      ${rows.length > 8 ? `<div class="fs-2xs text-muted mt-2">تُعرض 8 من ${rows.length}</div>` : ''}
    </div>`;
}

/** Minimal formatting: paragraphs, bullets and **bold**. No HTML from the model. */
function formatText(text) {
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return '';
      if (/^[-•*]\s+/.test(trimmed)) return `<div class="ai-bullet">${trimmed.replace(/^[-•*]\s+/, '')}</div>`;
      return `<p>${trimmed}</p>`;
    })
    .join('');
}

/* ---------------------------------------------------------------- send */

async function send(raw) {
  const question = String(raw || '').trim();
  if (!question || busy) return;

  const input = $('#ai-input', panel);
  if (input) { input.value = ''; input.style.height = 'auto'; }

  messages.push({ role: 'user', content: question });
  busy = true;
  paint();

  try {
    // Only prior turns are sent as context — the current question is separate,
    // which is what lets a follow-up like "ومتى أقرب فاتورة؟" resolve.
    const history = messages
      .slice(0, -1)
      .slice(-8)
      .map((m) => ({ role: m.role, content: m.content }));

    const result = await callFn('askAccountant', { question, history });
    messages.push({ role: 'assistant', content: result.text, data: result.data || null });
  } catch (err) {
    messages.push({
      role: 'assistant',
      content: err?.message || 'تعذّر الوصول إلى المساعد الذكي. تحقق من الاتصال وحاول مجدداً.',
      error: true
    });
  } finally {
    busy = false;
    messages = messages.slice(-MAX_TURNS);
    persist();
    paint();
  }
}
