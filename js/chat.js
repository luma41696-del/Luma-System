/**
 * Real-time chat: public group, department groups, direct messages and the
 * private manager channel.
 *
 * Security notes:
 *   • Every message body is rendered through renderMessageBody(), which escapes
 *     the text and only re-introduces anchors built from validated http(s) URLs.
 *   • Rooms the user is not a member of are never listed and cannot be read
 *     (enforced in firestore.rules via the parent chat's `members`).
 *   • Uploads are type/size checked here and again by storage.rules.
 */

import { session } from './auth.js';
import { can, DEPARTMENTS } from './permissions.js';
import {
  $, $$, esc, attr, refreshIcons, render as mount, emptyState, avatarHTML, avatarWithPresence,
  debounce, on, setBusy
} from './utils/dom.js';
import { toastSuccess, toastError, reportError } from './utils/toast.js';
import { openModal, confirmDialog, promptDialog, lightbox } from './utils/modal.js';
import {
  col, ref, query, where, orderBy, limit, onSnapshot, addDoc, updateDoc, deleteDoc,
  getDirectory, getUsers, getMany, ts
} from './utils/api.js';
import { formatTime, formatDate, timeAgo, toMillis, isToday, formatBytes } from './utils/format.js';
import { renderMessageBody, sanitizeText, sanitizeMultiline, extractFirstLink, linkHost, safeUrl }
  from './utils/sanitize.js';
import { uploadFile, compressImage, pickFiles, paths, deleteFile } from './utils/upload.js';
import { uploadsEnabled } from './features.js';
import { watchAllPresence, setTyping, watchTyping, WORK_STATES } from './utils/presence.js';
import { LUMA_AI_ID, aiRoomRow, openAiChat } from './chat-ai.js';
import { openTaskModal } from './tasks.js';

const CHAT_TYPES = {
  group:      { ar: 'مجموعة عامة',  icon: 'users' },
  department: { ar: 'مجموعة قسم',   icon: 'building-2' },
  direct:     { ar: 'محادثة خاصة',  icon: 'user' },
  manager:    { ar: 'مراسلة الإدارة', icon: 'shield' }
};

