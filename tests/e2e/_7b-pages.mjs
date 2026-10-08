// Page-side builders for the Phase 7b specs (Chromium and Firefox share them): each function runs INSIDE a
// YouTube fixture page (it is stringified by Playwright / Selenium), so it may only use what is in the page.

/**
 * The search box dropdown, filled as YouTube fills it: live suggestions, and history rows that carry a
 * "Remove" link (class ytSuggestionComponentRemoveLink, its Dark and ClearButton forms) in the right container.
 * Returns the queries by kind.
 */
export function buildSearchDropdownInPage() {
  const box = document.querySelector('.ytSearchboxComponentSuggestionsContainer');
  if (!box) throw new Error('no search dropdown in this snapshot');
  box.removeAttribute('hidden');
  box.replaceChildren();
  const make = (query, removeClass) => {
    const row = document.createElement('div');
    row.setAttribute('role', 'presentation');
    row.className = 'ytSuggestionComponentSuggestion ytSuggestionComponentLargerSuggestion';
    row.style.cssText = 'display:flex;height:44px;align-items:center;';
    row.innerHTML = '';
    const text = document.createElement('div');
    text.setAttribute('role', 'option');
    text.setAttribute('aria-label', query);
    text.className = 'ytSuggestionComponentText';
    const left = document.createElement('div');
    left.className = 'ytSuggestionComponentLeftContainer';
    left.textContent = query;
    text.append(left);
    const right = document.createElement('div');
    right.className = 'ytSuggestionComponentRightContainer';
    if (removeClass) {
      const link = document.createElement('a');
      link.className = removeClass;
      link.setAttribute('role', 'button');
      link.setAttribute('tabindex', '0');
      link.textContent = 'Remove';
      right.append(link);
    }
    row.append(text, right);
    box.append(row);
    return row;
  };
  const history = [
    ['rain sounds', 'ytSuggestionComponentRemoveLink'],
    ['chill beats', 'ytSuggestionComponentRemoveLink ytSuggestionComponentRemoveLinkDark'],
    ['jazz', 'ytSuggestionComponentRemoveLinkClearButton'],
  ];
  const live = ['lofi', 'lofi girl', 'lofi hip hop'];
  for (const [q, cls] of history) make(q, cls).setAttribute('data-kind', 'history');
  for (const q of live) make(q, null).setAttribute('data-kind', 'live');
  return { history: history.map((h) => h[0]), live };
}

/** Runs in the page: which dropdown rows (by query) take up room. */
export function visibleDropdownRowsInPage() {
  return [...document.querySelectorAll('.ytSuggestionComponentSuggestion')]
    .filter((r) => r.getClientRects().length > 0)
    .map((r) => `${r.getAttribute('data-kind')}:${r.querySelector('[role="option"]').getAttribute('aria-label')}`);
}

/**
 * Gives every row of a channel's Home tab the data object YouTube holds for it (captured live, see
 * tests/fixtures/youtube/channel-shelves.json), as `.data` on the element, in document order. Returns the count.
 */
export function attachShelfDataInPage(rows) {
  const els = [...document.querySelectorAll('ytd-browse[page-subtype="channels"] ytd-item-section-renderer > #contents > *')];
  els.forEach((el, i) => {
    if (rows[i]) el.data = rows[i].data;
  });
  return els.length;
}

/** Runs in the page: per row of the Home tab, [tag, data-at-peace-shelf, is its item section laid out]. */
export function homeRowsInPage() {
  return [...document.querySelectorAll('ytd-browse[page-subtype="channels"] ytd-item-section-renderer')].map((section) => {
    const row = section.querySelector(':scope > #contents > *');
    return [row?.localName ?? null, row?.getAttribute('data-at-peace-shelf') ?? null, section.getClientRects().length > 0 && getComputedStyle(section).display !== 'none'];
  });
}

/**
 * Adds a header button to the channel header's action row, shaped like the others (a wrapper with the
 * `ytFlexibleActionsViewModelAction` class around a `button-view-model`), whose data comes from `componentProps.data()`
 * as view models serve it. Returns the number of buttons now in the row.
 */
export function addHeaderButtonInPage({ data, label }) {
  const first = document.querySelector('ytd-browse[page-subtype="channels"] yt-page-header-view-model .ytFlexibleActionsViewModelAction');
  if (!first) throw new Error('no header action row in this snapshot');
  const wrap = first.cloneNode(true);
  wrap.removeAttribute('data-at-peace-channel-action');
  const host = wrap.firstElementChild;
  host.removeAttribute('data-at-peace-channel-action');
  host.componentProps = { data: () => data };
  const text = wrap.querySelector('.ytSpecButtonShapeNextButtonTextContent');
  if (text) text.textContent = label;
  first.after(wrap);
  // The first button (Subscribe) gets its own data too, shaped like the logged-out one.
  first.firstElementChild.componentProps = { data: () => ({ type: 'BUTTON_VIEW_MODEL_TYPE_FILLED', onTap: { innertubeCommand: { commandMetadata: {}, modalEndpoint: {} } } }) };
  return document.querySelectorAll('ytd-browse[page-subtype="channels"] yt-page-header-view-model .ytFlexibleActionsViewModelAction').length;
}

/** Runs in the page: [data-at-peace-channel-action, laid out] of every header button, in order. */
export function headerButtonsInPage() {
  return [...document.querySelectorAll('ytd-browse[page-subtype="channels"] yt-page-header-view-model .ytFlexibleActionsViewModelAction')].map((w) => [w.getAttribute('data-at-peace-channel-action'), w.getClientRects().length > 0 && getComputedStyle(w).display !== 'none']);
}

/**
 * Runs in the page: every thumbnail picture the feature may touch, with what it points at now.
 * `id` = the video id of the card's own link (/watch?v=ID or /shorts/ID) or null.
 */
export function thumbnailReportInPage() {
  const idOf = (href) => {
    try {
      const u = new URL(href, 'https://www.youtube.com');
      const v = u.pathname === '/watch' ? u.searchParams.get('v') : /^\/shorts\/([\w-]+)/.exec(u.pathname)?.[1];
      return v && /^[\w-]{11}$/.test(v) ? v : null;
    } catch {
      return null;
    }
  };
  const CARD = 'yt-lockup-view-model, ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-playlist-panel-video-renderer, ytm-shorts-lockup-view-model, ytd-playlist-video-renderer, ytd-grid-video-renderer, ytd-reel-item-renderer';
  return [...document.querySelectorAll('yt-thumbnail-view-model img, ytd-thumbnail img')]
    .filter((img) => !img.closest('[hidden]') && img.closest(CARD))
    .map((img) => {
      const link = img.closest('a[href]') ?? img.closest(CARD)?.querySelector('a[href*="/watch?v="], a[href*="/shorts/"]');
      return {
        id: link ? idOf(link.getAttribute('href')) : null,
        src: img.getAttribute('src'),
        mark: img.getAttribute('data-at-peace-thumb'),
        orig: img.getAttribute('data-at-peace-thumb-src'),
        opacity: getComputedStyle(img).opacity,
      };
    });
}
