// Layout nudge: when CSS changes the watch page's layout, YouTube's player keeps its old inner layout
// (found in the catalog screenshots: with the related column collapsed the player box was 1394 px wide
// but its control bar still ended at ~1057 px). YouTube re-measures the player on the window's `resize`
// event, so this feature dispatches one when a layout-affecting setting changes and after navigating to
// a watch page while one is on: once at once and once ~400 ms later (the CSS transition / lazy layout
// of the column may not have settled at the first one).
(() => {
  'use strict';
  const AP = globalThis.AtPeace;

  /** Settings whose CSS moves the player's edges: the related column, live chat, the guide (and the burger that opens it). */
  const LAYOUT_SETTINGS = [
    'yt.watch.hideRelated',
    'yt.watch.hideRelatedShorts',
    'yt.watch.hideRelatedChips',
    'yt.watch.hideLiveChat',
    'yt.watch.hideAmbientMode',
    'yt.guide.hideAll',
    'yt.guide.hideMini',
    'yt.masthead.hideGuideButton',
  ];
  const SECOND_MS = 400;
  const COALESCE_MS = 150;

  let timers = [];
  let lastNudge = 0;

  const resize = () => {
    try {
      window.dispatchEvent(new Event('resize'));
    } catch (err) {
      AP.log('[layout-nudge] resize failed', err);
    }
  };

  /** One resize right away (after the style change has been applied) and one a little later. */
  function nudge() {
    const now = Date.now();
    if (now - lastNudge < COALESCE_MS) return;
    lastNudge = now;
    for (const t of timers) clearTimeout(t);
    timers = [setTimeout(resize, 0), setTimeout(resize, SECOND_MS)];
  }

  AP.yt.features.push({
    id: 'layout-nudge',
    settings: LAYOUT_SETTINGS,
    onNavigate(ctx) {
      if (ctx.page === 'watch') nudge();
    },
    onSettings() {
      nudge();
    },
    destroy() {
      // A setting was turned off (or the extension too): the layout went back to what it was.
      nudge();
    },
  });

  AP.yt.layoutNudge = { LAYOUT_SETTINGS };
})();
