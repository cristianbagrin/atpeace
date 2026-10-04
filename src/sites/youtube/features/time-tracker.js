// Counts the time actually spent on YouTube (PLAN §5.4) for the stats and the daily limit: a
// HEARTBEAT every 30 s while the tab is visible and either the window has focus or a video plays.
// The background ignores beats closer than 25 s per site, so two open tabs never double count.
// The timing rules live in the shared helper (src/content/guard-core.js).
//
// ignoresMaster: usage is measured (and a daily limit enforced) whatever the master switch says.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;
  AP.yt ??= {};
  AP.yt.features ??= [];

  let heartbeat = null;

  AP.yt.features.push({
    id: 'time-tracker',
    settings: [],
    ignoresMaster: true,
    isActive: () => true,

    init() {
      heartbeat = AP.guard.createHeartbeat({ siteKey: 'youtube' });
      heartbeat.start();
    },

    destroy() {
      heartbeat?.stop();
      heartbeat = null;
    },
  });
})();
