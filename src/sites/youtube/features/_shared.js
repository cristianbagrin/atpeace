// Helpers shared by the YouTube feature files (it registers no feature itself). Isolated world only.
//
//   AP.yt.shared.createRedirector({ target })   in-app redirects: capture-phase click on links, the
//                                               Navigation API, and a fallback after a navigation ends
//   AP.yt.shared.inputs                         "did a real user just do something?" (refcounted listeners)
//   AP.yt.shared.mainVideo() / videoIdOf(url)   the watch page's <video> and the id a URL points at
//   AP.yt.shared.setLoopGuard(storage)          test hook
//
// Redirecting without loops or surprises:
//   - A plain left click on a link whose target should be redirected is stopped (preventDefault +
//     stopImmediatePropagation, so YouTube's own handler never starts a Single-Page navigation to
//     the page we are about to replace) and the browser loads the target: location.assign, so Back
//     returns to the page the user clicked from.
//   - Navigation that starts without a click (a script, a keyboard shortcut) is caught when YouTube
//     calls history.pushState (Navigation API, fires with the destination URL) and, where that API
//     is missing, after YouTube finished rendering (yt-navigate-finish). There the browser already
//     has a history entry for the page that must not be shown, so location.replace swaps it for
//     the target and Back does not land on it again. (Replacing at `yt-navigate-start` instead would
//     overwrite the entry of the page the user is LEAVING: Back would skip it.)
//   - Every redirect passes a loop guard (sessionStorage): the same target three times within 15 s
//     means something bounces us back (a target YouTube redirects away from, a logged-out
//     /playlist?list=WL…) and the guard refuses, so the page just stays where it is.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;
  AP.yt ??= {};

  // ---- loop guard --------------------------------------------------------------------------------

  const GUARD_KEY = 'at-peace.redirects';
  const GUARD_WINDOW_MS = 15_000;
  const GUARD_LIMIT = 3;
  let guardStorage = null; // test hook; null = sessionStorage
  let guardMemory = []; // when sessionStorage is unavailable (blocked, private mode)

  const storage = () => {
    if (guardStorage) return guardStorage;
    try {
      return globalThis.sessionStorage ?? null;
    } catch {
      return null;
    }
  };

  function readGuard() {
    const s = storage();
    if (!s) return guardMemory;
    try {
      const list = JSON.parse(s.getItem(GUARD_KEY) ?? '[]');
      return Array.isArray(list) ? list.filter((e) => Array.isArray(e) && typeof e[0] === 'string' && typeof e[1] === 'number') : [];
    } catch {
      return guardMemory;
    }
  }

  function writeGuard(list) {
    guardMemory = list;
    try {
      storage()?.setItem(GUARD_KEY, JSON.stringify(list));
    } catch {
      /* storage full / blocked: the in-memory copy still guards this page */
    }
  }

  /**
   * Records a redirect to `target` and says whether it may go ahead.
   * @param {string} target
   * @param {number} [now]
   * @returns {boolean} false when the same target was already redirected to GUARD_LIMIT times in the last 15 s
   */
  function allowRedirect(target, now = Date.now()) {
    const recent = readGuard().filter(([, at]) => now - at < GUARD_WINDOW_MS);
    if (recent.filter(([t]) => t === target).length >= GUARD_LIMIT) {
      writeGuard(recent);
      return false;
    }
    recent.push([target, now]);
    writeGuard(recent.slice(-8));
    return true;
  }

  /** Has a redirect to `target` been refused by the guard (so a feature can show its fallback)? */
  function isLooping(target, now = Date.now()) {
    return readGuard().filter(([t, at]) => t === target && now - at < GUARD_WINDOW_MS).length >= GUARD_LIMIT;
  }

  // ---- the page we are on -----------------------------------------------------------------------------

  /** The video id a watch-ish URL points at (`/watch?v=ID`, `/live/ID`, `/clip/ID`), or null. */
  function videoIdOf(url) {
    let u;
    try {
      u = new URL(url, 'https://www.youtube.com');
    } catch {
      return null;
    }
    const v = u.searchParams.get('v');
    if (u.pathname === '/watch') return v && /^[\w-]{6,20}$/.test(v) ? v : null;
    const m = /^\/(?:live|clip|shorts)\/([\w-]{6,40})/.exec(u.pathname);
    return m ? m[1] : null;
  }

  /** The watch page's main <video> (null on other pages, or before the player exists). */
  const mainVideo = () => document.querySelector('ytd-watch-flexy video.html5-main-video') ?? document.querySelector('ytd-watch-flexy #movie_player video');

  /** The watch page's player element. */
  const playerEl = () => document.querySelector('ytd-watch-flexy #movie_player');

  // ---- user input ----------------------------------------------------------------------------------------

  const PLAY_KEYS = new Set([' ', 'k', 'K', 'MediaPlayPause', 'Enter']);
  const SPEED_KEYS = new Set(['<', '>', ',', '.']);
  const state = { at: 0, playerAt: 0, playIntentAt: 0, speedAt: 0 };
  let inputUsers = 0;

  const isTyping = (el) => Boolean(el?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));

  function onInput(event) {
    try {
      if (!event.isTrusted) return; // our own .click() and the page's synthetic events are not the user
      const now = Date.now();
      state.at = now;
      const target = event.composedPath?.()[0] ?? event.target;
      const el = target?.nodeType === 1 ? target : target?.parentElement;
      const inPlayer = Boolean(el?.closest?.('#movie_player, ytd-player'));
      if (event.type === 'keydown') {
        if (isTyping(el)) return;
        if (SPEED_KEYS.has(event.key) && (event.shiftKey || event.key === '<' || event.key === '>')) state.speedAt = now;
        if (PLAY_KEYS.has(event.key) && (inPlayer || event.key !== 'Enter')) state.playIntentAt = now;
      } else if (inPlayer) {
        state.playerAt = now;
        state.playIntentAt = now; // a click or tap on the video, the play button or the controls
        if (el.closest('.ytp-settings-menu, .ytp-panel-menu, .ytp-popup')) state.speedAt = now;
      }
    } catch {
      /* never let bookkeeping break a page's input */
    }
  }

  const INPUT_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'];

  const inputs = {
    /** Starts tracking (reference counted: every feature that needs it acquires, then releases). */
    acquire() {
      if (inputUsers++ > 0) return;
      for (const type of INPUT_EVENTS) globalThis.addEventListener(type, onInput, { capture: true, passive: true });
    },
    release() {
      if (inputUsers === 0 || --inputUsers > 0) return;
      for (const type of INPUT_EVENTS) globalThis.removeEventListener(type, onInput, { capture: true });
    },
    /** Timestamps (ms since epoch) of the latest trusted input of each kind; 0 = none yet. */
    get lastAt() {
      return state.at;
    },
    get lastPlayIntentAt() {
      return state.playIntentAt;
    },
    get lastSpeedAt() {
      return state.speedAt;
    },
  };

  // ---- redirector ---------------------------------------------------------------------------------------------

  /** The first <a href> on the event's path (shadow DOM included), or null. */
  function anchorOf(event) {
    const path = event.composedPath?.() ?? [];
    for (let i = 0; i < path.length && i < 14; i++) {
      const node = path[i];
      if (node?.localName === 'a' && typeof node.href === 'string') return node;
    }
    return null;
  }

  /** The redirect that is already under way (the old page lives on until the new one arrives). */
  let inFlight = { target: '', at: 0 };

  function navigate(target, { replace }) {
    // Several signals announce the same navigation (the click, the Navigation API, finish and
    // page-data-updated): one redirect, counted once, however many of them arrive.
    if (inFlight.target === target && Date.now() - inFlight.at < 4000) return true;
    if (!allowRedirect(target)) {
      AP.warn('redirect loop stopped; staying on this page:', target);
      return false;
    }
    inFlight = { target, at: Date.now() };
    try {
      if (replace) globalThis.location.replace(target);
      else globalThis.location.assign(target);
      return true;
    } catch (err) {
      AP.warn('redirect failed', target, err);
      return false;
    }
  }

  /**
   * @param {{ id?: string, target: (url: string, anchor: HTMLAnchorElement|null) => (string|null) }} spec
   *        `target(url, anchor)`: where this URL should go instead (absolute), or null. `anchor` is the
   *        clicked link, null for navigations.
   */
  function createRedirector({ target }) {
    let started = false;
    let navApi = null;

    const onClick = (event) => {
      try {
        if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        const a = anchorOf(event);
        if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
        const to = target(a.href, a);
        if (!to || to === globalThis.location.href) return;
        if (isLooping(to)) return; // the guard would refuse: let YouTube navigate as usual
        event.preventDefault();
        event.stopImmediatePropagation();
        navigate(to, { replace: false });
      } catch (err) {
        AP.warn('redirect click handler failed', err);
      }
    };

    const onNavigateApi = (event) => {
      try {
        if (event.navigationType !== 'push' && event.navigationType !== 'replace') return;
        const url = event.destination?.url;
        if (typeof url !== 'string' || url === globalThis.location.href) return;
        const to = target(url, null);
        if (to && to !== url) navigate(to, { replace: true });
      } catch (err) {
        AP.warn('redirect navigate handler failed', err);
      }
    };

    return {
      start() {
        if (started) return;
        started = true;
        globalThis.addEventListener('click', onClick, { capture: true });
        navApi = globalThis.navigation ?? null;
        navApi?.addEventListener?.('navigate', onNavigateApi);
      },
      stop() {
        if (!started) return;
        started = false;
        globalThis.removeEventListener('click', onClick, { capture: true });
        navApi?.removeEventListener?.('navigate', onNavigateApi);
        navApi = null;
      },
      /** After a navigation finished (or on startup): is the page we are ON one we redirect away from? */
      check() {
        try {
          const here = globalThis.location.href;
          const to = target(here, null);
          if (to && to !== here) navigate(to, { replace: true });
        } catch (err) {
          AP.warn('redirect check failed', err);
        }
      },
    };
  }

  AP.yt.shared = {
    createRedirector,
    inputs,
    allowRedirect,
    isLooping,
    videoIdOf,
    mainVideo,
    playerEl,
    setLoopGuard: (s) => {
      guardStorage = s;
      guardMemory = [];
    },
  };
})();
