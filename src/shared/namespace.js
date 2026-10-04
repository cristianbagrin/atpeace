// Must be the first script loaded in every context (content script, background, pages, tests).
// Creates the single global namespace that every other classic script attaches to (PLAN §3.1).
(() => {
  'use strict';

  const AP = (globalThis.AtPeace ??= {});

  /** Verbose logging switch. Off by default; options → Advanced → "Debug logs" turns it on. */
  AP.debug ??= false;

  /** Debug-only log. Silent unless `AP.debug` is true. */
  AP.log ??= (...args) => {
    if (AP.debug) console.log('[At Peace]', ...args);
  };

  /** Warning that is worth seeing even without debug (a feature failed; the rest keeps working). */
  AP.warn ??= (...args) => {
    console.warn('[At Peace]', ...args);
  };
})();
