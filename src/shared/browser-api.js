// AP.api is THE extension API for all our code (PLAN §3.3): promise-based, `browser` in Firefox,
// `chrome` in Chrome MV3 (which is promise-based too when no callback is passed).
// Never touch `chrome.*` / `browser.*` directly anywhere else.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;

  AP.api = globalThis.browser ?? globalThis.chrome;
})();