export async function render(container, ctx) {
  const unsubs = [];
  let chats = [];
  let activeId = ctx.params.id || null;
  let messagesUnsub = null;
  let typingUnsub = null;
  let statuses = {};
  let replyTo = null;
  let aiTeardown = null;

  const canUseAi = can(session.claims, 'tasks.ai');

  const directory = await getDirectory().catch(() => []);
  const people = Object.fromEntries(directory.map((u) => [u.id, u]));

  container.innerHTML = `
    <div class="page__inner">
      <div class="page-head">
        <div>
          <div class="page-head__title">الدردشة</div>
          <div class="page-head__sub">تواصل لحظي مع الفريق</div>
        </div>
        <div class="page-head__actions">
          <button class="btn btn--secondary" id="new-dm"><i data-lucide="user-plus"></i> محادثة خاصة</button>
          ${can(session.claims, 'chat.manage')
            ? '<button class="btn btn--primary" id="new-group"><i data-lucide="users"></i> مجموعة جديدة</button>' : ''}
        </div>
      </div>

      <div class="chat-layout" id="chat-layout">
        <aside class="chat-list">
          <div class="chat-list__head">
            <div class="input-group input-group--icon">
              <i data-lucide="search" class="input-group__icon"></i>
              <input class="input" id="chat-search" type="search" placeholder="بحث في المحادثات…">
            </div>
          </div>
          <div class="chat-list__body" id="rooms">${'<div class="skeleton skeleton--row"></div>'.repeat(4)}</div>
        </aside>

        <section class="chat-panel" id="panel">
          <div class="empty-state" style="margin:auto">
            <div class="empty-state__icon"><i data-lucide="message-circle"></i></div>
            <div class="empty-state__title">اختر محادثة للبدء</div>
            <p class="empty-state__text">اختر مجموعة أو ابدأ محادثة خاصة مع أحد الزملاء.</p>
          </div>
        </section>
      </div>
    </div>`;

  refreshIcons(container);

  $('#new-dm').addEventListener('click', () => openDirectPicker(directory, openChat));
  $('#new-group')?.addEventListener('click', () => openGroupModal(directory));

  unsubs.push(watchAllPresence((value) => { statuses = value; paintRooms(); }));

  $('#chat-search').addEventListener('input', debounce(paintRooms, 200));

  unsubs.push(onSnapshot(
    query(col('chats'), where('members', 'array-contains', session.uid),
      orderBy('lastMessageAt', 'desc'), limit(80)),
    (snap) => {
      chats = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      paintRooms();
      // The AI room opens itself and has no document to re-read, so it is
      // left alone here — otherwise every chat update would wipe the panel.
      if (activeId === LUMA_AI_ID) return;
      if (!activeId && chats.length && window.innerWidth > 640) openChat(chats[0].id);
      else if (activeId) {
        const chat = chats.find((c) => c.id === activeId);
        if (chat) paintHeader(chat);
      }
    },
    (err) => mount($('#rooms'), emptyState({
      icon: 'shield-alert', title: 'تعذّر تحميل المحادثات', text: err.message
    }))
  ));

  // Deep link: #/chat?dm=<uid> opens (or creates) a direct conversation.
  if (ctx.query.dm) {
    openOrCreateDirect(ctx.query.dm).then((id) => id && openChat(id)).catch(() => {});
  }

  // #/chat/__luma_ai__ — opened here rather than by the snapshot handler
  // above, which only knows about rooms that exist as documents.
  if (activeId === LUMA_AI_ID && canUseAi) openChat(LUMA_AI_ID);

  /* --------------------------------------------------------------- rooms */

  function paintRooms() {
    const term = ($('#chat-search')?.value || '').trim().toLowerCase();
    const host = $('#rooms');
    if (!host) return;

    const rows = chats
      .map((chat) => ({ ...chat, label: chatLabel(chat) }))
      .filter((chat) => !term || chat.label.toLowerCase().includes(term));

    // Pinned above the people, and only hidden when a search plainly excludes
    // it — it is always available rather than something to scroll for.
    const showAi = canUseAi && (!term || 'luma ai'.includes(term) || term.includes('ai'));
    const aiRow = showAi ? aiRoomRow({ active: activeId === LUMA_AI_ID }) : '';

    if (!rows.length && !showAi) {
      mount(host, emptyState({ icon: 'message-square', title: 'لا محادثات', text: 'ابدأ محادثة جديدة.' }));
      return;
    }

    host.innerHTML = aiRow + rows.map((chat) => {
      const unread = chat.unread?.[session.uid] || 0;
      const other = chat.type === 'direct'
        ? people[(chat.members || []).find((m) => m !== session.uid)]
        : null;
      const state = other ? (statuses[other.id]?.state || 'offline') : null;
      return `
        <button class="chat-room${chat.id === activeId ? ' is-active' : ''}" data-chat="${attr(chat.id)}">
          ${other
            ? avatarWithPresence(other, state, 'sm')
            : `<span class="stat__icon" style="width:34px;height:34px">
                 <i data-lucide="${attr(CHAT_TYPES[chat.type]?.icon || 'users')}" class="icon-sm"></i></span>`}
          <div class="chat-room__body">
            <div class="chat-room__name">${esc(chat.label)}</div>
            <div class="chat-room__last">${esc(chat.lastMessage || 'لا رسائل بعد')}</div>
          </div>
          <div style="text-align:end">
            ${unread ? `<span class="chat-room__badge">${unread}</span>` : ''}
            <div class="fs-2xs text-muted">${chat.lastMessageAt ? esc(timeAgo(chat.lastMessageAt)) : ''}</div>
          </div>
        </button>`;
    }).join('');
    refreshIcons(host);

    $$('[data-chat]', host).forEach((b) => b.addEventListener('click', () => openChat(b.dataset.chat)));
  }

  function chatLabel(chat) {
    if (chat.type === 'direct') {
      const other = (chat.members || []).find((m) => m !== session.uid);
      return people[other]?.displayName || 'محادثة خاصة';
    }
    return chat.name || CHAT_TYPES[chat.type]?.ar || 'مجموعة';
  }

  /* ---------------------------------------------------------- open chat */

  function openChat(chatId) {
    activeId = chatId;
    history.replaceState(null, '', `#/chat/${chatId}`);
    $('#chat-layout').classList.add('show-panel');
    paintRooms();

    // The AI room is virtual — there is no Firestore document behind it, so
    // it renders itself rather than going through the message subscription.
    if (chatId === LUMA_AI_ID) {
      aiTeardown?.();
      aiTeardown = openAiChat($('#panel'), (draft) => openTaskModal({
        defaults: {
          title: draft.title,
          description: draft.description,
          project: draft.project,
          priority: draft.priority,
          dueAt: draft.dueAt || '',
          assignees: draft.assignees,
          clientId: draft.clientId
        }
      }));
      $('#chat-back')?.addEventListener('click',
        () => $('#chat-layout').classList.remove('show-panel'));
      return;
    }

    const chat = chats.find((c) => c.id === chatId);
    if (!chat) return;

    const panel = $('#panel');
    panel.innerHTML = `
      <header class="chat-panel__head" id="chat-head"></header>
      <div class="chat-panel__body" id="messages">
        ${'<div class="skeleton skeleton--row"></div>'.repeat(3)}
      </div>
      <div class="typing-indicator" id="typing"></div>
      <footer class="chat-panel__foot">
        <div id="reply-bar"></div>
        <div class="chat-composer">
          ${uploadsEnabled() ? `
          <button class="btn btn--ghost btn--icon" id="attach-btn" aria-label="إرفاق ملف">
            <i data-lucide="paperclip"></i></button>` : ''}
          <textarea class="textarea" id="msg-input" rows="1" placeholder="اكتب رسالة…"></textarea>
          <button class="btn btn--primary btn--icon" id="send-btn" aria-label="إرسال">
            <i data-lucide="send"></i></button>
        </div>
      </footer>`;

    paintHeader(chat);
    refreshIcons(panel);
    wireComposer(chat);
    subscribeMessages(chat);
    markRead(chat);
  }

  function paintHeader(chat) {
    const head = $('#chat-head');
    if (!head) return;
    const other = chat.type === 'direct'
      ? people[(chat.members || []).find((m) => m !== session.uid)] : null;
    const state = other ? (statuses[other.id]?.state || 'offline') : null;

    head.innerHTML = `
      <button class="icon-btn" id="chat-back" aria-label="رجوع"
              style="display:none"><i data-lucide="arrow-right"></i></button>
      ${other
        ? avatarWithPresence(other, state)
        : `<span class="stat__icon"><i data-lucide="${attr(CHAT_TYPES[chat.type]?.icon || 'users')}"></i></span>`}
      <div class="flex-1" style="min-width:0">
        <div class="fw-700 truncate">${esc(chatLabel(chat))}</div>
        <div class="fs-xs text-muted">
          ${other
            ? esc(WORK_STATES[state]?.ar || '')
            : `${(chat.members || []).length} عضو`}
        </div>
      </div>
      ${can(session.claims, 'chat.manage') && chat.type !== 'direct'
        ? `<button class="icon-btn" id="chat-settings" aria-label="إعدادات المجموعة">
             <i data-lucide="settings"></i></button>` : ''}
      ${chat.type === 'direct' || can(session.claims, 'chat.manage')
        ? `<button class="icon-btn" id="chat-delete" aria-label="حذف المحادثة" title="حذف المحادثة">
             <i data-lucide="trash-2"></i></button>` : ''}`;
    refreshIcons(head);

    $('#chat-delete')?.addEventListener('click', () => confirmDeleteChat(chat));

    if (window.innerWidth <= 640) {
      const back = $('#chat-back');
      back.style.display = 'grid';
      back.addEventListener('click', () => $('#chat-layout').classList.remove('show-panel'));
    }
    $('#chat-settings')?.addEventListener('click', () => openGroupModal(directory, chat));
  }

  function subscribeMessages(chat) {
    messagesUnsub?.();
    typingUnsub?.();

    messagesUnsub = onSnapshot(
      query(col('chats', chat.id, 'messages'), orderBy('createdAt', 'asc'), limit(200)),
      async (snap) => {
        const messages = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        await getUsers([...new Set(messages.map((m) => m.senderId))]);
        paintMessages(chat, messages);
        markRead(chat);
      },
      (err) => mount($('#messages'), emptyState({
        icon: 'shield-alert', title: 'تعذّر تحميل الرسائل', text: err.message
      }))
    );
    unsubs.push(messagesUnsub);

    typingUnsub = watchTyping(chat.id, (uids) => {
      const others = uids.filter((u) => u !== session.uid).map((u) => people[u]?.displayName).filter(Boolean);
      const node = $('#typing');
      if (node) node.textContent = others.length ? `${others.join('، ')} يكتب الآن…` : '';
    });
    unsubs.push(typingUnsub);
  }

  function paintMessages(chat, messages) {
    const host = $('#messages');
    if (!host) return;

    if (!messages.length) {
      mount(host, emptyState({
        icon: 'message-circle', title: 'ابدأ المحادثة', text: 'لا رسائل بعد — أرسل أول رسالة.'
      }));
      return;
    }

    let lastDay = '';
    host.innerHTML = messages.map((m) => {
      const own = m.senderId === session.uid;
      const author = people[m.senderId] || { displayName: m.senderName };
      const created = toMillis(m.createdAt);
      const day = created ? new Date(created).toDateString() : '';
      const divider = day && day !== lastDay
        ? `<div class="day-divider">${esc(isToday(created) ? 'اليوم' : formatDate(created))}</div>` : '';
      lastDay = day;

      if (m.deleted) {
        return `${divider}<div class="msg${own ? ' is-own' : ''}">
          <div class="msg__bubble"><div class="msg__text text-muted">
            <i data-lucide="ban" class="icon-sm"></i> تم حذف هذه الرسالة</div></div></div>`;
      }

      const link = extractFirstLink(m.body || '');
      return `${divider}
        <div class="msg${own ? ' is-own' : ''}" data-msg="${attr(m.id)}">
          ${avatarHTML(author, 'sm')}
          <div class="msg__bubble">
            ${!own ? `<div class="msg__author">${esc(author.displayName || 'مستخدم')}</div>` : ''}
            ${m.replyTo ? `<div class="msg__reply">
              <strong>${esc(m.replyTo.author || '')}</strong>: ${esc((m.replyTo.body || '').slice(0, 90))}
            </div>` : ''}
            ${m.body ? `<div class="msg__text">${renderMessageBody(m.body)}</div>` : ''}
            ${m.attachment?.type?.startsWith('image/')
              ? `<img class="msg__img" src="${attr(m.attachment.url)}" alt="${attr(m.attachment.name)}"
                   loading="lazy" data-zoom="${attr(m.attachment.url)}">`
              : m.attachment
                ? `<a class="msg__file" href="${attr(m.attachment.url)}" target="_blank" rel="noopener noreferrer">
                     <i data-lucide="file" class="icon-sm"></i>
                     <span class="truncate">${esc(m.attachment.name)}</span>
                     <span class="text-muted fs-2xs">${esc(formatBytes(m.attachment.size))}</span>
                   </a>` : ''}
            ${link && !m.attachment ? `
              <a class="msg__link-preview" href="${attr(link)}" target="_blank" rel="noopener noreferrer nofollow">
                <i data-lucide="link" class="icon-sm"></i>
                <span class="truncate">${esc(linkHost(link))}</span>
              </a>` : ''}
            <div class="msg__meta">
              <span class="num">${esc(formatTime(m.createdAt))}</span>
              ${m.editedAt ? '<span>· عُدّلت</span>' : ''}
              ${own ? `<i data-lucide="${(m.readBy || []).length > 1 ? 'check-check' : 'check'}"
                class="icon-sm" style="color:${(m.readBy || []).length > 1 ? 'var(--info)' : 'inherit'}"></i>` : ''}
            </div>
          </div>
          <div class="msg__actions">
            <button class="icon-btn" data-reply="${attr(m.id)}" aria-label="رد" style="width:26px;height:26px">
              <i data-lucide="reply" class="icon-sm"></i></button>
            ${own ? `
              <button class="icon-btn" data-edit="${attr(m.id)}" aria-label="تعديل" style="width:26px;height:26px">
                <i data-lucide="pencil" class="icon-sm"></i></button>
              <button class="icon-btn" data-del="${attr(m.id)}" aria-label="حذف" style="width:26px;height:26px">
                <i data-lucide="trash-2" class="icon-sm"></i></button>` : ''}
          </div>
        </div>`;
    }).join('');

    refreshIcons(host);
    host.scrollTop = host.scrollHeight;

    on(host, 'click', '[data-zoom]', (e, node) => lightbox(node.dataset.zoom));

    $$('[data-reply]', host).forEach((b) => b.addEventListener('click', () => {
      const message = messages.find((m) => m.id === b.dataset.reply);
      replyTo = {
        id: message.id,
        author: people[message.senderId]?.displayName || '',
        body: message.body || '[مرفق]'
      };
      paintReplyBar();
      $('#msg-input')?.focus();
    }));

    $$('[data-edit]', host).forEach((b) => b.addEventListener('click', async () => {
      const message = messages.find((m) => m.id === b.dataset.edit);
      const next = await promptDialog({
        title: 'تعديل الرسالة', label: 'النص', value: message.body || '', multiline: true
      });
      if (next === null) return;
      await updateDoc(ref('chats', chat.id, 'messages', message.id), {
        body: sanitizeMultiline(next, 4000), editedAt: ts()
      });
    }));

    $$('[data-del]', host).forEach((b) => b.addEventListener('click', async () => {
      const message = messages.find((m) => m.id === b.dataset.del);
      const hasFile = !!message?.attachment;

      if (!(await confirmDialog({
        title: hasFile ? 'حذف الرسالة والمرفق' : 'حذف الرسالة',
        message: hasFile
          ? 'سيتم حذف الرسالة والصورة/الملف المرفق بها للجميع. لا يمكن التراجع.'
          : 'سيتم إخفاء محتوى الرسالة للجميع.',
        danger: true
      }))) return;

      try {
        // Clear the attachment too, otherwise a "deleted" message keeps
        // showing its image to everyone in the room.
        await updateDoc(ref('chats', chat.id, 'messages', message.id), {
          deleted: true, body: '', attachment: null, deletedAt: ts()
        });
        // Then drop the stored object. Inline images live on the document
        // itself and have no path, so there is nothing to clean up for those.
        if (message.attachment?.path) {
          await deleteFile(message.attachment.path).catch(() => {});
        }
      } catch (err) {
        reportError(err, 'delete-message');
      }
    }));
  }

  function paintReplyBar() {
    const bar = $('#reply-bar');
    if (!bar) return;
    if (!replyTo) { bar.innerHTML = ''; return; }
    bar.innerHTML = `
      <div class="flex items-center gap-2 mb-2 fs-xs" style="padding:6px 10px;background:var(--bg-inset);
           border-inline-start:2px solid var(--yellow);border-radius:var(--radius-xs)">
        <i data-lucide="reply" class="icon-sm"></i>
        <span class="flex-1 truncate">رد على <strong>${esc(replyTo.author)}</strong>: ${esc(replyTo.body.slice(0, 60))}</span>
        <button class="icon-btn" id="cancel-reply" style="width:22px;height:22px">
          <i data-lucide="x" class="icon-sm"></i></button>
      </div>`;
    refreshIcons(bar);
    $('#cancel-reply').addEventListener('click', () => { replyTo = null; paintReplyBar(); });
  }

  function wireComposer(chat) {
    const input = $('#msg-input');
    const send = async () => {
      const body = sanitizeMultiline(input.value, 4000);
      if (!body) return;
      input.value = '';
      input.style.height = 'auto';
      const pending = replyTo;
      replyTo = null;
      paintReplyBar();
      setTyping(chat.id, session.uid, false);

      try {
        await postMessage(chat, { body, replyTo: pending });
      } catch (err) {
        reportError(err, 'send-message');
        input.value = body;
      }
    };

    $('#send-btn').addEventListener('click', send);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
      setTyping(chat.id, session.uid, true);
      stopTypingSoon(chat.id);
    });

    $('#attach-btn')?.addEventListener('click', async () => {
      const [file] = await pickFiles({ accept: 'image/*,.pdf,.doc,.docx,.xlsx,.zip' });
      if (!file) return;
      const button = $('#attach-btn');
      setBusy(button, true);
      try {
        const prepared = file.type.startsWith('image/')
          ? await compressImage(file, { maxSize: 1400 }) : file;
        const uploaded = await uploadFile(prepared, paths.chat(chat.id, session.uid, prepared), {
          maxMB: 15
        });
        await postMessage(chat, { body: '', attachment: uploaded });
      } catch (err) {
        reportError(err, 'chat-upload');
      } finally {
        setBusy(button, false);
      }
    });
  }

  const stopTypingSoon = debounce((chatId) => setTyping(chatId, session.uid, false), 2500);

  async function postMessage(chat, { body = '', attachment = null, replyTo: reply = null }) {
    await addDoc(col('chats', chat.id, 'messages'), {
      senderId: session.uid,
      senderName: session.profile?.displayName || '',
      body,
      attachment,
      replyTo: reply ? { id: reply.id, author: reply.author, body: reply.body.slice(0, 120) } : null,
      readBy: [session.uid],
      deleted: false,
      createdAt: ts()
    });

    const preview = body ? body.slice(0, 80) : (attachment ? '📎 مرفق' : '');
    const unread = { ...(chat.unread || {}) };
    (chat.members || []).forEach((m) => {
      if (m !== session.uid) unread[m] = (unread[m] || 0) + 1;
    });

    await updateDoc(ref('chats', chat.id), {
      lastMessage: preview,
      lastMessageAt: ts(),
      unread,
      updatedAt: ts()
    }).catch(() => {});
  }

  async function markRead(chat) {
    if (!chat?.unread?.[session.uid]) return;
    try {
      await updateDoc(ref('chats', chat.id), {
        unread: { ...chat.unread, [session.uid]: 0 },
        updatedAt: ts()
      });
    } catch { /* rules may forbid it for non-members; ignore */ }
  }

  /* ------------------------------------------------------- direct chats */

  async function openOrCreateDirect(otherUid) {
    if (otherUid === session.uid) return null;
    const existing = chats.find(
      (c) => c.type === 'direct' && (c.members || []).includes(otherUid)
    );
    if (existing) return existing.id;

    const found = await getMany(query(
      col('chats'), where('members', 'array-contains', session.uid), where('type', '==', 'direct'), limit(60)
    )).catch(() => []);
    const match = found.find((c) => (c.members || []).includes(otherUid));
    if (match) return match.id;

    const created = await addDoc(col('chats'), {
      type: 'direct',
      name: '',
      members: [session.uid, otherUid],
      memberNames: {
        [session.uid]: session.profile?.displayName || '',
        [otherUid]: people[otherUid]?.displayName || ''
      },
      unread: {},
      createdBy: session.uid,
      createdAt: ts(),
      lastMessageAt: ts()
    });
    return created.id;
  }

  function openDirectPicker(list, onPick) {
    openModal({
      title: 'بدء محادثة خاصة',
      size: 'sm',
      bodyHTML: `
        <div class="input-group input-group--icon mb-3">
          <i data-lucide="search" class="input-group__icon"></i>
          <input class="input" id="dm-search" placeholder="ابحث عن زميل…">
        </div>
        <div id="dm-list" style="max-height:340px;overflow-y:auto"></div>`,
      onMount: (api) => {
        refreshIcons(api.root);
        const paint = (term = '') => {
          const rows = list.filter((u) =>
            u.id !== session.uid && u.displayName.toLowerCase().includes(term.toLowerCase()));
          api.$('#dm-list').innerHTML = rows.map((u) => `
            <button class="list-row w-full" data-pick="${attr(u.id)}" style="text-align:start">
              ${avatarHTML(u)}
              <div class="list-row__body">
                <div class="list-row__title">${esc(u.displayName)}</div>
                <div class="list-row__sub">${esc(DEPARTMENTS[u.department] || '')}</div>
              </div>
            </button>`).join('') || '<div class="text-muted fs-sm">لا نتائج.</div>';
          $$('[data-pick]', api.root).forEach((b) => b.addEventListener('click', async () => {
            api.close();
            const id = await openOrCreateDirect(b.dataset.pick);
            if (id) onPick(id);
          }));
        };
        paint();
        api.$('#dm-search').addEventListener('input', debounce((e) => paint(e.target.value), 180));
      }
    });
  }

  /**
   * Deleting a conversation removes it for everyone in it — there is no
   * per-user "hide" in the data model, so the dialog has to say that plainly.
   */
  async function confirmDeleteChat(chat) {
    const isDirect = chat.type === 'direct';
    const other = isDirect
      ? people[(chat.members || []).find((m) => m !== session.uid)]?.displayName : '';

    const ok = await confirmDialog({
      title: isDirect ? 'حذف المحادثة الخاصة' : 'حذف المجموعة',
      message: `
        ${isDirect
          ? `سيتم حذف محادثتك مع <strong>${esc(other || 'الزميل')}</strong> وكل رسائلها.`
          : `سيتم حذف مجموعة <strong>${esc(chat.name || '')}</strong> وكل رسائلها.`}
        <div class="security-note mt-3">
          <i data-lucide="users"></i>
          <div>الحذف يتم <strong>للطرفين</strong> — ولن يتمكن
            ${isDirect ? 'الزميل' : 'أعضاء المجموعة'} من رؤية الرسائل بعد الآن.</div>
        </div>
        <div class="fs-xs text-muted mt-3">لا يمكن التراجع. يمكنك بدء محادثة جديدة في أي وقت.</div>`,
      confirmText: 'حذف نهائي',
      danger: true
    });
    if (!ok) return;

    try {
      const result = await callFn('deleteChat', { chatId: chat.id });
      toastSuccess(
        result.messageCount
          ? `تم حذف المحادثة و${result.messageCount} رسالة.`
          : 'تم حذف المحادثة.'
      );
      activeId = null;
      history.replaceState(null, '', '#/chat');
      $('#chat-layout')?.classList.remove('show-panel');
      const panel = $('#panel');
      if (panel) {
        panel.innerHTML = `
          <div class="empty-state" style="margin:auto">
            <div class="empty-state__icon"><i data-lucide="message-circle"></i></div>
            <div class="empty-state__title">اختر محادثة للبدء</div>
          </div>`;
        refreshIcons(panel);
      }
    } catch (err) {
      reportError(err, 'delete-chat');
    }
  }

  function openGroupModal(list, chat = null) {
    const selected = new Set(chat?.members || [session.uid]);
    openModal({
      title: chat ? 'إعدادات المجموعة' : 'مجموعة جديدة',
      size: 'lg',
      bodyHTML: `
        <div class="field">
          <label class="field__label" for="g-name">اسم المجموعة <span class="req">*</span></label>
          <input class="input" id="g-name" maxlength="80" value="${attr(chat?.name || '')}">
        </div>
        <div class="field">
          <label class="field__label" for="g-type">نوع المجموعة</label>
          <select class="select" id="g-type">
            <option value="group" ${chat?.type === 'group' ? 'selected' : ''}>مجموعة عامة</option>
            <option value="department" ${chat?.type === 'department' ? 'selected' : ''}>مجموعة قسم</option>
            <option value="manager" ${chat?.type === 'manager' ? 'selected' : ''}>قناة الإدارة</option>
          </select>
        </div>
        <div class="field">
          <label class="field__label">الأعضاء</label>
          <div class="chip-select" id="g-members" style="max-height:220px;overflow-y:auto">
            ${list.map((u) => `
              <button type="button" class="chip-toggle${selected.has(u.id) ? ' is-on' : ''}"
                      data-uid="${attr(u.id)}">${esc(u.displayName)}</button>`).join('')}
          </div>
        </div>`,
      footerHTML: `
        ${chat ? '<button class="btn btn--outline-danger" id="g-delete">حذف المجموعة</button>' : ''}
        <button class="btn btn--ghost" data-modal-close>إلغاء</button>
        <button class="btn btn--primary" id="g-save">حفظ</button>`,
      onMount: (api) => {
        refreshIcons(api.root);
        $$('[data-uid]', api.root).forEach((c) => c.addEventListener('click', () => {
          const uid = c.dataset.uid;
          if (selected.has(uid)) { selected.delete(uid); c.classList.remove('is-on'); }
          else { selected.add(uid); c.classList.add('is-on'); }
        }));

        api.$('#g-save').addEventListener('click', async () => {
          const name = sanitizeText(api.$('#g-name').value, 80);
          if (!name) return toastError('اسم المجموعة مطلوب.');
          if (selected.size < 2) return toastError('اختر عضوين على الأقل.');

          const payload = {
            name,
            type: api.$('#g-type').value,
            members: [...selected],
            updatedAt: ts()
          };
          try {
            if (chat) await updateDoc(ref('chats', chat.id), payload);
            else {
              const created = await addDoc(col('chats'), {
                ...payload, unread: {}, createdBy: session.uid, createdAt: ts(), lastMessageAt: ts()
              });
              openChat(created.id);
            }
            toastSuccess('تم الحفظ.');
            api.close();
          } catch (err) { reportError(err, 'save-group'); }
        });

        api.$('#g-delete')?.addEventListener('click', async () => {
          if (!(await confirmDialog({
            title: 'حذف المجموعة', message: 'سيتم حذف المجموعة لجميع الأعضاء.', danger: true
          }))) return;
          try {
            await deleteDoc(ref('chats', chat.id));
            toastSuccess('تم حذف المجموعة.');
            api.close();
            activeId = null;
          } catch (err) { reportError(err, 'delete-group'); }
        });
      }
    });
  }

  return () => {
    setTyping(activeId, session.uid, false);
    aiTeardown?.();
    unsubs.forEach((fn) => { try { fn(); } catch {} });
  };
}
