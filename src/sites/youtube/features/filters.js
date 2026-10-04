// Keyword and channel filters (yt.filters.keywords / channels / applyTo / commentKeywords).
//
// A card (or comment) that matches gets the attribute `data-at-peace-filtered`; the engine's always-on
// CSS rule (schema-core compileRules) hides every element carrying it, so this file only decides who
// is marked. Hiding the CARD element, never an inner part, lets grids and lists close up without holes
// (docs/youtube-dom.md §2.8).
//
// Matching
//   - keywords: substring of the title, case- and diacritic-insensitive. A line written /pattern/flags
//     is a regular expression, compiled once (flags i, m, s, u; g and y are ignored because they make
//     RegExp stateful); an invalid one is ignored and reported once with AP.warn.
//   - channels: the channel NAME (exact, case/diacritic-insensitive), an `@handle` (from the link's
//     href), a channel id `UC…`, or a /regex/ over the name and handle. Cards with no channel link
//     (the watch sidebar shows the name as plain text) can only match by name.
//   - comments: the same keyword matching over the comment's text.
//   - applyTo: which surfaces are filtered (home, search, watch sidebar, subscriptions); a card is
//     placed by its container, so a hidden, cached page never changes the answer.
//
// Efficiency: only roots the engine says were added are scanned, each card is evaluated from
// `textContent` and attributes (no layout reads), and a card whose text has not arrived yet is
// re-checked a few times shortly after (YouTube fills cards in after inserting them).
(() => {
  'use strict';
  const AP = globalThis.AtPeace;

  const KEYWORDS = 'yt.filters.keywords';
  const CHANNELS = 'yt.filters.channels';
  const APPLY_TO = 'yt.filters.applyTo';
  const COMMENTS = 'yt.filters.commentKeywords';
  const MARK = 'data-at-peace-filtered';

  // ---- matching (pure, unit-tested) --------------------------------------------------------------------------

  /** Case- and diacritic-insensitive form of a string: "Crème Brûlée" → "creme brulee". */
  function normalize(text) {
    return String(text ?? '')
      .normalize('NFD')
      .replace(/\p{M}+/gu, '')
      .toLowerCase();
  }

  /** Strips diacritics but keeps the case (what a user's own /regex/ is tested against as well). */
  const stripMarks = (text) => String(text ?? '').normalize('NFD').replace(/\p{M}+/gu, '');

  const REGEX_LINE = /^\/(.+)\/([a-z]*)$/s;

  /**
   * One line of a filter list.
   * @param {unknown} line
   * @returns {{ kind: 'text', needle: string, raw: string } | { kind: 'regex', re: RegExp, raw: string } | { kind: 'invalid', error: string, raw: string } | null} null for a blank line
   */
  function parseEntry(line) {
    const raw = String(line ?? '').trim();
    if (raw === '') return null;
    const m = REGEX_LINE.exec(raw);
    if (!m) return { kind: 'text', needle: normalize(raw), raw };
    const flags = [...new Set(m[2])].filter((f) => f !== 'g' && f !== 'y' && f !== 'd').join('');
    try {
      return { kind: 'regex', re: new RegExp(m[1], flags), raw };
    } catch (err) {
      return { kind: 'invalid', error: String(err?.message ?? err), raw };
    }
  }

  /**
   * Compiles a keyword list.
   * @param {unknown} lines
   * @returns {{ needles: string[], regexes: RegExp[], invalid: { raw: string, error: string }[] }}
   */
  function compileKeywords(lines) {
    const out = { needles: [], regexes: [], invalid: [] };
    for (const line of Array.isArray(lines) ? lines : []) {
      const entry = parseEntry(line);
      if (!entry) continue;
      if (entry.kind === 'text') {
        if (entry.needle !== '') out.needles.push(entry.needle);
      } else if (entry.kind === 'regex') {
        out.regexes.push(entry.re);
      } else {
        out.invalid.push({ raw: entry.raw, error: entry.error });
      }
    }
    return out;
  }

  /** Does `text` contain one of the compiled keywords? */
  function matchesKeywords(compiled, text) {
    if (!compiled || (compiled.needles.length === 0 && compiled.regexes.length === 0)) return false;
    const subject = String(text ?? '').slice(0, 1000);
    if (subject === '') return false;
    const folded = normalize(subject);
    if (compiled.needles.some((needle) => folded.includes(needle))) return true;
    if (compiled.regexes.length === 0) return false;
    const stripped = stripMarks(subject);
    return compiled.regexes.some((re) => re.test(subject) || (stripped !== subject && re.test(stripped)));
  }

  const CHANNEL_ID = /^UC[\w-]{22}$/;

  /**
   * Compiles the channel list: names, `@handles`, `UC…` ids and /regex/ lines.
   * @param {unknown} lines
   */
  function compileChannels(lines) {
    const out = { names: new Set(), handles: new Set(), ids: new Set(), regexes: [], invalid: [] };
    for (const line of Array.isArray(lines) ? lines : []) {
      const entry = parseEntry(line);
      if (!entry) continue;
      if (entry.kind === 'invalid') {
        out.invalid.push({ raw: entry.raw, error: entry.error });
      } else if (entry.kind === 'regex') {
        out.regexes.push(entry.re);
      } else if (entry.raw.startsWith('@') && entry.raw.length > 1) {
        out.handles.add(normalize(entry.raw.slice(1)));
      } else if (CHANNEL_ID.test(entry.raw)) {
        out.ids.add(entry.raw);
      } else if (entry.needle !== '') {
        out.names.add(entry.needle);
      }
    }
    return out;
  }

  /**
   * Is this card's channel in the list?
   * @param {ReturnType<typeof compileChannels>} compiled
   * @param {{ name?: string, handles?: string[], ids?: string[] }} channel handles are lowercase, without "@"
   */
  function matchesChannel(compiled, channel) {
    if (!compiled || !channel) return false;
    const { names, handles, ids, regexes } = compiled;
    if (names.size === 0 && handles.size === 0 && ids.size === 0 && regexes.length === 0) return false;
    const name = String(channel.name ?? '').trim();
    if (name !== '' && names.has(normalize(name))) return true;
    for (const handle of channel.handles ?? []) if (handles.has(normalize(handle))) return true;
    for (const id of channel.ids ?? []) if (ids.has(id)) return true;
    return regexes.some((re) => (name !== '' && re.test(name)) || (channel.handles ?? []).some((h) => re.test(`@${h}`)));
  }

  /**
   * Handle or channel id of a channel link's href (`/@name`, `/channel/UC…`).
   * @param {string|null} href
   * @returns {{ handle?: string, id?: string }|null} null for any other link (/c/, /user/ and videos carry neither)
   */
  function channelFromHref(href) {
    if (typeof href !== 'string') return null;
    const m = /^(?:https?:\/\/(?:www\.|m\.)?youtube\.com)?\/(?:(@[^/?#]+)|channel\/(UC[\w-]{22}))(?:[/?#]|$)/.exec(href);
    if (!m) return null;
    if (m[1]) {
      try {
        return { handle: decodeURIComponent(m[1].slice(1)).toLowerCase() };
      } catch {
        return { handle: m[1].slice(1).toLowerCase() };
      }
    }
    return { id: m[2] };
  }

  // ---- reading a card ------------------------------------------------------------------------------------------

  /** One element per card kind; the card is what gets hidden. */
  const CARD_SELECTOR = [
    'ytd-rich-item-renderer', // home, subscriptions (and channel) grids
    'ytd-video-renderer', // search results (the legacy renderer is still current there)
    'ytd-compact-video-renderer', // legacy sidebar
    'ytd-grid-video-renderer', // legacy grid
    'yt-lockup-view-model', // sidebar, search and playlist lockups (a lockup inside a rich item is covered by the item)
    '.ytGridShelfViewModelGridShelfItem', // one Short in a Shorts shelf
  ].join(',');
  const TITLE_SELECTOR = 'a#video-title, a#video-title-link, a.ytLockupMetadataViewModelTitle, .shortsLockupViewModelHostMetadataTitle a, #video-title';
  const CHANNEL_LINK_SELECTOR = 'a[href^="/@"], a[href^="/channel/"], a[href*="youtube.com/@"], a[href*="youtube.com/channel/"]';
  const METADATA_TEXT = '.ytContentMetadataViewModelMetadataRow:first-of-type .ytContentMetadataViewModelMetadataText';
  const COMMENT_SELECTOR = 'ytd-comment-thread-renderer';
  const REPLY_SELECTOR = '#replies ytd-comment-view-model';

  /** Which of the four filter surfaces a card is on, or null (channel pages, playlists, history … are not filtered). */
  function surfaceOf(card) {
    if (card.closest('ytd-search')) return 'search';
    if (card.closest('ytd-watch-flexy')) return card.closest('ytd-playlist-panel-renderer') ? null : 'watch';
    const browse = card.closest('ytd-browse');
    switch (browse?.getAttribute('page-subtype')) {
      case 'home': return 'home';
      case 'subscriptions': return 'subscriptions';
      default: return null;
    }
  }

  const textOf = (el) => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

  /** What a card says about itself: title, channel name, channel handles and ids. */
  function cardInfo(card) {
    const titleEl = card.querySelector(TITLE_SELECTOR);
    const title = (titleEl?.getAttribute('title') || textOf(titleEl)).trim();
    let name = '';
    const handles = [];
    const ids = [];
    for (const a of card.querySelectorAll(CHANNEL_LINK_SELECTOR)) {
      const ch = channelFromHref(a.getAttribute('href'));
      if (!ch) continue;
      if (ch.handle && !handles.includes(ch.handle)) handles.push(ch.handle);
      if (ch.id && !ids.includes(ch.id)) ids.push(ch.id);
      if (name === '') name = textOf(a);
    }
    if (name === '') {
      const named = card.querySelector('ytd-channel-name') ?? card.querySelector(METADATA_TEXT);
      name = textOf(named);
    }
    return { title, name, handles, ids };
  }

  // ---- the feature -----------------------------------------------------------------------------------------------

  let current = null; // ctx
  let keywords = compileKeywords([]);
  let channels = compileChannels([]);
  let commentWords = compileKeywords([]);
  let applyTo = new Set();
  let signature = '';
  const warned = new Set();
  /** Cards whose text has not arrived yet: re-checked a few times (each card at most RETRIES times). */
  const retries = new WeakMap();
  const pending = new Set();
  let retryTimer = null;
  const RETRIES = 8;
  const RETRY_MS = 350;

  const list = (settings, id) => (Array.isArray(settings?.[id]) ? settings[id] : []);

  /** Recompiles when the lists changed; returns true if they did. */
  function compileFrom(settings) {
    const next = JSON.stringify([list(settings, KEYWORDS), list(settings, CHANNELS), list(settings, APPLY_TO), list(settings, COMMENTS)]);
    if (next === signature) return false;
    signature = next;
    keywords = compileKeywords(list(settings, KEYWORDS));
    channels = compileChannels(list(settings, CHANNELS));
    commentWords = compileKeywords(list(settings, COMMENTS));
    applyTo = new Set(list(settings, APPLY_TO));
    for (const bad of [...keywords.invalid, ...channels.invalid, ...commentWords.invalid]) {
      if (warned.has(bad.raw)) continue;
      warned.add(bad.raw);
      AP.warn(`filter ignored, not a valid regular expression: ${bad.raw} (${bad.error})`);
    }
    return true;
  }

  const setMark = (el, on) => {
    if (el.hasAttribute(MARK) !== on) {
      if (on) el.setAttribute(MARK, '');
      else el.removeAttribute(MARK);
    }
  };

  function evaluateCard(card) {
    // A lockup inside a rich item is part of that item: the item is the card.
    if (card.localName === 'yt-lockup-view-model' && card.closest('ytd-rich-item-renderer')) return;
    const surface = surfaceOf(card);
    if (!surface || !applyTo.has(surface)) {
      setMark(card, false);
      return;
    }
    const info = cardInfo(card);
    if (info.title === '') {
      // The card has been inserted but not filled in yet.
      const n = retries.get(card) ?? 0;
      if (n < RETRIES) {
        retries.set(card, n + 1);
        pending.add(card);
        scheduleRetry();
      }
      return;
    }
    setMark(card, matchesKeywords(keywords, info.title) || matchesChannel(channels, info));
  }

  function evaluateComment(el, text) {
    setMark(el, matchesKeywords(commentWords, text));
  }

  /** Comment threads and replies inside a root (the watch page only). */
  function evaluateComments(root) {
    if (current?.page !== 'watch') return;
    const threads = [];
    const own = root.closest?.(COMMENT_SELECTOR);
    if (own) threads.push(own);
    if (root.querySelectorAll) threads.push(...root.querySelectorAll(COMMENT_SELECTOR));
    for (const thread of new Set(threads)) {
      if (!thread.closest('ytd-watch-flexy')) continue;
      evaluateComment(thread, textOf(thread.querySelector('ytd-comment-view-model #content-text, #content-text')));
    }
    const replies = [];
    const ownReply = root.closest?.(REPLY_SELECTOR);
    if (ownReply) replies.push(ownReply);
    if (root.querySelectorAll) replies.push(...root.querySelectorAll(REPLY_SELECTOR));
    for (const reply of new Set(replies)) evaluateComment(reply, textOf(reply.querySelector('#content-text')));
  }

  function scan(root) {
    if (!root || root.nodeType !== 1) return;
    const cards = new Set();
    const own = root.closest?.(CARD_SELECTOR);
    if (own) cards.add(own);
    if (root.querySelectorAll) for (const card of root.querySelectorAll(CARD_SELECTOR)) cards.add(card);
    for (const card of cards) evaluateCard(card);
    if (commentWords.needles.length > 0 || commentWords.regexes.length > 0) evaluateComments(root);
  }

  function scheduleRetry() {
    if (retryTimer !== null) return;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      const cards = [...pending];
      pending.clear();
      for (const card of cards) if (card.isConnected) evaluateCard(card);
    }, RETRY_MS);
  }

  /** Every mark off (feature off, or a list changed and everything is evaluated afresh). */
  function clearMarks() {
    for (const el of document.querySelectorAll(`[${MARK}]`)) el.removeAttribute(MARK);
  }

  /** The text that decides whether a thing is hidden changed or the lists did: evaluate the whole page again. */
  function rescan() {
    clearMarks();
    pending.clear();
    scan(document.documentElement);
  }

  AP.yt.features.push({
    id: 'filters',
    settings: [KEYWORDS, CHANNELS, APPLY_TO, COMMENTS],
    observes: true,
    isActive: (ctx) => [KEYWORDS, CHANNELS, COMMENTS].some((id) => list(ctx.settings, id).some((line) => String(line ?? '').trim() !== '')),
    init(ctx) {
      current = ctx;
      compileFrom(ctx.settings);
    },
    onNavigate(ctx) {
      current = ctx;
      scan(document.documentElement); // cached pages are shown again with their old marks: make sure they are right
    },
    onSettings(ctx) {
      current = ctx;
      if (compileFrom(ctx.settings)) rescan();
    },
    onMutations(ctx, roots) {
      current = ctx;
      for (const root of roots) scan(root);
    },
    destroy() {
      clearTimeout(retryTimer);
      retryTimer = null;
      pending.clear();
      clearMarks();
      current = null;
      signature = '';
    },
  });

  AP.yt.filters = { normalize, parseEntry, compileKeywords, matchesKeywords, compileChannels, matchesChannel, channelFromHref };
})();
