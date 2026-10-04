// Autoplay (yt.watch.disableAutoplay) and "do not start videos by themselves" (yt.watch.noAutoStart).
//
// disableAutoplay: the "Autoplay" switch in the player controls (`button.ytp-autonav-toggle`, state
//   in the inner `.ytp-autonav-toggle-button[aria-checked]`) is clicked off whenever it reads "on".
//   Verified live (docs/youtube-dom.md §4.2): the click flips aria-checked. It is re-read a second
//   later (YouTube re-renders the controls on each video), a bounded number of times per video, and
//   the player API is asked as well (bridge `setAutonav(false)`). If the "Up next in N s" countdown
//   ever shows anyway, its cancel button is pressed when the video ends.
//
// noAutoStart: the first `play` event of each new video that was not asked for by the user pauses
//   the video once (bridge `pauseVideo()`, DOM fallback). "Asked for" = a trusted click or play key
//   in the player after this navigation began. After that the user is never fought: replays,
//   seeking and every later play are left alone.
//
// Not verifiable without playback (no video in the cloud sandbox): the `play`/`ended` behaviour.
// The toggle click and the decision logic are tested (tests/unit/features.test.mjs, tests/e2e/features.spec.mjs).
(() => {
  'use strict';
  const AP = globalThis.AtPeace;
  const { shared } = AP.yt;
  const bridge = () => AP.yt.bridge;

  const AUTOPLAY = 'yt.watch.disableAutoplay';
  const NO_START = 'yt.watch.noAutoStart';

  /** Per video: at most this many toggle clicks (a toggle that keeps coming back is not ours to fight forever). */
  const MAX_CLICKS = 4;
  const RECHECK_MS = 1000;
  const THROTTLE_MS = 800;

  // ---- decision logic (pure, unit-tested) -------------------------------------------------------------------

  /**
   * Should this `play` event be paused? Once per video, and only when the user did not ask for it.
   * @param {{ videoId: string|null, handledFor: string|null, intentAt: number, navStartedAt: number }} s
   *        intentAt: time of the latest trusted click/play key in the player (0 = none);
   *        navStartedAt: time the navigation to this video began
   * @returns {boolean}
   */
  function shouldPauseOnPlay({ videoId, handledFor, intentAt, navStartedAt }) {
    if (!videoId || videoId === handledFor) return false;
    return !(intentAt >= navStartedAt && intentAt > 0);
  }

  // ---- state -----------------------------------------------------------------------------------------------------

  let current = null; // ctx
  let videoId = null;
  let clicks = 0;
  let lastCheck = 0;
  let recheckTimer = null;
  let bridgeAsked = false;
  // noAutoStart
  let handledFor = null;
  let navStartedAt = Date.now();
  let verifyTimer = null;
  let listening = false;

  const on = (id) => current?.settings?.[id] === true;

  // ---- disableAutoplay -------------------------------------------------------------------------------------------

  const toggleState = () => document.querySelector('ytd-watch-flexy .ytp-autonav-toggle-button');

  function ensureAutonavOff() {
    if (!on(AUTOPLAY) || current?.page !== 'watch') return;
    clearTimeout(recheckTimer);
    recheckTimer = null;
    lastCheck = Date.now();
    const state = toggleState();
    if (state?.getAttribute('aria-checked') === 'true') {
      if (clicks >= MAX_CLICKS) return;
      clicks++;
      const button = state.closest('button') ?? document.querySelector('ytd-watch-flexy button.ytp-autonav-toggle');
      button?.click();
    }
    if (!bridgeAsked) {
      bridgeAsked = true;
      bridge()?.call('setAutonav', false);
    }
    // Look again: the controls are re-rendered per video and the switch may not exist yet.
    if (clicks < MAX_CLICKS) recheckTimer = setTimeout(ensureAutonavOff, RECHECK_MS);
  }

  /** The "Up next" countdown overlay's cancel button, when it is showing. */
  function cancelCountdown() {
    if (!on(AUTOPLAY)) return;
    const overlay = document.querySelector('ytd-watch-flexy .ytp-autonav-endscreen-countdown-overlay');
    if (!overlay) return;
    const cancel = overlay.querySelector('.ytp-autonav-endscreen-upnext-cancel-button') ?? overlay.querySelector('.ytp-autonav-endscreen-upnext-button:not(.ytp-autonav-endscreen-upnext-play-button)');
    cancel?.click();
  }

  // ---- noAutoStart -----------------------------------------------------------------------------------------------

  const isMainVideo = (el) => el?.localName === 'video' && el === shared.mainVideo();

  function pauseNow(video) {
    const asked = bridge()?.call('pauseVideo');
    // No bridge (or no answer): the DOM works too, YouTube's player follows the media events.
    Promise.resolve(asked).then((res) => {
      if (!res?.ok && !video.paused) video.pause();
    });
  }

  function onPlay(event) {
    try {
      if (!on(NO_START) || current?.page !== 'watch' || !isMainVideo(event.target)) return;
      const id = shared.videoIdOf(location.href);
      const decision = shouldPauseOnPlay({ videoId: id, handledFor, intentAt: shared.inputs.lastPlayIntentAt, navStartedAt });
      if (!id) return;
      handledFor = id;
      if (!decision) return;
      const video = event.target;
      pauseNow(video);
      // Once more shortly after, in case the player started again by itself; never a third time.
      clearTimeout(verifyTimer);
      verifyTimer = setTimeout(() => {
        if (!video.paused && shared.inputs.lastPlayIntentAt < navStartedAt) pauseNow(video);
      }, 800);
    } catch (err) {
      AP.warn('noAutoStart failed', err);
    }
  }

  const onNavStart = () => {
    navStartedAt = Date.now();
    clicks = 0;
    bridgeAsked = false;
  };

  const onEnded = (event) => {
    if (!isMainVideo(event.target)) return;
    setTimeout(cancelCountdown, 400);
    setTimeout(cancelCountdown, 1500);
  };

  function listen() {
    if (listening) return;
    listening = true;
    shared.inputs.acquire();
    window.addEventListener('yt-navigate-start', onNavStart, true);
    document.addEventListener('play', onPlay, true);
    document.addEventListener('ended', onEnded, true);
  }

  function unlisten() {
    if (!listening) return;
    listening = false;
    shared.inputs.release();
    window.removeEventListener('yt-navigate-start', onNavStart, true);
    document.removeEventListener('play', onPlay, true);
    document.removeEventListener('ended', onEnded, true);
    clearTimeout(recheckTimer);
    clearTimeout(verifyTimer);
  }

  AP.yt.features.push({
    id: 'autoplay',
    settings: [AUTOPLAY, NO_START],
    observes: true,
    init(ctx) {
      current = ctx;
      navStartedAt = Date.now();
      listen();
    },
    onNavigate(ctx) {
      current = ctx;
      const id = shared.videoIdOf(ctx.url);
      if (id !== videoId) {
        videoId = id;
        clicks = 0;
        bridgeAsked = false;
      }
      ensureAutonavOff();
    },
    onSettings(ctx) {
      current = ctx;
      clicks = 0;
      bridgeAsked = false;
      ensureAutonavOff();
    },
    onMutations(ctx) {
      current = ctx;
      // The controls are re-rendered per video and can appear after the navigation events: check
      // again, but at most about once a second however busy the page is.
      if (on(AUTOPLAY) && ctx.page === 'watch' && Date.now() - lastCheck > THROTTLE_MS && toggleState()?.getAttribute('aria-checked') === 'true') ensureAutonavOff();
    },
    destroy() {
      unlisten();
      current = null;
    },
  });

  AP.yt.autoplay = { shouldPauseOnPlay };
})();
