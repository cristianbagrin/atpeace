// Content script for USER-ADDED sites (registered dynamically by src/background/guards.js once the
// person granted access to the site). It is deliberately small: no schema, no engine, no styles on
// the page. It works out which configured site this page belongs to, then runs the shared guard
// (session-expiry overlay, block redirect) and the heartbeat for the stats and the daily limit.
// YouTube has its own pair of features (session-guard, time-tracker) and never loads this file.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;
  if (!AP?.guard || window !== window.top) return; // only the top frame, never an embedded iframe

  const siteName = location.hostname.replace(/^www\./, '');

  const guard = AP.guard.create({
    siteName,
    resolveSiteKey: (snapshot) => AP.guard.siteKeyForHost(location.hostname, snapshot.sites),
    pauseMedia: () => {
      for (const media of document.querySelectorAll('video, audio')) media.pause();
    },
  });

  guard.start().then(() => {
    // The site key is only known once the stored list of sites has been read.
    const siteKey = guard.siteKey();
    if (siteKey) AP.guard.createHeartbeat({ siteKey }).start();
  });
})();
