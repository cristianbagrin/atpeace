// Presets (PLAN §5.3): named bundles of setting values. Built-in ones live here and are read-only;
// custom ones are stored under `customPresets` (see settings.js for saving/renaming/deleting).
//
// Applying a preset means `settings := defaults ⊕ preset.values` for the settings a preset may
// touch ("in scope": every setting except those flagged `preset: false`, e.g. theme, schedules,
// the lock). Out-of-scope settings keep whatever the user has.
//
// The YouTube catalog is written in a separate phase, so built-in presets are not lists of ids but
// *recipes* resolved at runtime against whatever the registry holds:
//     values = parent preset  ⊕  bulkTargets(tag) for each tag  ⊕  explicit `set` ids
// (explicit ids win, so `yt.shorts.mode: 'watch'` can soften a tag's "block"). Ids that do not
// exist are skipped, never an error; AP.presets.diagnose() lists them so they can be reconciled.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;
  const { isPlainObject } = AP.util;

  const CUSTOM_ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
  const MAX_CUSTOM_PRESETS = 50;

  /**
   * @typedef {Object} PresetRecipe
   * @property {string} id
   * @property {string} name
   * @property {string} description
   * @property {string} [extends]   built-in preset whose values come first
   * @property {string[]} tags      tags whose targets are included
   * @property {Record<string, boolean|string|number>} set   explicit values (ids per PLAN §6.3)
   */

  /** @type {PresetRecipe[]} */
  const RECIPES = [
    {
      id: 'gentle',
      name: 'Gentle',
      description: 'Promotions, Shorts and AI extras go. Your feeds stay.',
      tags: ['ads', 'shorts', 'ai'],
      set: {
        // Shorts everywhere is hidden, but a shared Shorts link still opens in the normal player.
        'yt.shorts.mode': 'watch',
        'yt.general.hidePremiumUpsells': true,
        // Clutter in the masthead…
        'yt.masthead.hideCreate': true,
        'yt.masthead.hideVoiceSearch': true,
        'yt.masthead.hideCountryCode': true,
        // …and in the guide (sidebar).
        'yt.guide.hideMoreFromYouTube': true,
        'yt.guide.hideExploreSection': true,
        'yt.guide.hideFooter': true,
        'yt.guide.hideSignInPromo': true,
      },
    },
    {
      id: 'focused',
      name: 'Focused',
      description: 'Also no home feed, related videos, comments or autoplay.',
      extends: 'gentle',
      tags: ['comments'],
      set: {
        'yt.home.feedMode': 'hide',
        'yt.watch.hideRelated': true,
        'yt.player.hideEndscreenCards': true,
        'yt.player.hideEndscreenWall': true,
        'yt.comments.hideAll': true,
        'yt.comments.hideTeaser': true,
        'yt.watch.disableAutoplay': true,
        'yt.general.disableHoverPreview': true,
      },
    },
    {
      id: 'deep-work',
      name: 'Deep work',
      description: 'Your subscriptions only, grey and blurred, with a pause.',
      extends: 'focused',
      tags: ['metrics'],
      set: {
        'yt.home.feedMode': 'subscriptions',
        'yt.shorts.mode': 'block',
        'yt.search.hideShelves': true,
        'yt.search.hideRelatedSearches': true,
        'yt.general.thumbnails': 'blur',
        'yt.general.grayscale': true,
        'pause.enabled': true,
      },
    },
    {
      id: 'untouched',
      name: 'Untouched',
      description: 'Nothing hidden.',
      tags: [],
      set: {},
    },
  ];

  const recipeById = new Map(RECIPES.map((r) => [r.id, r]));

  /** Can a preset touch this setting? */
  const inScope = (def) => def.preset !== false;

  /**
   * Validates a values map against the registry: unknown ids, out-of-scope ids and unusable values
   * are dropped and reported; usable values are coerced (clamped numbers etc.).
   * @param {unknown} values
   * @returns {{ values: Record<string, any>, unknown: string[], outOfScope: string[], invalid: string[] }}
   */
  function sanitize(values) {
    const report = { values: {}, unknown: [], outOfScope: [], invalid: [] };
    if (!isPlainObject(values)) return report;
    for (const [id, raw] of Object.entries(values)) {
      const def = AP.schema.get(id);
      if (!def) report.unknown.push(id);
      else if (!inScope(def)) report.outOfScope.push(id);
      else {
        const { ok, value } = AP.schema.coerce(def, raw);
        if (ok) report.values[id] = value;
        else report.invalid.push(id);
      }
    }
    return report;
  }

  /** Resolves a recipe → `{ values, missing, invalid }` (missing = explicit ids not in the registry). */
  function resolve(recipe) {
    const wanted = {};
    if (recipe.extends) Object.assign(wanted, resolve(recipeById.get(recipe.extends)).values);
    for (const tag of recipe.tags) Object.assign(wanted, AP.schema.bulkTargets(tag));
    Object.assign(wanted, recipe.set);
    const { values, unknown, invalid } = sanitize(wanted);
    // Only ids written out in `set` can be "missing" for a reason worth reporting; parents report their own.
    const own = new Set(Object.keys(recipe.set));
    return { values, missing: unknown.filter((id) => own.has(id)), invalid: invalid.filter((id) => own.has(id)) };
  }

  /**
   * @typedef {Object} Preset
   * @property {string} id
   * @property {string} name
   * @property {string} [description]
   * @property {boolean} builtIn
   * @property {Record<string, any>} values  validated against the registry as it is NOW
   * @property {number} [createdAt]          custom presets only
   */

  function fromRecipe(recipe) {
    return { id: recipe.id, name: recipe.name, description: recipe.description, builtIn: true, values: resolve(recipe).values };
  }

  /** @returns {Preset[]} the built-in presets in menu order, values resolved now. */
  function builtIn() {
    return RECIPES.map(fromRecipe);
  }

  /**
   * One custom preset from storage, or null if it is unusable. Unknown/out-of-scope values are
   * dropped, so applying a custom preset can never touch the lock, schedules or theme.
   * @param {unknown} raw
   * @returns {Preset|null}
   */
  function sanitizeOne(raw) {
    if (!isPlainObject(raw)) return null;
    if (typeof raw.id !== 'string' || !CUSTOM_ID_RE.test(raw.id) || recipeById.has(raw.id)) return null;
    const name = typeof raw.name === 'string' ? raw.name.trim().slice(0, 60) : '';
    if (name === '') return null;
    return {
      id: raw.id,
      name,
      builtIn: false,
      values: sanitize(raw.values).values,
      createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : 0,
    };
  }

  /**
   * Cleans a stored `customPresets` array: bad entries and duplicate ids dropped, capped at 50.
   * @param {unknown} list
   * @returns {Preset[]}
   */
  function sanitizeCustom(list) {
    if (!Array.isArray(list)) return [];
    const seen = new Set();
    const out = [];
    for (const raw of list) {
      const preset = sanitizeOne(raw);
      if (preset && !seen.has(preset.id)) {
        seen.add(preset.id);
        out.push(preset);
      }
    }
    return out.slice(0, MAX_CUSTOM_PRESETS);
  }

  /**
   * Finds a preset by id: built-ins first, then `customPresets` (the stored array).
   * @param {string} id
   * @param {unknown} [customPresets]
   * @returns {Preset|undefined}
   */
  function get(id, customPresets = []) {
    const recipe = recipeById.get(id);
    if (recipe) return fromRecipe(recipe);
    return sanitizeCustom(customPresets).find((p) => p.id === id);
  }

  /**
   * The value map of a preset, validated: pass an id (built-in or custom) or a plain values map.
   * Unknown preset id → null.
   * @param {string|Record<string, any>} idOrValues
   * @param {unknown} [customPresets]
   * @returns {Record<string, any>|null}
   */
  function valuesFor(idOrValues, customPresets = []) {
    if (typeof idOrValues === 'string') return get(idOrValues, customPresets)?.values ?? null;
    return sanitize(idOrValues).values;
  }

  /**
   * "Save current as preset": the in-scope values of `settings` (stored or effective) that differ
   * from their defaults.
   * @param {Record<string, any>} settings
   * @returns {Record<string, any>}
   */
  function capture(settings) {
    const out = {};
    for (const def of AP.schema.all()) {
      if (!inScope(def) || !isPlainObject(settings) || !Object.hasOwn(settings, def.id)) continue;
      const { ok, value } = AP.schema.coerce(def, settings[def.id]);
      if (ok && !AP.util.deepEqual(value, def.default)) out[def.id] = value;
    }
    return out;
  }

  /**
   * Which explicit ids of each built-in recipe the registry does not know (yet) or rejects.
   * A diagnostic for reconciling presets with the YouTube catalog; empty arrays = all good.
   * @returns {Record<string, { missing: string[], invalid: string[] }>}
   */
  function diagnose() {
    return Object.fromEntries(
      RECIPES.map((r) => {
        const { missing, invalid } = resolve(r);
        return [r.id, { missing, invalid }];
      }),
    );
  }

  AP.presets = {
    DEFAULT_ID: 'gentle',
    MAX_CUSTOM_PRESETS,
    builtIn,
    get,
    valuesFor,
    capture,
    sanitize,
    sanitizeCustom,
    inScope,
    diagnose,
  };
})();
