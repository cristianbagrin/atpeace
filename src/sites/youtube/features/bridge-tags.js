// Bridge tags (feature `bridgeTags`, Contract C5): switches the MAIN-world tagging on while at least
// one setting that needs the tags is on, and off again (tags removed) when none is.
//
// The attributes themselves (`data-at-peace-entry` on guide entries, `data-at-peace-tab` on channel
// tabs, `data-at-peace-action` on the buttons under the video, `data-at-peace-shelf` on the rows of a channel's
// Home tab, `data-at-peace-channel-action` on its header buttons) are written by page-bridge.js, which can
// read YouTube's own data objects; the CSS that uses them is generated from the catalog. The list of
// settings is not hand-kept: it is every catalog setting that is marked `feature: 'bridgeTags'` or whose
// CSS mentions one of the tags, so a new setting that uses them turns the bridge on by itself.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;
  const bridge = () => AP.yt.bridge;

  const TAG = /data-at-peace-(?:entry|tab|action|shelf|channel-action)/;

  /** Ids of the settings that need bridge tags. */
  function tagSettings(defs) {
    const ids = [];
    for (const def of defs) {
      if (def.feature === 'bridgeTags' || TAG.test(JSON.stringify([def.hide ?? null, def.rules ?? null, def.variants ?? null]))) ids.push(def.id);
    }
    return ids;
  }

  let debugSent = false;
  let wanted = false;
  let timer = null;
  let attempts = 0;

  /** Asks the bridge to tag; if it does not answer (it can load a little after us), asks again a few times. */
  async function ensureOn() {
    clearTimeout(timer);
    timer = null;
    if (!wanted) return;
    const res = await bridge()?.call('setTags', true);
    if (res?.ok) {
      attempts = 0;
      if (AP.debug && !debugSent) {
        debugSent = true;
        bridge()?.call('setDebug', true);
      }
      return;
    }
    if (++attempts <= 6) {
      if (attempts === 1) AP.warn('page bridge did not answer yet; will retry', res?.error);
      timer = setTimeout(ensureOn, 2000 * attempts);
    }
  }

  AP.yt.features.push({
    id: 'bridgeTags',
    settings: tagSettings(AP.schema.all().filter((def) => String(def.id).startsWith('yt.'))),
    init() {
      wanted = true;
      attempts = 0;
      ensureOn();
    },
    onNavigate() {
      // Idempotent, and another chance when the bridge has not answered so far.
      if (attempts > 0 || !timer) ensureOn();
    },
    destroy() {
      wanted = false;
      clearTimeout(timer);
      timer = null;
      bridge()?.call('setTags', false);
    },
  });

  AP.yt.bridgeTags = { tagSettings };
})();
