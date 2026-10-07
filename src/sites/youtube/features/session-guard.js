// Mindful Pause on the YouTube page itself (PLAN §8.3, §8.4): when the pause session ends, pause
// the video and show "Your 15 minutes are up" (Leave / Take a breath); when a focus, schedule or
// daily-limit block starts while YouTube is open, send the tab to the blocked page. The logic is
// the shared guard (src/content/guard-core.js); this file only plugs YouTube into it.
//
// ignoresMaster: the master switch only governs how YouTube looks and behaves. It must never be a
// way out of a focus block or a pause (Phase 2 review), so this feature runs with it off too.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;
  AP.yt ??= {};
  AP.yt.features ??= [];

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

  let guard = null;

  AP.yt.features.push({
    id: 'session-guard',
    settings: ['pause.enabled'],
    ignoresMaster: true,
    isActive: () => true,

    init(ctx) {
      guard = AP.guard.create({ siteKey: 'youtube', siteName: 'YouTube', pauseMedia: () => pauseMedia(ctx) });
      return guard.start();
    },

    destroy() {
      guard?.stop();
      guard = null;
    },
  });
})();
