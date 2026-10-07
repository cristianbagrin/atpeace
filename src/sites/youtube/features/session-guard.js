// Mindful Pause on the YouTube page itself (PLAN §8.3, §8.4): when the pause session ends, pause
// the video and show "Your 15 minutes are up." (Leave · Finish this video · Breathe again); when a
// focus, schedule or daily-limit block starts while YouTube is open, send the tab to the blocked page.
// The logic is the shared guard (src/content/guard-core.js); this file only plugs YouTube into it:
// how to pause and resume the video, and what "finish this video" means here.
//
// Finish this video: on a watch page the overlay can step aside and let the video play on. This file
// says when it must come back: the main video ends (`ended`, never an ad), or another page is opened
// (`yt-navigate-start`, the browser's Back/Forward). Opening the next video by autoplay is an
// `ended` first and a navigation second, so the overlay is up before the next video starts, and the
// guard pauses anything that plays while it is up.
//
// ignoresMaster: the master switch only governs how YouTube looks and behaves. It must never be a
// way out of a focus block or a pause (Phase 2 review), so this feature runs with it off too.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;
  AP.yt ??= {};
  AP.yt.features ??= [];

  const PLAYER = '#movie_player, ytd-player';

  /** The video of the watch page (not the muted preview that plays when you hover a thumbnail). */
  const mainVideo = () => document.querySelector('#movie_player video.html5-main-video, #movie_player video, ytd-player video') ?? document.querySelector('video');

  /** YouTube marks the player while an ad plays (in the same <video> element as the video itself). */
  const adShowing = () => Boolean(document.querySelector('#movie_player.ad-showing, #movie_player.ad-interrupting'));

  /** Which video a YouTube address is about: its id, or the whole path for a page without one (/live/ID, /shorts/ID, /). */
  function pageKey(url) {
    try {
      const u = new URL(url, location.href);
      return `${u.pathname}?v=${u.searchParams.get('v') ?? ''}`;
    } catch {
      return String(url);
    }
  }

  /** Stops playback: through the player API when the page bridge offers it, and on the element itself. */
  function pauseMedia(ctx) {
    for (const bridge of [ctx?.bridge, AP.yt?.bridge]) {
      try {
        if (typeof bridge?.pauseVideo === 'function') bridge.pauseVideo();
      } catch (err) {
        AP.log('bridge pauseVideo failed', err);
      }
    }
    for (const video of document.querySelectorAll('video')) video.pause();
  }

  /** Lets the video go on where it was (never restarts one that has ended). */
  function resumeMedia() {
    const video = mainVideo();
    if (video && !video.ended) video.play()?.catch?.(() => {});
  }

  const isPlaying = () => {
    const video = mainVideo();
    return Boolean(video && !video.paused && !video.ended);
  };

  /** Hooks for "Finish this video" (see FinishHooks in src/content/guard-core.js). */
  const finish = {
    /** A video to finish: this page is a watch page whose video has not ended, or `url` is another watch page. */
    available(url) {
      if (AP.yt.page.detect(url ?? location.href) !== 'watch') return false;
      if (url !== undefined && pageKey(url) !== pageKey(location.href)) return true;
      const video = mainVideo();
      return Boolean(video && !video.ended);
    },

    watch(onDone) {
      const here = pageKey(location.href);
      const onEnded = (event) => {
        const target = event.target;
        if (target !== mainVideo() || !target.closest?.(PLAYER) || adShowing()) return;
        onDone('ended');
      };
      const onNavigateStart = (event) => {
        const to = AP.yt.page.urlFromNavigateEvent(event);
        if (to && pageKey(to) === here) return; // the same video: a time link, the player redrawing
        onDone('navigate', { url: to });
      };
      const onPop = () => {
        if (pageKey(location.href) !== here) onDone('navigate', { url: location.href });
      };
      document.addEventListener('ended', onEnded, true); // media events do not bubble: capture
      window.addEventListener('yt-navigate-start', onNavigateStart, true);
      window.addEventListener('popstate', onPop, true);
      return () => {
        document.removeEventListener('ended', onEnded, true);
        window.removeEventListener('yt-navigate-start', onNavigateStart, true);
        window.removeEventListener('popstate', onPop, true);
      };
    },
  };

  AP.yt.sessionGuard = { finish, pageKey }; // for the unit tests

  let guard = null;

  AP.yt.features.push({
    id: 'session-guard',
    settings: ['pause.enabled'],
    ignoresMaster: true,
    isActive: () => true,

    init(ctx) {
      guard = AP.guard.create({
        siteKey: 'youtube',
        siteName: 'YouTube',
        pauseMedia: () => pauseMedia(ctx),
        resumeMedia,
        isPlaying,
        finish,
      });
      return guard.start();
    },

    destroy() {
      guard?.stop();
      guard = null;
    },
  });
})();
