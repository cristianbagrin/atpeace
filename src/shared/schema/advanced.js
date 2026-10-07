// Advanced settings (PLAN §6.3): the elements picked to hide, debug logs and the settings lock.
// Never part of presets. The lock is also kept out of export/import, otherwise importing a
// crafted file would be a way around it.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;

  const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
  const PAGE_RE = /^[a-z][a-z0-9-]*$/;
  const SITE_RE = /^[a-z0-9.-]{1,60}$/;
  const LOCK_MODES = ['none', 'password', 'friction'];

  /**
   * A rule made with the element picker: `{ id, selector, page, note, createdAt }` (+ optional
   * `site` so a later multi-site version applies it only where it was made). `page` null = every
   * page. Unsafe selectors (braces, semicolons, at-rules…) are dropped.
   * @param {unknown} raw
   * @returns {object|null}
   */
  function customRule(raw) {
    if (!AP.util.isPlainObject(raw)) return null;
    if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) return null;
    if (!AP.schema.isSafeSelector(raw.selector)) return null;
    const rule = {
      id: raw.id,
      selector: raw.selector.trim(),
      page: typeof raw.page === 'string' && PAGE_RE.test(raw.page) ? raw.page : null,
      note: typeof raw.note === 'string' ? raw.note.slice(0, 200) : '',
      createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : 0,
    };
    if (typeof raw.site === 'string' && SITE_RE.test(raw.site)) rule.site = raw.site;
    return rule;
  }

  const uniqueById = (list) => {
    const seen = new Set();
    return list.filter((r) => !seen.has(r.id) && seen.add(r.id));
  };

  /**
   * The settings lock: `{ mode: 'none' | 'password' | 'friction', ...a few flat fields }` (see
   * src/shared/lock.js). A password lock keeps `salt`, `hash` (PBKDF2-SHA256, base64) and
   * `iterations`; a friction lock keeps `waitSeconds` (10–600). Other flat primitives survive
   * (at most 8) so a newer version's fields are not lost. Fail-safe: a password lock without a
   * usable salt and hash could never be opened, so it counts as no lock at all.
   * @param {Record<string, unknown>} value
   * @returns {Record<string, unknown>}
   */
  function lock(value) {
    const out = { mode: LOCK_MODES.includes(value.mode) ? value.mode : 'none' };
    let extras = 0;
    for (const [key, v] of Object.entries(value)) {
      if (key === 'mode' || extras >= 8 || !/^[a-z][A-Za-z0-9]{0,31}$/.test(key)) continue;
      if ((typeof v === 'string' && v.length <= 512) || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) {
        out[key] = v;
        extras++;
      }
    }
    if (out.mode === 'password' && !(typeof out.salt === 'string' && out.salt !== '' && typeof out.hash === 'string' && out.hash !== '')) return { mode: 'none' };
    if (out.waitSeconds !== undefined) {
      const n = Math.round(Number(out.waitSeconds));
      if (Number.isFinite(n)) out.waitSeconds = Math.min(600, Math.max(10, n));
      else delete out.waitSeconds;
    }
    return out;
  }

  AP.schema.section({
    id: 'advanced',
    site: null,
    title: 'Advanced',
    order: 990,
    description: 'Hidden elements, logs and the settings lock.',
  });

  AP.schema.define('advanced', [
    {
      id: 'advanced.customRules',
      label: 'Elements I chose to hide',
      description: 'Remove one to bring it back.',
      type: 'list',
      default: [],
      item: customRule,
      normalize: uniqueById,
      maxItems: 500,
      preset: false,
      feature: 'engine',
    },
    {
      id: 'advanced.debug',
      label: 'Debug logs',
      description: 'Writes to the browser console.',
      type: 'toggle',
      default: false,
      advanced: true,
      preset: false,
      feature: 'engine',
    },
    {
      id: 'advanced.lock',
      label: 'Lock these settings',
      description: 'Showing more again takes an unlock.',
      type: 'object',
      default: { mode: 'none' },
      normalize: lock,
      preset: false,
      portable: false,
      feature: 'lock',
    },
  ]);
})();
