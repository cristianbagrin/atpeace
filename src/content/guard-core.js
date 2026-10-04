// The part of Mindful Pause / Focus that lives on a page of the site itself (PLAN §8.3, §8.4).
// Shared by the YouTube session-guard feature and the dynamically registered guard.js that runs on
// user-added sites. It reads `state` and `settings` straight from storage (no schema stack: on a
// site we do not own we want to be small) and:
//
//   * when the pause SESSION for this site ends, pauses the media and shows the overlay
//     "Your 15 minutes are up" → Leave (close the tab) / Take a breath (the pause page);
//   * when a focus / schedule / limit BLOCK covers this site, sends the tab to the blocked page
//     (full page loads are caught by the DNR rules; this covers tabs that are already open and
//     in-page navigation);
//   * sends HEARTBEATs while the site is actually being looked at (daily limit + stats).
//
// Everything with side effects goes through `env`, so the decision logic is unit-tested without a
// browser. The decision rules rely on the background's promise (src/background/sessions.js): a
// session in `state.sessions` exists only while the pause is on for that site, and it is removed at
// its end. A session that vanishes BEFORE its end was cancelled (pause switched off): no overlay.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;

  const BLOCKED_PAGE = 'src/pages/blocked/blocked.html';
  const PAUSE_PAGE = 'src/pages/pause/pause.html';
  /** A session removed within this long BEFORE its time still counts as having ended (clock skew). */
  const END_SLACK_MS = 1500;
  /** setTimeout cannot take more than 2^31-1 ms. */
  const MAX_TIMER_MS = 2_147_000_000;
  const HEARTBEAT_MS = 30_000;
  const MIN_BEAT_GAP_MS = 25_000;

  const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

  // ---------------------------------------------------------------------------------------
  // Pure parts
  // ---------------------------------------------------------------------------------------

  /**
   * What the guard needs out of the raw stored `state` and `settings` (both may be garbage).
   * @param {{ state?: any, settings?: any }} got
   */
  function parseSnapshot(got) {
    const state = isObject(got?.state) ? got.state : {};
    const settings = isObject(got?.settings) ? got.settings : {};
    const sessions = {};
    if (isObject(state.sessions)) {
      for (const [key, until] of Object.entries(state.sessions)) if (typeof until === 'number' && Number.isFinite(until)) sessions[key] = until;
    }
    const sessionMinutes = {};
    if (isObject(state.sessionMinutes)) {
      for (const [key, m] of Object.entries(state.sessionMinutes)) if (typeof m === 'number' && m > 0) sessionMinutes[key] = m;
    }
    // `blocks` (Phase 3c) lists every block in force; `block` is the single PLAN §5 one.
    const rawBlocks = Array.isArray(state.blocks) ? state.blocks : isObject(state.block) ? [state.block] : [];
    const blocks = rawBlocks
      .filter((b) => isObject(b) && typeof b.until === 'number' && Array.isArray(b.siteKeys))
      .map((b) => ({ reason: typeof b.reason === 'string' ? b.reason : 'focus', until: b.until, siteKeys: b.siteKeys.filter((k) => typeof k === 'string') }));
    const sites = Array.isArray(settings['pause.sites']) ? settings['pause.sites'].filter((s) => isObject(s) && typeof s.siteKey === 'string' && typeof s.domain === 'string') : [];
    const theme = settings['general.theme'];
    return {
      sessions,
      sessionMinutes,
      blocks,
      sites,
      expiryOverlay: settings['pause.expiryOverlay'] !== false,
      theme: theme === 'dark' || theme === 'system' ? theme : 'light',
    };
  }

  /** The strongest block covering `siteKey` right now, or null (focus > limit > schedule on equal ends: longest first). */
  function blockFor(snapshot, siteKey, now) {
    const rank = { focus: 3, limit: 2, schedule: 1 };
    return (
      snapshot.blocks
        .filter((b) => b.until > now && b.siteKeys.includes(siteKey))
        .sort((a, b) => b.until - a.until || (rank[b.reason] ?? 0) - (rank[a.reason] ?? 0))[0] ?? null
    );
  }

  /**
   * Which configured site a host belongs to (domain or any subdomain; the longest domain wins).
   * @param {string} host
   * @param {{ siteKey: string, domain: string }[]} sites
   * @returns {string|null} siteKey
   */
  function siteKeyForHost(host, sites) {
    const h = String(host).toLowerCase().replace(/\.$/, '');
    let best = null;
    for (const s of sites) {
      const d = s.domain.toLowerCase();
      if ((h === d || h.endsWith(`.${d}`)) && (!best || d.length > best.domain.length)) best = { domain: d, siteKey: s.siteKey };
    }
    return best?.siteKey ?? null;
  }

  /**
   * What happens now, given the snapshot and what this page already knows.
   * @param {ReturnType<typeof parseSnapshot>} snapshot
   * @param {string} siteKey
   * @param {number} now
   * @param {{ knownUntil: number|null }} memory the last session end this page has seen
   * @returns {{ type: 'block', block: object } | { type: 'running', until: number } | { type: 'expired', until: number, minutes: number|null } | { type: 'idle' }}
   */
  function decide(snapshot, siteKey, now, memory) {
    const block = blockFor(snapshot, siteKey, now);
    if (block) return { type: 'block', block };
    const until = snapshot.sessions[siteKey];
    const minutes = snapshot.sessionMinutes[siteKey] ?? null;
    if (typeof until === 'number' && until > now) return { type: 'running', until };
    if (typeof until === 'number') return { type: 'expired', until, minutes };
    // No entry any more: the background removes a session when it ends. If this page saw it end
    // (within the slack) the session expired; if it vanished early it was cancelled.
    if (memory.knownUntil !== null && memory.knownUntil <= now + END_SLACK_MS) {
      return { type: 'expired', until: memory.knownUntil, minutes: memory.knownMinutes ?? null };
    }
    return { type: 'idle' };
  }

  /** "Your 15 minutes are up." / "Your time is up." */
  function expiryTitle(minutes) {
    if (!minutes) return 'Your time is up.';
    return minutes === 1 ? 'Your 1 minute is up.' : `Your ${minutes} minutes are up.`;
  }

  // ---------------------------------------------------------------------------------------
  // The guard
  // ---------------------------------------------------------------------------------------

  /**
   * @typedef {Object} GuardEnv  everything with side effects (all optional; real ones by default)
   * @property {() => number} [now]
   * @property {(fn: Function, ms: number) => any} [setTimeout]
   * @property {(handle: any) => void} [clearTimeout]
   * @property {() => Promise<{ state?: any, settings?: any }>} [read]            raw storage
   * @property {(listener: () => void) => (() => void)} [onStorageChange]        fires when state/settings change
   * @property {(listener: () => void) => (() => void)} [onWake]                  visibility / pageshow / focus
   * @property {(path: string) => string} [urlFor]                                extension URL
   * @property {() => string} [pageUrl]
   * @property {(url: string) => void} [navigate]
   * @property {() => Promise<any>} [closeTab]
   * @property {(spec: object) => void} [showOverlay]
   * @property {() => void} [hideOverlay]
   * @property {(on: boolean) => void} [keepPaused]                              while the overlay is up, media that starts playing is paused again
   */

  /**
   * @param {{ siteKey?: string, siteName?: string, resolveSiteKey?: (snapshot: ReturnType<typeof parseSnapshot>) => string|null,
   *   pauseMedia?: () => void, env?: GuardEnv }} options
   */
  function create(options = {}) {
    const real = {
      now: () => Date.now(),
      setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
      clearTimeout: (h) => globalThis.clearTimeout(h),
      read: () => AP.api.storage.local.get(['state', 'settings']),
      onStorageChange: (listener) => {
        const handler = (changes, area) => {
          if (area === 'local' && (changes.state || changes.settings)) listener();
        };
        AP.api.storage.onChanged.addListener(handler);
        return () => AP.api.storage.onChanged.removeListener(handler);
      },
      onWake: (listener) => {
        const onVisible = () => {
          if (document.visibilityState === 'visible') listener();
        };
        const onShow = () => listener();
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('pageshow', onShow);
        window.addEventListener('focus', onShow);
        return () => {
          document.removeEventListener('visibilitychange', onVisible);
          window.removeEventListener('pageshow', onShow);
          window.removeEventListener('focus', onShow);
        };
      },
      urlFor: (path) => AP.api.runtime.getURL(path),
      pageUrl: () => location.href,
      navigate: (url) => location.replace(url),
      closeTab: () => AP.msg.send(AP.msg.TYPES.CLOSE_TAB),
      showOverlay: (spec) => AP.overlay.show(spec),
      hideOverlay: () => AP.overlay.hide(),
      keepPaused: (on) => {
        if (on === (keepPausedHandler !== null)) return;
        if (on) {
          keepPausedHandler = (event) => event.target?.pause?.();
          document.addEventListener('play', keepPausedHandler, true); // 'play' does not bubble: capture
        } else {
          document.removeEventListener('play', keepPausedHandler, true);
          keepPausedHandler = null;
        }
      },
    };
    let keepPausedHandler = null;
    const env = { ...real, ...(options.env ?? {}) };

    let siteKey = options.siteKey ?? null;
    let snapshot = null;
    let timer = null;
    let started = false;
    let unsubscribe = [];
    let reading = null;
    const memory = { knownUntil: null, knownMinutes: null };
    let overlayFor = null; // the session end the overlay was shown for
    let redirected = false;

    const clearTimer = () => {
      if (timer !== null) env.clearTimeout(timer);
      timer = null;
    };

    function blockedUrl(reason) {
      return `${env.urlFor(BLOCKED_PAGE)}?reason=${encodeURIComponent(reason)}#${env.pageUrl()}`;
    }

    function takeABreath() {
      env.navigate(`${env.urlFor(PAUSE_PAGE)}#${env.pageUrl()}`);
    }

    async function leave() {
      let res;
      try {
        res = await env.closeTab();
      } catch {
        res = null;
      }
      if (!res?.ok) takeABreath(); // could not close the tab: the pause page is the next best calm place
    }

    function showExpiry(minutes) {
      try {
        options.pauseMedia?.();
      } catch (err) {
        AP.warn('could not pause the media', err);
      }
      env.keepPaused(true);
      env.showOverlay({
        title: expiryTitle(minutes),
        body: 'Close it, or take a breath first and choose again.',
        theme: snapshot?.theme ?? 'light',
        actions: [
          { label: `Leave ${options.siteName ?? 'this site'}`, primary: true, onClick: leave },
          { label: 'Take a breath', onClick: takeABreath },
        ],
      });
    }

    /** Applies the current snapshot. Idempotent: safe to call on every event. */
    function evaluate() {
      if (!snapshot || siteKey === null) return;
      const now = env.now();
      const decision = decide(snapshot, siteKey, now, memory);
      switch (decision.type) {
        case 'block':
          clearTimer();
          if (!redirected) {
            redirected = true;
            try {
              options.pauseMedia?.();
            } catch {
              /* the page is going away anyway */
            }
            env.navigate(blockedUrl(decision.block.reason));
          }
          break;
        case 'running':
          redirected = false;
          memory.knownUntil = decision.until;
          memory.knownMinutes = snapshot.sessionMinutes[siteKey] ?? null;
          if (overlayFor !== null) {
            overlayFor = null; // a new session started somewhere else: let the person back in
            env.hideOverlay();
            env.keepPaused(false);
          }
          clearTimer();
          timer = env.setTimeout(() => {
            timer = null;
            refresh();
          }, Math.min(decision.until - now + 50, MAX_TIMER_MS));
          break;
        case 'expired':
          clearTimer();
          if (overlayFor !== decision.until && snapshot.expiryOverlay) {
            overlayFor = decision.until;
            showExpiry(decision.minutes ?? memory.knownMinutes);
          }
          break;
        default:
          clearTimer();
          memory.knownUntil = null;
          if (overlayFor !== null) {
            overlayFor = null;
            env.hideOverlay();
            env.keepPaused(false);
          }
      }
    }

    /** Re-reads storage, then evaluates. Concurrent calls share one read. */
    function refresh() {
      reading ??= (async () => {
        try {
          const got = await env.read();
          snapshot = parseSnapshot(got);
          if (siteKey === null && options.resolveSiteKey) siteKey = options.resolveSiteKey(snapshot);
          evaluate();
        } catch (err) {
          AP.log('guard could not read state', err); // e.g. the extension was reloaded under this page
        } finally {
          reading = null;
        }
      })();
      return reading;
    }

    return {
      /** Starts watching. Returns once the first evaluation is done. */
      async start() {
        if (started) return;
        started = true;
        unsubscribe = [env.onStorageChange(() => refresh()), env.onWake(() => refresh())];
        await refresh();
      },
      stop() {
        started = false;
        clearTimer();
        for (const off of unsubscribe) off();
        unsubscribe = [];
        if (overlayFor !== null) {
          env.hideOverlay();
          env.keepPaused(false);
        }
        overlayFor = null;
      },
      refresh,
      /** The site this guard watches (null until resolved from the stored sites). */
      siteKey: () => siteKey,
      /** Test hook: the pure decision for the current snapshot. */
      peek: () => (snapshot && siteKey ? decide(snapshot, siteKey, env.now(), memory) : null),
    };
  }

  // ---------------------------------------------------------------------------------------
  // Heartbeats
  // ---------------------------------------------------------------------------------------

  /** Is a media element actually playing on this page? (Used so a playing video counts as "active" in an unfocused window.) */
  function mediaPlaying() {
    for (const m of document.querySelectorAll('video, audio')) {
      if (!m.paused && !m.ended && m.readyState > 2) return true;
    }
    return false;
  }

  /**
   * HEARTBEAT every 30 s while the page is visible AND (the window has focus OR media plays).
   * The background ignores beats closer than 25 s per site, so several tabs never double count.
   * @param {{ siteKey: string, env?: object }} options
   */
  function createHeartbeat({ siteKey, env: overrides = {} }) {
    const env = {
      now: () => Date.now(),
      visible: () => document.visibilityState === 'visible',
      active: () => document.hasFocus() || mediaPlaying(),
      send: () => AP.msg.send(AP.msg.TYPES.HEARTBEAT, { siteKey }),
      every: (fn, ms) => globalThis.setInterval(fn, ms),
      stopEvery: (h) => globalThis.clearInterval(h),
      onVisibility: (listener) => {
        document.addEventListener('visibilitychange', listener);
        return () => document.removeEventListener('visibilitychange', listener);
      },
      ...overrides,
    };
    let handle = null;
    let lastSent = -Infinity;
    let off = null;

    function tick() {
      if (!env.visible() || !env.active()) return;
      const now = env.now();
      if (now - lastSent < MIN_BEAT_GAP_MS) return;
      lastSent = now;
      Promise.resolve(env.send()).catch(() => {});
    }
    const sync = () => {
      if (env.visible() && handle === null) handle = env.every(tick, HEARTBEAT_MS);
      else if (!env.visible() && handle !== null) {
        env.stopEvery(handle);
        handle = null;
      }
    };
    return {
      start() {
        off = env.onVisibility(sync);
        sync();
      },
      stop() {
        off?.();
        if (handle !== null) env.stopEvery(handle);
        handle = null;
      },
      tick,
    };
  }

  AP.guard = { END_SLACK_MS, HEARTBEAT_MS, MIN_BEAT_GAP_MS, parseSnapshot, blockFor, siteKeyForHost, decide, expiryTitle, create, createHeartbeat, mediaPlaying };
})();
