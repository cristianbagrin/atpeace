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
// playlistAutoStart (needs noAutoStart): inside a playlist the user has started, the next videos may
//   start by themselves, so an album plays through. The first video of a playlist still waits for a
//   press of play; "started" = a video with this `list=` played with the user's consent in this tab.
//   Leaving the playlist (a watch page without that list) forgets it.
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
  const PLAYLIST = 'yt.watch.playlistAutoStart';

  /** Per video: at most this many toggle clicks (a toggle that keeps coming back is not ours to fight forever). */
  const MAX_CLICKS = 4;
  /** After a navigation the switch is looked at again once a second for this many seconds; later changes are caught by the mutation bus. */
  const MAX_RECHECKS = 5;
  const RECHECK_MS = 1000;
  const THROTTLE_MS = 800;

  // ---- decision logic (pure, unit-tested) -------------------------------------------------------------------

  /**
   * Should this `play` event be paused? Once per video, and only when the user did not ask for it.
   * @param {{ videoId: string|null, handledFor: string|null, intentAt: number, navStartedAt: number, inStartedList?: boolean }} s
   *        intentAt: time of the latest trusted click/play key in the player (0 = none);
   *        navStartedAt: time the navigation to this video began;
   *        inStartedList: the video belongs to a playlist the user already started and playlistAutoStart is on
   * @returns {boolean}
   */
  function shouldPauseOnPlay({ videoId, handledFor, intentAt, navStartedAt, inStartedList = false }) {
    if (!videoId || videoId === handledFor || inStartedList) return false;
    return !(intentAt >= navStartedAt && intentAt > 0);
  }

  /** The playlist id a watch URL carries (`list=`), or null. */
  function listIdOf(url) {
    try {
      const list = new URL(url, 'https://www.youtube.com').searchParams.get('list');
      return list && /^[\w-]{2,64}$/.test(list) ? list : null;
    } catch {
      return null;
    }
  }

  // ---- state -----------------------------------------------------------------------------------------------------

  let current = null; // ctx
  let videoId = null;
  let clicks = 0;
  let rechecks = 0;
  let lastCheck = 0;
  let recheckTimer = null;
  let bridgeAsked = false;
  // noAutoStart
  let handledFor = null;
  let navStartedAt = Date.now();
  let verifyTimer = null;
  // playlistAutoStart: the playlist a video of which played with the user's consent (null = none)
  let startedList = null;
  let listening = false;

  const on = (id) => current?.settings?.[id] === true;

  /** Is the page on a video of the playlist the user already started (and may it continue)? */
  const continuesPlaylist = () => on(PLAYLIST) && startedList !== null && listIdOf(location.href) === startedList;

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
    if (clicks < MAX_CLICKS && rechecks++ < MAX_RECHECKS) recheckTimer = setTimeout(ensureAutonavOff, RECHECK_MS);
  }

  /** A new video (or a settings change): the click and recheck budgets start over. */
  function resetBudgets() {
    clicks = 0;
    rechecks = 0;
    bridgeAsked = false;
  }

  /** The "Up next" countdown overlay's cancel button, when it is showing. */
  function cancelCountdown() {
    if (!on(AUTOPLAY) || continuesPlaylist()) return;
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
      const intentAt = shared.inputs.lastPlayIntentAt;
      const inStartedList = continuesPlaylist();
      const decision = shouldPauseOnPlay({ videoId: id, handledFor, intentAt, navStartedAt, inStartedList });
      if (!id) return;
      handledFor = id;
      // The user pressed play (or is inside a playlist they started): that playlist may now continue by
      // itself. The player restarting on its own after our pause is not consent, so it does not count.
      if (inStartedList || (intentAt > 0 && intentAt >= navStartedAt)) startedList = listIdOf(location.href);
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
    resetBudgets();
  };

  /** A watch page outside the started playlist ends it; other pages (search, home) leave it be. */
  function forgetLeftPlaylist(url) {
    if (startedList !== null && shared.videoIdOf(url) && listIdOf(url) !== startedList) startedList = null;
  }

  /**
   * A video starts playing: the player builds its controls then. In Firefox an unstarted player keeps them
   * hidden and a click on the switch does nothing (measured, headless Firefox 157: aria-checked stays
   * "true"), so the budget spent on those clicks is given back and the switch is looked at again once
   * the controls exist.
   */
  const onStarted = (event) => {
    try {
      if (!on(AUTOPLAY) || !isMainVideo(event.target)) return;
      resetBudgets();
      setTimeout(ensureAutonavOff, 500);
    } catch (err) {
      AP.warn('autoplay start handler failed', err);
    }
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
    document.addEventListener('playing', onStarted, true);
    document.addEventListener('ended', onEnded, true);
  }

  function unlisten() {
    if (!listening) return;
    listening = false;
    shared.inputs.release();
    window.removeEventListener('yt-navigate-start', onNavStart, true);
    document.removeEventListener('play', onPlay, true);
    document.removeEventListener('playing', onStarted, true);
    document.removeEventListener('ended', onEnded, true);
    clearTimeout(recheckTimer);
    clearTimeout(verifyTimer);
  }

  AP.yt.features.push({
    id: 'autoplay',
    settings: [AUTOPLAY, NO_START, PLAYLIST],
    observes: true,
    init(ctx) {
      current = ctx;
      navStartedAt = Date.now();
      listen();
    },
    onNavigate(ctx) {
      current = ctx;
      forgetLeftPlaylist(ctx.url);
      const id = shared.videoIdOf(ctx.url);
      if (id !== videoId) {
        videoId = id;
        resetBudgets();
      }
      ensureAutonavOff();
    },
    onSettings(ctx) {
      current = ctx;
      resetBudgets();
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

  AP.yt.autoplay = { shouldPauseOnPlay, listIdOf };
})();
