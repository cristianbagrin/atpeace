// Chrome-only (test harness) service worker. Production is Firefox, where the manifest lists these
// same files under background.scripts. Keep this list identical to manifest.json
// background.scripts, in the same order. Paths are relative to THIS file, not the extension root.
importScripts(
  '../shared/namespace.js',
  '../shared/browser-api.js',
  '../shared/util.js',
  '../shared/messages.js',
  './background.js',
);
