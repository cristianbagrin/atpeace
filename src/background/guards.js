// Keeps the "guard" content script registered for the user-added sites (PLAN §8.3, step 4).
//
// A site the person adds to `pause.sites` needs a content script that shows the "your time is up"
// overlay, enforces blocks on tabs that are already open, and sends heartbeats. It can only run
// where the browser granted host access, and it is registered dynamically (scripting API) with
// one pattern per granted site. YouTube has its own scripts in the manifest and is never listed here.
//
// sync() is idempotent: it compares what is registered with what should be and changes only the
// difference. It runs at startup/install, when the settings change, and when permissions change.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;
  const bg = (AP.bg ??= {});

  const GUARD_ID = 'at-peace-guard';
  /** Files the guard needs, in order; paths are relative to the extension root. */
  const GUARD_FILES = Object.freeze([
    'src/shared/namespace.js',
    'src/shared/browser-api.js',
    'src/shared/util.js',
    'src/shared/messages.js',
    'src/shared/breath.js',
    'src/content/overlay.js',
    'src/content/guard-core.js',
    'src/content/guard.js',
  ]);

  /** The match pattern for a domain and all its subdomains. */
  const patternFor = (domain) => `*://*.${domain}/*`;

  /**
   * The patterns the guard should run on: every listed non-YouTube site whose access was granted.
   * Listed-but-disabled sites are included: a focus block may still target them.
   * @param {Record<string, any>} settings effective settings
   * @returns {Promise<string[]>}
   */
  async function wantedPatterns(settings) {
    const list = Array.isArray(settings['pause.sites']) ? settings['pause.sites'] : [];
    const patterns = [];
    for (const site of list) {
      if (site.siteKey === 'youtube' || typeof site.domain !== 'string') continue;
      const pattern = patternFor(site.domain);
      try {
        if (await AP.api.permissions.contains({ origins: [pattern] })) patterns.push(pattern);
      } catch {
        /* an unknown pattern: not granted */
      }
    }
    return [...new Set(patterns)].sort();
  }

  /** @returns {Promise<{ registered: string[] }>} the patterns now registered */
  function sync() {
    return bg.store.queue('guards', async () => {
      const scripting = AP.api.scripting;
      if (!scripting?.registerContentScripts || !AP.api.permissions?.contains) return { registered: [] };
      // The Chrome build asks for `scripting` only when a site is added (tools/build-chrome.mjs).
      if (!(await AP.api.permissions.contains({ permissions: ['scripting'] }).catch(() => false))) return { registered: [] };
      const patterns = await wantedPatterns(await AP.settings.effective());
      const existing = (await scripting.getRegisteredContentScripts({ ids: [GUARD_ID] }))[0];
      if (patterns.length === 0) {
        if (existing) await scripting.unregisterContentScripts({ ids: [GUARD_ID] });
        return { registered: [] };
      }
      const spec = { id: GUARD_ID, matches: patterns, js: [...GUARD_FILES], runAt: 'document_start', allFrames: false, persistAcrossSessions: true };
      const upToDate = existing && AP.util.deepEqual([...existing.matches].sort(), patterns) && AP.util.deepEqual(existing.js, spec.js);
      if (!existing) await scripting.registerContentScripts([spec]);
      else if (!upToDate) await scripting.updateContentScripts([spec]);
      return { registered: patterns };
    });
  }

  bg.guards = { GUARD_ID, GUARD_FILES, patternFor, wantedPatterns, sync };
})();
