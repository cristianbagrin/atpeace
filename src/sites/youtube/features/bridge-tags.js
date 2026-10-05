// Bridge tags (feature `bridgeTags`, Contract C5): switches the MAIN-world tagging on while at least
// one setting that needs the tags is on, and off again (tags removed) when none is.
//
// The attributes themselves (`data-at-peace-entry` on guide entries, `data-at-peace-tab` on channel
// tabs, `data-at-peace-action` on the buttons under the video) are written by page-bridge.js, which can
// read YouTube's own data objects; the CSS that uses them is generated from the catalog. The list of
// settings is not hand-kept: it is every catalog setting that is marked `feature: 'bridgeTags'` or whose
// CSS mentions one of the tags, so a new setting that uses them turns the bridge on by itself.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;
  const bridge = () => AP.yt.bridge;

  const TAG = /data-at-peace-(?:entry|tab|action)/;

  /** Ids of the settings that need bridge tags. */
  function tagSettings(defs) {
    const ids = [];
    for (const def of defs) {
      if (def.feature === 'bridgeTags' || TAG.test(JSON.stringify([def.hide ?? null, def.rules ?? null, def.variants ?? null]))) ids.push(def.id);
    }
    return ids;
  }

  let debugSent = false;

  AP.yt.features.push({
    id: 'bridgeTags',
    settings: tagSettings(AP.schema.all().filter((def) => String(def.id).startsWith('yt.'))),
    init() {
      bridge()?.call('setTags', true);
      if (AP.debug && !debugSent) {
        debugSent = true;
        bridge()?.call('setDebug', true);
      }
    },
    destroy() {
      bridge()?.call('setTags', false);
    },
  });

  AP.yt.bridgeTags = { tagSettings };
})();
