/**
 * Turning a Luma AI proposal into the form a person confirms it in.
 *
 * The assistant never writes a task or an event. It returns a draft, and this
 * opens the ordinary form pre-filled so the save is a human action taken with
 * the record in front of them.
 *
 * One place, because three screens offer drafts — the tasks board, the
 * calendar and the chat — and a mapping copied three times is a mapping that
 * drifts. The page modules are pulled in on demand so a screen only loads the
 * form it actually opens.
 */

/**
 * @param {object} draft  as returned by draftTask / draftEvent
 */
export async function openDraft(draft) {
  if (!draft) return;

  if (draft.kind === 'event') {
    const { openEventModal } = await import('./calendar.js');
    openEventModal({
      defaults: {
        title: draft.title,
        type: draft.type,
        visibility: draft.visibility,
        // The server sends ISO strings; the form works in Date objects.
        startAt: draft.startAt ? new Date(draft.startAt) : null,
        endAt: draft.endAt ? new Date(draft.endAt) : null,
        location: draft.location,
        description: draft.description,
        participants: draft.participants,
        clientId: draft.clientId
      }
    });
    return;
  }

  const { openTaskModal } = await import('./tasks.js');
  openTaskModal({
    defaults: {
      title: draft.title,
      description: draft.description,
      project: draft.project,
      priority: draft.priority,
      dueAt: draft.dueAt || '',
      assignees: draft.assignees,
      clientId: draft.clientId
    }
  });
}
