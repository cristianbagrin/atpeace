// YouTube MAIN-world script (runs in the page's own JS realm, document_start). It exists for the
// two things an isolated content script cannot do: read YouTube's own data objects (`element.data`)
// and call the player API (`#movie_player.setAutonav()` …). It must not load or use AtPeace or any
// extension API (tests/unit/manifest.test.mjs enforces that), and it must never throw into the page.
//
// 1. COMMAND CHANNEL (isolated world → here), `window.postMessage` with a nonce handshake:
//      isolated → here  { ns:'at-peace', dir:'hello', nonce }          (from this very window only)
//      here → isolated  { ns:'at-peace', dir:'hello-ack' }  and  { ns:'at-peace', dir:'ready' } at load
//      isolated → here  { ns:'at-peace', dir:'cmd', nonce, id, cmd, args }
//      here → isolated  { ns:'at-peace', dir:'res', nonce, id, ok, value | error }
//    Anything without the nonce is ignored. The nonce is not a secret from the page (same realm);
//    it keeps other frames/extensions from steering the player by accident. The commands are the
//    ONLY thing exposed, and all are harmless: setAutonav, setPlaybackRate, getPlaybackRate,
//    pauseVideo, getPlayerState, keepActive, plus three switches for this script itself (setTags,
//    setDebug, retag).
//
// 2. BRIDGE TAGS (Contract C5, docs/reviews/phase-0-1.md): attributes on elements that have no
//    language-free CSS hook, derived from YouTube's data objects, never from text:
//      data-at-peace-entry   guide + mini-guide entries (iconType / endpoint of `entry.data`)
//      data-at-peace-tab     channel tabs (URL suffix of the page data's tab list, matched to the DOM tab)
//      data-at-peace-action  buttons under the video (view-model / renderer data of the action menu)
//    Re-tagged on yt-navigate-finish, yt-page-data-updated and (debounced) when the DOM changes.
(() => {
  'use strict';
  const root = document.documentElement;
  // Phase 0's contract: tests and users rely on this attribute to know the bridge ran.
  if (root.getAttribute('data-at-peace-bridge') === '1') return; // already running (never twice: one nonce, one set of listeners)
  root.setAttribute('data-at-peace-bridge', '1');

  const NS = 'at-peace';
  const ATTR_ENTRY = 'data-at-peace-entry';
  const ATTR_TAB = 'data-at-peace-tab';
  const ATTR_ACTION = 'data-at-peace-action';

  // ============================================================================================
  // Pure mapping functions (exported for the unit tests, see the end of the file)
  // ============================================================================================

  /**
   * Guide entry name for `entry.data.icon.iconType`. Observed live (logged out, 2026-10-04):
   * TAB_HOME_CAIRO, TAB_SHORTS_CAIRO, TAB_SUBSCRIPTIONS_CAIRO, ACCOUNT_CIRCLE_CAIRO, WATCH_HISTORY_CAIRO.
   * The rest are the names YouTube uses for the signed-in entries (unverified here: no login).
   */
  const ICON_ENTRIES = Object.freeze({
    TAB_HOME_CAIRO: 'home',
    TAB_HOME: 'home',
    HOME: 'home',
    TAB_SHORTS_CAIRO: 'shorts',
    TAB_SHORTS: 'shorts',
    SHORTS: 'shorts',
    TAB_SUBSCRIPTIONS_CAIRO: 'subscriptions',
    TAB_SUBSCRIPTIONS: 'subscriptions',
    SUBSCRIPTIONS: 'subscriptions',
    ACCOUNT_CIRCLE_CAIRO: 'you',
    ACCOUNT_CIRCLE: 'you',
    WATCH_HISTORY_CAIRO: 'history',
    WATCH_HISTORY: 'history',
    HISTORY: 'history',
    PLAYLISTS_CAIRO: 'playlists',
    PLAYLISTS: 'playlists',
    PLAYLIST_ADD_CAIRO: 'playlists',
    WATCH_LATER_CAIRO: 'watch-later',
    WATCH_LATER: 'watch-later',
    LIKES_PLAYLIST_CAIRO: 'liked',
    LIKES_PLAYLIST: 'liked',
    LIKE_CAIRO: 'liked',
    THUMB_UP_CAIRO: 'liked',
    OFFLINE_DOWNLOAD_CAIRO: 'downloads',
    OFFLINE_DOWNLOAD: 'downloads',
    DOWNLOADS_CAIRO: 'downloads',
    VIDEO_LIBRARY_CAIRO: 'your-videos',
    VIDEO_LIBRARY_WHITE: 'your-videos',
    MY_VIDEOS_CAIRO: 'your-videos',
    YOUR_VIDEOS_CAIRO: 'your-videos',
    EDUCATION_CAIRO: 'courses',
    COURSE_CAIRO: 'courses',
    COURSES_CAIRO: 'courses',
    CONTENT_CUT_CAIRO: 'your-clips',
    CONTENT_CUT: 'your-clips',
    CLIP_CAIRO: 'your-clips',
  });

  /** browseId → entry, for entries whose icon is not in the table above. */
  const BROWSE_ENTRIES = Object.freeze({
    FEwhat_to_watch: 'home',
    FEsubscriptions: 'subscriptions',
    FElibrary: 'you',
    FEhistory: 'history',
    FEplaylist_aggregation: 'playlists',
    VLWL: 'watch-later',
    VLLL: 'liked',
    FEdownloads: 'downloads',
    FEcourses: 'courses',
    FEclips: 'your-clips',
  });

  /** Entry name for a link target (path of /feed/…, /playlist?list=WL …), or null. */
  function entryFromUrl(url) {
    if (typeof url !== 'string' || url === '') return null;
    let u;
    try {
      u = new URL(url, 'https://www.youtube.com');
    } catch {
      return null;
    }
    if (u.hostname === 'studio.youtube.com') return u.pathname.startsWith('/channel/') ? 'your-videos' : null;
    if (!/^(www\.|m\.)?youtube\.com$/.test(u.hostname)) return null;
    const path = u.pathname.replace(/\/+$/, '') || '/';
    switch (path) {
      case '/': return 'home';
      case '/shorts': return 'shorts';
      case '/feed/subscriptions': return 'subscriptions';
      case '/feed/you':
      case '/feed/library': return 'you';
      case '/feed/history': return 'history';
      case '/feed/playlists': return 'playlists';
      case '/feed/downloads': return 'downloads';
      case '/feed/courses': return 'courses';
      case '/feed/clips': return 'your-clips';
      case '/playlist': {
        const list = u.searchParams.get('list');
        return list === 'WL' ? 'watch-later' : list === 'LL' ? 'liked' : null;
      }
      default: return null;
    }
  }

  /**
   * The Contract C5 name of a guide / mini-guide entry from its `data` object, or null (unknown
   * entries are left untagged). The destination decides first (language-free and stable), the icon
   * second; the Shorts entry has no URL at all (a `reelWatchEndpoint` command), so it is recognised
   * by that endpoint kind.
   * @param {any} data `ytd-guide-entry-renderer`.data
   * @returns {string|null}
   */
  function entryName(data) {
    if (!data || typeof data !== 'object') return null;
    const nav = data.navigationEndpoint;
    const svc = data.serviceEndpoint;
    if (nav?.reelWatchEndpoint || svc?.reelWatchEndpoint) return 'shorts';
    const byBrowse = BROWSE_ENTRIES[nav?.browseEndpoint?.browseId];
    if (byBrowse) return byBrowse;
    const byUrl = entryFromUrl(nav?.commandMetadata?.webCommandMetadata?.url) ?? entryFromUrl(nav?.urlEndpoint?.url);
    if (byUrl) return byUrl;
    const icon = data.icon?.iconType;
    return typeof icon === 'string' && Object.hasOwn(ICON_ENTRIES, icon) ? ICON_ENTRIES[icon] : null;
  }

  /** Tab aliases: YouTube's own URL suffix → the contract's name. */
  const TAB_ALIASES = Object.freeze({ featured: 'home', community: 'posts' });

  /**
   * URL suffix of a channel tab: "/@x/videos" → "videos", "/@x/featured" → "home", "/@x" → "home",
   * "/channel/UC…/shorts" → "shorts". Null for anything that is not a plain lowercase slug.
   * @param {string} url
   * @returns {string|null}
   */
  function tabFromUrl(url) {
    if (typeof url !== 'string' || url === '') return null;
    let path;
    try {
      path = new URL(url, 'https://www.youtube.com').pathname;
    } catch {
      return null;
    }
    const segments = path.split('/').filter(Boolean);
    let rest;
    if (segments[0]?.startsWith('@')) rest = segments.slice(1);
    else if (['channel', 'c', 'user'].includes(segments[0])) rest = segments.slice(2);
    else return null;
    const suffix = (rest[0] ?? 'featured').toLowerCase();
    const name = TAB_ALIASES[suffix] ?? suffix;
    return /^[a-z0-9_-]{1,24}$/.test(name) ? name : null;
  }

  /**
   * The tab list of a channel page's data (`ytd-browse.data`, `ytInitialData` or a navigate-finish
   * `response`): [{ title, name, expandable }]. `expandableTabRenderer` (the search tab, which the
   * DOM shows as an untitled icon) is included, flagged.
   * @param {any} pageData
   * @returns {{ title: string, name: string, expandable: boolean }[]}
   */
  function tabsFromPageData(pageData) {
    const tabs = pageData?.contents?.twoColumnBrowseResultsRenderer?.tabs;
    if (!Array.isArray(tabs)) return [];
    const out = [];
    for (const entry of tabs) {
      const tab = entry?.tabRenderer ?? entry?.expandableTabRenderer;
      const expandable = !entry?.tabRenderer;
      const title = typeof tab?.title === 'string' ? tab.title : '';
      const url = tab?.endpoint?.commandMetadata?.webCommandMetadata?.url ?? tab?.endpoint?.browseEndpoint?.canonicalBaseUrl;
      const name = tabFromUrl(url);
      out.push({ title, name: name ?? '', expandable });
    }
    return out;
  }

  /**
   * Which name each DOM tab gets: matches by title first (exact; several tabs with one title are
   * matched in order), and only when titles do not line up falls back to position, provided the DOM
   * and the data have the same number of titled tabs. Entries with no usable name come back null.
   * @param {(string|null)[]} domTitles `tab-title` attributes in DOM order (null = untitled)
   * @param {{ title: string, name: string, expandable?: boolean }[]} dataTabs
   * @returns {(string|null)[]}
   */
  function matchTabs(domTitles, dataTabs) {
    const used = new Set();
    const result = domTitles.map((title) => {
      if (title === null || title === '') return null;
      const i = dataTabs.findIndex((t, idx) => !used.has(idx) && t.title === title);
      if (i === -1) return undefined; // no title match: decide below
      used.add(i);
      return dataTabs[i].name || null;
    });
    if (result.every((r) => r !== undefined)) return result;
    const positional = dataTabs.filter((t) => t.title !== '' && !t.expandable);
    const titled = domTitles.filter((t) => t !== null && t !== '').length;
    if (titled !== positional.length) return result.map((r) => r ?? null);
    // Same number of titled tabs but a title differs (e.g. entity-escaped text): align by position.
    let n = 0;
    return domTitles.map((title, i) => {
      if (title === null || title === '') return null;
      const at = n++;
      return result[i] !== undefined ? result[i] : positional[at]?.name || null;
    });
  }

  /** `iconName`s and identifiers of the buttons under the video → Contract C5 action names. */
  const ACTION_ICONS = Object.freeze({
    SHARE: 'share',
    SHARE_ARROW: 'share',
    SHARE_ANDROID: 'share',
    DOWNLOAD: 'download',
    OFFLINE_DOWNLOAD: 'download',
    CONTENT_CUT: 'clip',
    CLIP: 'clip',
    CLIPS: 'clip',
    MONEY_HEART: 'thanks',
    MONEY_FILL: 'thanks',
    THANKS: 'thanks',
    PLAYLIST_ADD: 'save',
    BOOKMARK: 'save',
    BOOKMARK_BORDER: 'save',
    ADD_TO_PLAYLIST: 'save',
    SPARKLE: 'ask',
    SPARK: 'ask',
    SPARKLES: 'ask',
    AI_SPARKLE: 'ask',
    AUTO_AWESOME: 'ask',
    MORE_HORIZ: 'more',
    MORE_VERT: 'more',
    LIKE: 'like',
    THUMB_UP: 'like',
    DISLIKE: 'like',
    THUMB_DOWN: 'like',
  });

  /**
   * Action name for one entry of the action menu's data (`topLevelButtons[i]`, or the
   * `topLevelButton` of a `flexibleItems[i]`). Language-free keys only: the renderer/view-model
   * kind, `iconName`, and identifiers (`targetId`, `accessibilityId`) — never `title`.
   * @param {any} item
   * @returns {string|null}
   */
  function actionName(item) {
    if (!item || typeof item !== 'object') return null;
    if (item.segmentedLikeDislikeButtonViewModel || item.segmentedLikeDislikeButtonRenderer || item.likeButtonViewModel || item.toggleButtonRenderer) return 'like';
    if (item.downloadButtonRenderer) return 'download';
    const inner = item.buttonViewModel ?? item.buttonRenderer ?? item.toggleButtonViewModel ?? item.flexibleActionButtonViewModel ?? item;
    const icon = inner?.iconName ?? inner?.icon?.iconType ?? inner?.iconType;
    if (typeof icon === 'string' && Object.hasOwn(ACTION_ICONS, icon)) return ACTION_ICONS[icon];
    const id = String(inner?.targetId ?? inner?.accessibilityId ?? '').toLowerCase();
    if (id.includes('share')) return 'share';
    if (id.includes('download')) return 'download';
    if (id.includes('clip')) return 'clip';
    if (id.includes('thanks') || id.includes('donat')) return 'thanks';
    if (id.includes('save') || id.includes('playlist')) return 'save';
    return null;
  }

  // ============================================================================================
  // Runtime
  // ============================================================================================

  let nonce = null;
  let tagging = true; // tags are cheap and flicker-free when always on; the isolated side can switch them off
  let debug = false;
  const log = (...args) => {
    if (debug) {
      try {
        console.debug('[At Peace bridge]', ...args);
      } catch {
        /* console unavailable */
      }
    }
  };

  // ---- commands ------------------------------------------------------------------------------------

  const player = () => document.querySelector('ytd-watch-flexy #movie_player') ?? document.querySelector('#movie_player');
  const call = (name, ...args) => {
    const p = player();
    if (!p) return { ok: false, error: 'no-player' };
    if (typeof p[name] !== 'function') return { ok: false, error: 'no-method' };
    return { ok: true, value: p[name](...args) };
  };
  const num = (v, min, max) => (typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null);

  /** @type {Record<string, (...args: any[]) => ({ ok: boolean, value?: any, error?: string })>} */
  const COMMANDS = {
    setAutonav: (on) => call('setAutonav', on === true),
    setPlaybackRate: (rate) => {
      const n = num(rate, 0.0625, 16);
      if (n === null) return { ok: false, error: 'bad-argument' };
      const res = call('setPlaybackRate', n);
      return res.ok ? { ok: true, value: typeof player()?.getPlaybackRate === 'function' ? player().getPlaybackRate() : n } : res;
    },
    getPlaybackRate: () => call('getPlaybackRate'),
    pauseVideo: () => call('pauseVideo'),
    getPlayerState: () => call('getPlayerState'),
    keepActive: () => {
      window._lact = Date.now();
      const p = player();
      if (p && typeof p.updateLastActiveTime === 'function') p.updateLastActiveTime();
      return { ok: true };
    },
    setTags: (on) => {
      setTagging(on === true);
      return { ok: true, value: tagging };
    },
    setDebug: (on) => {
      debug = on === true;
      return { ok: true };
    },
    retag: () => {
      scanNow();
      return { ok: true };
    },
  };

  const post = (message) => {
    try {
      window.postMessage({ ns: NS, ...message }, location.origin);
    } catch {
      /* window gone */
    }
  };

  window.addEventListener('message', (event) => {
    try {
      if (event.source !== window) return;
      const msg = event.data;
      if (msg === null || typeof msg !== 'object' || msg.ns !== NS) return;
      if (msg.dir === 'hello') {
        if (typeof msg.nonce === 'string' && msg.nonce.length >= 16 && msg.nonce.length <= 128) {
          nonce = msg.nonce;
          post({ dir: 'hello-ack' });
          scheduleScan(0);
        }
        return;
      }
      if (msg.dir !== 'cmd' || nonce === null || msg.nonce !== nonce) return;
      const run = Object.hasOwn(COMMANDS, msg.cmd) ? COMMANDS[msg.cmd] : null;
      let res;
      try {
        res = run ? run(...(Array.isArray(msg.args) ? msg.args.slice(0, 4) : [])) : { ok: false, error: 'bad-command' };
      } catch (err) {
        res = { ok: false, error: 'failed' };
        log('command failed', msg.cmd, err);
      }
      post({ dir: 'res', nonce, id: msg.id, ...res });
    } catch {
      /* never throw into the page */
    }
  });
  post({ dir: 'ready' }); // an isolated side that started first answers with its hello

  // ---- tagging -------------------------------------------------------------------------------------

  const seenEntries = new WeakMap(); // element → data object it was last evaluated for
  const unknownEntries = new Set();

  function tagEntries() {
    for (const tag of ['ytd-guide-entry-renderer', 'ytd-mini-guide-entry-renderer']) {
      const list = document.getElementsByTagName(tag);
      for (let i = 0; i < list.length; i++) {
        const el = list[i];
        const data = el.data;
        if (!data || seenEntries.get(el) === data) continue;
        seenEntries.set(el, data);
        const name = entryName(data);
        if (name) {
          if (el.getAttribute(ATTR_ENTRY) !== name) el.setAttribute(ATTR_ENTRY, name);
        } else {
          el.removeAttribute(ATTR_ENTRY);
          if (debug) {
            const key = `${data.icon?.iconType ?? '?'} ${data.navigationEndpoint?.commandMetadata?.webCommandMetadata?.url ?? ''}`;
            if (!unknownEntries.has(key)) {
              unknownEntries.add(key);
              log('unknown guide entry (left untagged):', key);
            }
          }
        }
      }
    }
  }

  /** Tab list from the last yt-navigate-finish (SPA navigation), as a fallback to the page element's data. */
  let navTabs = null;

  /** The tabs of the channel page that is on screen, from the best available source. */
  function currentTabs() {
    const browse = document.querySelector('ytd-browse[page-subtype="channels"]:not([hidden])');
    const fromElement = tabsFromPageData(browse?.data);
    if (fromElement.length > 0) return fromElement;
    if (navTabs && navTabs.length > 0) return navTabs;
    return tabsFromPageData(window.ytInitialData);
  }

  function tagTabs() {
    const list = document.getElementsByTagName('yt-tab-shape');
    if (list.length === 0) return;
    const shapes = Array.from(list);
    const dataTabs = currentTabs();
    const titles = shapes.map((el) => el.getAttribute('tab-title'));
    const names = dataTabs.length > 0 ? matchTabs(titles, dataTabs) : titles.map(() => null);
    shapes.forEach((el, i) => {
      const name = names[i];
      if (name) {
        if (el.getAttribute(ATTR_TAB) !== name) el.setAttribute(ATTR_TAB, name);
      } else if (el.hasAttribute(ATTR_TAB)) {
        el.removeAttribute(ATTR_TAB);
      }
    });
  }

  function tagActions() {
    const metadata = document.querySelector('ytd-watch-metadata');
    if (!metadata) return;
    const menu = metadata.querySelector('#actions ytd-menu-renderer');
    const data = menu?.data;
    if (!data) return;
    // Hosts in DOM order. The data lists the same buttons in the same order: `topLevelButtons`
    // (rendered into #top-level-buttons-computed) and `flexibleItems` (into #flexible-item-buttons).
    const mapped = [];
    const top = menu.querySelector('#top-level-buttons-computed');
    const flexible = menu.querySelector('#flexible-item-buttons');
    const topData = Array.isArray(data.topLevelButtons) ? data.topLevelButtons : [];
    const flexData = Array.isArray(data.flexibleItems) ? data.flexibleItems.map((f) => f?.topLevelButton ?? f) : [];
    if (top) mapped.push([Array.from(top.children), topData]);
    if (flexible) mapped.push([Array.from(flexible.children), flexData]);
    for (const [hosts, items] of mapped) {
      if (hosts.length !== items.length) continue; // out of step (still rendering): decide on the next pass
      hosts.forEach((host, i) => {
        const name = actionName(items[i]);
        if (name && host.getAttribute(ATTR_ACTION) !== name) host.setAttribute(ATTR_ACTION, name);
        else if (!name && host.hasAttribute(ATTR_ACTION)) host.removeAttribute(ATTR_ACTION);
      });
    }
    // Hosts that have an id of their own.
    for (const [selector, name] of [['#sponsor-button', 'join'], ['#purchase-button', 'join']]) {
      const el = metadata.querySelector(selector);
      if (el && el.getAttribute(ATTR_ACTION) !== name) el.setAttribute(ATTR_ACTION, name);
    }
    const more = menu.querySelector(':scope > yt-button-shape#button-shape, :scope > yt-icon-button#button');
    if (more && more.getAttribute(ATTR_ACTION) !== 'more') more.setAttribute(ATTR_ACTION, 'more');
  }

  function scanNow() {
    if (!tagging) return;
    for (const fn of [tagEntries, tagTabs, tagActions]) {
      try {
        fn();
      } catch (err) {
        log('tagging step failed', fn.name, err);
      }
    }
  }

  // Debounced: DOM churn on YouTube is constant, a scan is a few hundred microseconds.
  let timer = null;
  let firstQueued = 0;
  function scheduleScan(delay = 150) {
    if (!tagging) return;
    const now = Date.now();
    if (timer !== null) {
      if (now - firstQueued < 1000) return; // already queued, and never starve it
      clearTimeout(timer);
    }
    firstQueued = now;
    timer = setTimeout(() => {
      timer = null;
      scanNow();
    }, delay);
  }

  let observer = null;
  function setTagging(on) {
    tagging = on;
    if (on) {
      observe();
      scheduleScan(0);
    } else {
      observer?.disconnect();
      observer = null;
      clearTimeout(timer);
      timer = null;
      for (const attr of [ATTR_ENTRY, ATTR_TAB, ATTR_ACTION]) {
        for (const el of document.querySelectorAll(`[${attr}]`)) el.removeAttribute(attr);
      }
    }
  }

  function observe() {
    if (observer || !tagging || typeof MutationObserver !== 'function') return;
    observer = new MutationObserver(() => scheduleScan());
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  // Page data arrives after the navigation events: re-tag now and a little later (bounded, not polling).
  const afterNavigation = (event) => {
    try {
      if (event.type === 'yt-navigate-finish') {
        const tabs = tabsFromPageData(event.detail?.response?.response);
        navTabs = tabs.length > 0 ? tabs : null;
      }
      for (const delay of [0, 400, 1500]) setTimeout(() => scheduleScan(0), delay);
    } catch {
      /* the page's own event: never throw */
    }
  };
  for (const type of ['yt-navigate-finish', 'yt-page-data-updated']) window.addEventListener(type, afterNavigation, true);
  observe();

  // ---- test hook -------------------------------------------------------------------------------------
  // Only when a test (or the page, which gains nothing: these are pure functions) sets the flag first.
  if (window.__atPeaceBridgeTest && typeof window.__atPeaceBridgeTest === 'object') {
    window.__atPeaceBridgeTest.exports = { entryName, entryFromUrl, tabFromUrl, tabsFromPageData, matchTabs, actionName, ICON_ENTRIES };
  }
})();
