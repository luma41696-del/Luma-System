/**
 * Progressive loading for the big list screens (tasks, employees, requests).
 *
 * These pages are realtime: the kanban reorders as colleagues move cards, the
 * employee list tracks presence, requests update as they are approved. Classic
 * cursor pagination (`startAfter` per page) would mean one live listener per
 * page and manually merging their results, which is a lot of machinery to get
 * wrong.
 *
 * Instead we keep a single listener over a *growing window*: start at one page
 * and raise the limit when the user asks for more. That loads progressively —
 * the point of the exercise — while every row on screen stays live, and the
 * consuming page still receives one plain array exactly as before.
 *
 * Re-subscribing re-reads the window, but the Firestore SDK serves what it
 * already has from its local cache, so growing the window costs roughly the
 * newly revealed rows rather than the whole list again.
 */

/**
 * @param {object}   options
 * @param {function} options.buildQuery  (max) => Firestore query
 * @param {function} options.subscribe   (query, onRows, onError) => unsubscribe
 * @param {function} options.onData      (rows, meta) => void
 * @param {function} [options.onError]
 * @param {number}   [options.pageSize]  rows per step
 * @param {number}   [options.maxRows]   hard ceiling, so a runaway list cannot
 *                                       be pulled into memory indefinitely
 */
export function createPagedFeed({
  buildQuery,
  subscribe,
  onData,
  onError = null,
  pageSize = 30,
  maxRows = 1500
}) {
  let limit = pageSize;
  let stopped = false;
  // Every listener currently attached. Growing the window overlaps two of them
  // for a moment, and both must be reachable — unsubscribing only the newest
  // would strand the old one, which then keeps firing into a dead page.
  let listeners = [];

  const state = {
    rows: [],
    /** True while a larger window is being fetched. */
    loading: true,
    /**
     * A full page came back, so there is probably more behind it. Firestore
     * cannot tell us the total without counting, and this is the cheap
     * standard signal — at worst it offers one extra "load more" that
     * returns nothing new.
     */
    hasMore: false,
    limit,
    pageSize
  };

  function detachAllExcept(keep) {
    for (const entry of listeners) {
      if (entry === keep) continue;
      try { entry.unsub?.(); } catch { /* already gone */ }
    }
    listeners = keep ? [keep] : [];
  }

  function open() {
    if (stopped) return;
    state.loading = true;

    const entry = { unsub: null };
    listeners.push(entry);

    entry.unsub = subscribe(
      buildQuery(limit),
      (rows) => {
        if (stopped) return;
        // Drop the previous listener only once this one has delivered, so the
        // list never blanks out mid-swap.
        detachAllExcept(entry);

        state.rows = rows;
        state.loading = false;
        state.limit = limit;
        state.hasMore = rows.length >= limit && limit < maxRows;
        onData(rows, state);
      },
      (err) => {
        if (stopped) return;
        state.loading = false;
        detachAllExcept(entry);
        onError?.(err);
      }
    );
  }

  open();

  return {
    state,
    /** Widen the window by one page. No-op while a fetch is in flight. */
    loadMore() {
      if (stopped || state.loading || !state.hasMore) return false;
      limit = Math.min(limit + pageSize, maxRows);
      open();
      return true;
    },
    /** Collapse back to the first page — used when filters change server-side. */
    reset() {
      limit = pageSize;
      open();
    },
    stop() {
      stopped = true;
      detachAllExcept(null);
    }
  };
}

/**
 * Append the "load more" footer to a rendered list and wire infinite scroll.
 *
 * The button is always rendered when more rows exist — the observer is a
 * convenience, not the only way through, so keyboard users and anyone whose
 * scroll container behaves unexpectedly can still page forward.
 *
 * Returns a teardown for the observer; call it before re-rendering the list.
 */
export function mountLoadMore(host, feed, { label = 'تحميل المزيد', autoLoad = true } = {}) {
  if (!host) return () => {};

  const { hasMore, loading, rows } = feed.state;
  if (!hasMore && !loading) return () => {};

  const footer = document.createElement('div');
  footer.className = 'load-more';
  footer.innerHTML = `
    <button class="btn btn--secondary${loading ? ' is-loading' : ''}" data-load-more
            ${loading ? 'disabled' : ''}>${label}</button>
    <span class="load-more__count num">${rows.length} محمّلة</span>`;
  host.append(footer);

  const button = footer.querySelector('[data-load-more]');
  button.addEventListener('click', () => {
    button.classList.add('is-loading');
    button.disabled = true;
    feed.loadMore();
  });

  if (!autoLoad || typeof IntersectionObserver === 'undefined') return () => {};

  // Pull the next page slightly before the sentinel is actually on screen, so
  // the list feels continuous rather than stopping at the bottom.
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) feed.loadMore();
  }, { rootMargin: '300px' });

  observer.observe(footer);
  return () => observer.disconnect();
}
