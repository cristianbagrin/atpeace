// Theater mode (yt.watch.autoTheater): videos open in the wide layout.
//
//   - The cookie `wide=1` (domain .youtube.com, path /, a year) is what YouTube itself writes when
//     the theater button is pressed, and what it reads on a page load: set it while the setting is
//     on and a full load opens in theater mode. Verified live: a fresh jar holding `wide=1` opens a
//     watch page with `ytd-watch-flexy[theater]` already set (docs/youtube-dom.md §4.3).
//   - On in-app navigation to a watch page the page keeps its layout, so when `ytd-watch-flexy`
//     lacks `[theater]` the size button (`.ytp-size-button`) is clicked ONCE per video. After that
//     the user's own choice for that video is never touched.
// When the setting is off nothing here runs and nothing is undone: the user's layout is theirs.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;
  const { shared } = AP.yt;

  const ID = 'yt.watch.autoTheater';
  const ONE_YEAR = 365 * 24 * 60 * 60;
  const THROTTLE_MS = 400;
  const MAX_TRIES = 12;
  /**
   * The layout must lack `theater` for this long before the button is pressed: on a full load with
   * the cookie set, YouTube applies `theater` itself a moment after the button exists, and pressing
   * it in between would switch theater OFF.
   */
  const SETTLE_MS = 700;

  let current = null; // ctx
  let appliedFor = null; // video id the layout was decided for (done, or the user already had theater)
  let tries = 0;
  let lastTry = 0;
  let wantedSince = 0; // when the layout was first seen without theater (0 = not seen)
  let timers = [];

  function setCookie() {
    try {
      document.cookie = `wide=1; domain=.youtube.com; path=/; max-age=${ONE_YEAR}; samesite=lax; secure`;
    } catch (err) {
      AP.log('[theater] cookie not set', err);
    }
  }

  /**
   * What to do on a watch page: 'done' (theater is on, or the player is fullscreen: leave it),
   * 'click' (press the size button) or 'wait' (the page is not ready).
   * @param {{ flexyAttrs: string[]|null, hasButton: boolean }} s `flexyAttrs`: attribute names on ytd-watch-flexy (null = element missing)
   * @returns {'done'|'click'|'wait'}
   */
  function decide({ flexyAttrs, hasButton }) {
    if (!flexyAttrs || flexyAttrs.includes('hidden')) return 'wait';
    if (flexyAttrs.includes('theater') || flexyAttrs.includes('fullscreen')) return 'done';
    return hasButton ? 'click' : 'wait';
  }

  function attempt() {
    if (current?.settings?.[ID] !== true || current.page !== 'watch') return;
    const id = shared.videoIdOf(location.href);
    if (!id || appliedFor === id) return;
    lastTry = Date.now();
    const flexy = document.querySelector('ytd-watch-flexy');
    const button = document.querySelector('ytd-watch-flexy button.ytp-size-button');
    const verdict = decide({ flexyAttrs: flexy ? flexy.getAttributeNames() : null, hasButton: Boolean(button) });
    if (verdict !== 'click') wantedSince = 0;
    if (verdict === 'done') {
      appliedFor = id;
    } else if (verdict === 'click') {
      if (wantedSince === 0) {
        wantedSince = lastTry;
        timers.push(setTimeout(attempt, SETTLE_MS + 50));
      } else if (lastTry - wantedSince >= SETTLE_MS) {
        appliedFor = id; // once per video, whatever happens next
        wantedSince = 0;
        button.click();
      }
    } else if (tries++ < MAX_TRIES) {
      timers.push(setTimeout(attempt, 500)); // the player is still being built
    }
  }

  const clearTimers = () => {
    for (const t of timers) clearTimeout(t);
    timers = [];
  };

  AP.yt.features.push({
    id: 'theater',
    settings: [ID],
    observes: true,
    init(ctx) {
      current = ctx;
      setCookie();
    },
    onNavigate(ctx) {
      current = ctx;
      const id = shared.videoIdOf(ctx.url);
      if (id !== appliedFor) {
        tries = 0;
        wantedSince = 0;
        clearTimers();
      }
      attempt();
    },
    onSettings(ctx) {
      current = ctx;
      appliedFor = null; // switched on mid-video: apply to this one
      tries = 0;
      wantedSince = 0;
      setCookie();
      attempt();
    },
    onMutations(ctx) {
      current = ctx;
      // The size button appears after the navigation events: try again, at most every 400 ms.
      if (ctx.page === 'watch' && appliedFor !== shared.videoIdOf(ctx.url) && Date.now() - lastTry > THROTTLE_MS) attempt();
    },
    destroy() {
      clearTimers();
      current = null;
      appliedFor = null;
    },
  });

  AP.yt.theater = { decide };
})();
