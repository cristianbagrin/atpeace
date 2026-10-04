// Channel pages: yt.channel.openVideosTab and yt.channel.hideTrailer.
//
// openVideosTab: opening a channel goes straight to its Videos tab. Full page loads are redirected by
//   DNR (AP.yt.redirects.dnrRules, key `channel-videos`); this file does the in-app side with the same
//   decision (AP.yt.redirects.rewrite): a click on a channel link, the Navigation API, a check after
//   each navigation. Only the bare channel root is redirected (/@handle, /channel/UC…, /c/x, /user/x),
//   never a sub-tab, and a click on the channel's own Home tab is respected: whoever presses "Home"
//   wants the Home tab, so that one navigation is let through.
//
// hideTrailer: CSS hides the featured video on the Home tab (schema/channel.js); here the video is
//   also paused, so a hidden trailer cannot keep playing (and playing sound) behind the page.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;
  const { redirects, shared } = AP.yt;

  const OPEN = 'yt.channel.openVideosTab';
  const TRAILER = 'yt.channel.hideTrailer';
  const HOME_TAB_GRACE_MS = 3000;
  const TRAILER_SEL = 'ytd-channel-video-player-renderer';

  let current = null; // ctx
  let homeClickAt = 0;
  let listening = false;

  const slice = (settings) => ({ [OPEN]: settings?.[OPEN] });
  const redirector = shared.createRedirector({
    target: (url) => {
      if (!current?.settings || current.settings[OPEN] !== true) return null;
      if (Date.now() - homeClickAt < HOME_TAB_GRACE_MS) return null;
      return redirects.rewrite(url, slice(current.settings));
    },
  });

  /** Remembers that the user pressed a channel's Home tab (the tab shape carries the bridge tag, or is the first tab). */
  function onTabClick(event) {
    try {
      const tab = (event.composedPath?.()[0] ?? event.target)?.closest?.('yt-tab-shape');
      if (!tab || !event.isTrusted) return;
      const tagged = tab.getAttribute('data-at-peace-tab');
      const isHome = tagged ? tagged === 'home' : tab.parentElement?.firstElementChild === tab;
      if (isHome) homeClickAt = Date.now();
    } catch {
      /* a click handler must never throw */
    }
  }

  function pauseTrailer(video) {
    if (video && !video.paused) video.pause();
  }

  function onPlay(event) {
    try {
      if (current?.settings?.[TRAILER] === true && event.target?.closest?.(TRAILER_SEL)) pauseTrailer(event.target);
    } catch {
      /* ignore */
    }
  }

  function pauseTrailers(root) {
    if (current?.settings?.[TRAILER] !== true || current.page !== 'channel') return;
    const list = root.querySelectorAll ? root.querySelectorAll(`${TRAILER_SEL} video`) : [];
    for (const video of list) pauseTrailer(video);
  }

  AP.yt.features.push({
    id: 'channel-tab',
    settings: [OPEN, TRAILER],
    observes: true,
    init(ctx) {
      current = ctx;
      redirector.start();
      if (!listening) {
        listening = true;
        window.addEventListener('click', onTabClick, true);
        document.addEventListener('play', onPlay, true);
      }
    },
    onNavigate(ctx) {
      current = ctx;
      redirector.check();
      pauseTrailers(document);
    },
    onSettings(ctx) {
      current = ctx;
      redirector.check();
      pauseTrailers(document);
    },
    onMutations(ctx, roots) {
      current = ctx;
      if (ctx.page !== 'channel' || ctx.settings[TRAILER] !== true) return;
      for (const root of roots) pauseTrailers(root);
    },
    destroy() {
      redirector.stop();
      if (listening) {
        listening = false;
        window.removeEventListener('click', onTabClick, true);
        document.removeEventListener('play', onPlay, true);
      }
      current = null;
    },
  });
})();
