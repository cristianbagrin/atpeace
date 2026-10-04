// YouTube MAIN-world script (runs in the page's own JS realm, document_start).
// Phase 0 stub: only proves that `world: "MAIN"` injection works. Later phases replace it with the
// nonce-guarded postMessage bridge to the player API (PLAN §7). Must not load or use AtPeace/AP.api.
(() => {
  'use strict';
  document.documentElement.setAttribute('data-at-peace-bridge', '1');
})();
