// YouTube content script entry (isolated world, document_start): wires the site-agnostic engine
// to YouTube. Feature files (src/sites/youtube/features/*) load before this and push into
// AP.yt.features.
(() => {
  'use strict';
  // Tests (and users debugging) rely on this attribute to know the content script ran at all.
  document.documentElement.setAttribute('data-at-peace-loaded', '1');

  const AP = globalThis.AtPeace;
  try {
    AP.engine.start({
      site: 'youtube',
      detectPage: AP.yt.page.detect,
      features: AP.yt.features,
      navStartEvents: ['yt-navigate-start'],
      navEvents: ['yt-navigate-finish', 'yt-page-data-updated'],
      targetUrl: AP.yt.page.urlFromNavigateEvent,
    });
  } catch (err) {
    AP.warn('engine failed to start', err);
  }
})();
