// Settings registry, validation and CSS compiler (PLAN §4). Loaded in EVERY context (content
// script, background, pages). It is the single source of truth for every user-facing option:
// defaults, validation, popup/options UI, presets and the CSS that hides things.
//
// =============================================================================================
// HOW TO DEFINE SETTINGS  (reference for src/sites/youtube/schema/*.js and any future site)
// =============================================================================================
//
//   (() => {
//     'use strict';
//     const AP = globalThis.AtPeace;
//
//     AP.schema.section({ id: 'yt.home', site: 'youtube', title: 'Home', order: 130,
//                         description: 'The feed you land on.' });
//
//     AP.schema.define('yt.home', [
//       { id: 'yt.home.hideChips', label: 'Hide the category bar', type: 'toggle', default: false,
//         description: 'Removes the topic chips above the feed.',
//         hide: ['ytd-browse[page-subtype="home"] #chips-wrapper'], page: 'home', tags: ['clutter'] },
//       { id: 'yt.general.thumbnails', label: 'Thumbnails', type: 'select', default: 'show',
//         options: [{ value: 'show', label: 'Show' }, { value: 'blur', label: 'Blur' }],
//         variants: { blur: { rules: [':scope-on ytd-thumbnail img { filter: blur(14px) !important; }'] } } },
//     ]);
//   })();
//
// SECTIONS      { id, site, title, icon?, order, description }
//   id           unique. Convention: cross-site sections are plain ('general', 'pause', 'focus',
//                'advanced'); site sections are prefixed with the site prefix ('yt.home').
//   site         'youtube' for site sections; omit (null) for cross-site sections.
//   order        sort key. General = 10, YouTube sections 100-899, Pause/Focus/Advanced 900+.
//   The cross-site 'general' section (master switch, theme) already uses the title "General":
//   give your site-wide section ('yt.general') a different title so the options page can tell them apart.
//
// SETTINGS      (SettingDef, see the typedef below)
//   id           'yt.home.hideChips'. Site settings START with the site prefix ('yt' → 'youtube');
//                everything else is cross-site ('pause.enabled'). Only [A-Za-z0-9_-] segments
//                joined by dots; at least two segments. NEVER rename after release.
//   Site of a setting = its prefix before the first dot IF it is a known site prefix
//   (AP.schema.SITE_PREFIXES), otherwise cross-site. A setting must live in a section of the
//   same site (validateRegistry checks this). Cross-site settings never carry CSS.
//   Option values: [A-Za-z0-9._-] only (they end up inside an attribute selector).
//
// HOW CSS WORKS (PLAN §4.2)
//   compileCss('youtube') emits ONE RULE PER SELECTOR, each gated by the active-token attribute
//   on <html>, so toggling a setting is one attribute write and a bad selector can only void its
//   own rule:
//     toggle  hide: ['A', 'B']  →  html[data-at-peace~="<id>"] A { display: none !important; }
//                                  html[data-at-peace~="<id>"] B { display: none !important; }
//     select  variants.<value>  →  same, gated by the token "<id>=<value>"
//     page: 'watch'             →  adds :is([data-at-peace-page="watch"],[data-at-peace-next="watch"])
//                                  to the SAME html compound (the second form is only present while
//                                  a navigation to a watch page is in flight; see engine.js).
//     rules: [':scope-on X { … }']  full rules; every ':scope-on' is replaced by the gate, e.g.
//                                  ':scope-on ytd-thumbnail img { filter: blur(14px) !important }'
//                                  → 'html[data-at-peace~="<id>"] ytd-thumbnail img { … }'.
//                                  ':scope-on { … }' with nothing after it styles <html> itself.
//   Each `hide` entry is ONE selector (commas inside :is()/:has()/[attr="a,b"] are fine, a
//   top-level comma is reported by validateRegistry); selectors must not contain '{', '}', ';', '@'
//   or '/*' outside strings. A `rules` entry is exactly one block that starts with ':scope-on' (or
//   '@media'/'@supports' wrapping such blocks). `rules` are written by you: add `!important`
//   yourself where YouTube's own styles must lose.
//   AP.schema.compileRules(site) is the same output as an array (one entry = one CSS rule).
//   A setting that has no `hide`/`rules`/`variants` must name the JS `feature` that reads it.
//
// TAGS (bulk actions): shorts recommendations comments ai metrics ads clutter player behaviour.
//   Bulk "hide all <tag>" sets toggles to true and selects to `bulkValue` (default: the LAST
//   option, so order select options from least hidden to most hidden).
//
// REQUIRES      requires: 'pause.enabled'          the row is switched off until that setting is on
//               requires: 'yt.home.feedMode=custom'  …until that select holds exactly this value
//               requires: 'yt.home.feedMode!=show'   …until that select holds anything else
//               (AP.schema.parseRequires(); the options page and popup grey the row out and say why.)
// SHORT LABELS  options: [{ value, label, short? }]   `short` is used where space is tight (the popup).
//
// OPTIONAL HOOKS (functions live only in the registry, never in storage):
//   item(raw) → normalized | null      per element of a 'list' (null drops it). No hook = a list
//                                      of trimmed, de-duplicated strings. A list WITH `options`
//                                      is a multi-select: items must be option values.
//   normalize(value) → value|undefined last step for ANY type; undefined rejects (→ default).
//   preset: false                      keep out of presets (apply / "save current as preset").
//                                      Use for preferences that are not "how YouTube looks"
//                                      (theme, pause details, schedules, lock …).
//   portable: false                    keep out of export/import (e.g. the settings lock).
//
// Everything below this comment is machinery. validateRegistry() lists every mistake it can find
// as plain sentences; unit tests assert it returns [] for the shipped schema.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;
  const { isPlainObject, deepEqual } = AP.util;

  /**
   * @typedef {Object} SettingDef
   * @property {string} id            Stable key ('yt.home.hideChips', 'pause.enabled').
   * @property {string} [section]     Filled in by define(); do not set by hand.
   * @property {string} [group]       Sub-heading inside the section ("Sidebar").
   * @property {string} label         Short, plain: "Hide comments".
   * @property {string} [description] One sentence: what exactly disappears / happens.
   * @property {'toggle'|'select'|'number'|'text'|'textarea'|'list'|'object'} type
   * @property {*} default
   * @property {{value:string,label:string,short?:string}[]} [options]  'select' choices (or the allowed items of a multi-select 'list'). `short` is a brief label for tight spaces (the popup).
   * @property {number} [min] @property {number} [max] @property {number} [step]  'number' bounds. With `step`, values snap to min + k*step.
   * @property {number} [maxLength]   'text'/'textarea': longer input is rejected (defaults 1000 / 50000).
   * @property {number} [maxItems]    'list': extra items are dropped.
   * @property {string} [unit]        'seconds' | 'minutes' | '%' … (UI only)
   * @property {string[]} [tags]      Bulk-action groups (see header).
   * @property {string} [page]        Page type that scopes the CSS (YouTube: AP.yt.page.TYPES). Omit = all pages.
   * @property {string[]} [hide]      (toggle) selectors set to display:none when ON.
   * @property {Object<string,{hide?:string[], rules?:string[]}>} [variants]  (select) per-value CSS, key = option value.
   * @property {string[]} [rules]     (toggle) full CSS rules using the `:scope-on` placeholder.
   * @property {string} [bulkValue]   (select) value the bulk "hide all" action sets (default: last option).
   * @property {string} [feature]     JS feature that reads this setting (docs + validation).
   * @property {string} [requires]    Another setting that must be on for this to matter: 'id' (truthy / not the default),
   *                                  'id=value' (a select that must hold that value) or 'id!=value'. See parseRequires().
   * @property {boolean} [advanced]   Hidden behind "Show advanced".
   * @property {boolean} [quick]      Offered as a popup quick toggle.
   * @property {boolean} [preset]     false = not part of presets (default true).
   * @property {boolean} [portable]   false = not exported / not imported (default true).
   * @property {string} [since]       Version added ('0.1.0').
   * @property {(raw:any) => any} [item]       list item normalizer (null drops the item).
   * @property {(value:any) => any} [normalize] final normalizer, undefined rejects.
   */

  /**
   * @typedef {Object} SectionDef
   * @property {string} id
   * @property {string|null} [site]
   * @property {string} title
   * @property {string} [icon]
   * @property {number} order
   * @property {string} [description]
   */

  /** Site prefix (first id segment) → site key. Add a line here when a new site gets settings. */
  const SITE_PREFIXES = Object.freeze({ yt: 'youtube' });
  const SITE_KEYS = Object.freeze(Object.values(SITE_PREFIXES));

  /** The master switch. Its token gates every rule; when it is off nothing is injected/hidden. */
  const MASTER_ID = 'general.enabled';

  /** Attribute names on <html> shared by the schema compiler, the engine and the tests. */
  const ATTR = Object.freeze({
    tokens: 'data-at-peace',
    page: 'data-at-peace-page',
    /** Page type a navigation is heading to; set only while a navigation is in flight (see engine.js). */
    next: 'data-at-peace-next',
    filtered: 'data-at-peace-filtered',
  });

  const SCOPE = ':scope-on';
  const TYPES = ['toggle', 'select', 'number', 'text', 'textarea', 'list', 'object'];
  const KNOWN_TAGS = ['shorts', 'recommendations', 'comments', 'ai', 'metrics', 'ads', 'clutter', 'player', 'behaviour'];
  const ID_RE = /^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)+$/;
  const VALUE_RE = /^[A-Za-z0-9._-]+$/;
  const PAGE_RE = /^[a-z][a-z0-9-]*$/;
  const VERSION_RE = /^\d+\.\d+\.\d+$/;
  const KNOWN_KEYS = new Set([
    'id', 'section', 'group', 'label', 'description', 'type', 'default', 'options', 'min', 'max', 'step',
    'maxLength', 'maxItems', 'unit', 'tags', 'page', 'hide', 'variants', 'rules', 'bulkValue', 'feature',
    'requires', 'advanced', 'quick', 'preset', 'portable', 'since', 'item', 'normalize',
  ]);
  const DEFAULT_MAX_LENGTH = { text: 1000, textarea: 50_000 };
  const DEFAULT_ITEM_LENGTH = 500;
  const MAX_OBJECT_JSON = 20_000;
  /** Longest `short` option label: what still fits the popup's select without an ellipsis. */
  const MAX_SHORT_LABEL = 16;

  /** @type {Map<string, SectionDef>} */
  const sectionById = new Map();
  /** @type {Map<string, SettingDef>} */
  const settingById = new Map();
  /** Registration order is display order inside a section. @type {SettingDef[]} */
  const settingList = [];
  /** Problems found while registering (duplicates, malformed input), reported by validateRegistry(). */
  const registrationProblems = [];
  /** site → Set of valid page types, filled by the site's page.js. */
  const sitePages = new Map();
  /** site → { rules, css }. Cleared whenever the registry changes. */
  let cssCache = new Map();

  // ---------------------------------------------------------------------------------------
  // Registration
  // ---------------------------------------------------------------------------------------

  /**
   * Site key of a setting id: 'yt.x.y' → 'youtube'; anything without a known site prefix → null
   * (cross-site).
   * @param {string} id
   * @returns {string|null}
   */
  function siteOf(id) {
    if (typeof id !== 'string') return null;
    const dot = id.indexOf('.');
    if (dot <= 0) return null;
    const prefix = id.slice(0, dot);
    return Object.hasOwn(SITE_PREFIXES, prefix) ? SITE_PREFIXES[prefix] : null;
  }

  /**
   * Registers a section. Never throws; mistakes show up in validateRegistry().
   * @param {SectionDef} def
   */
  function section(def) {
    if (!isPlainObject(def) || typeof def.id !== 'string' || def.id === '') {
      registrationProblems.push('section(): a section definition without an id was ignored');
      return;
    }
    if (sectionById.has(def.id)) {
      registrationProblems.push(`section "${def.id}": registered twice (the second one was ignored)`);
      return;
    }
    sectionById.set(def.id, Object.freeze({ ...def, site: def.site ?? null }));
    cssCache = new Map();
  }

  /**
   * Registers settings in a section (call section() first). Never throws; malformed or duplicate
   * entries are skipped and reported by validateRegistry().
   * @param {string} sectionId
   * @param {SettingDef[]} defs
   */
  function define(sectionId, defs) {
    if (!Array.isArray(defs)) {
      registrationProblems.push(`define("${sectionId}"): expected an array of settings`);
      return;
    }
    for (const raw of defs) {
      if (!isPlainObject(raw) || typeof raw.id !== 'string' || raw.id === '') {
        registrationProblems.push(`define("${sectionId}"): a setting without an id was ignored`);
        continue;
      }
      if (raw.section !== undefined && raw.section !== sectionId) {
        registrationProblems.push(`${raw.id}: says section "${raw.section}" but was defined in "${sectionId}"`);
      }
      if (settingById.has(raw.id)) {
        registrationProblems.push(`${raw.id}: defined twice (the second definition was ignored)`);
        continue;
      }
      const def = Object.freeze({ ...raw, section: sectionId });
      settingById.set(def.id, def);
      settingList.push(def);
    }
    cssCache = new Map();
  }

  /**
   * Tells the registry which page types a site has, so validateRegistry() can catch a `page:`
   * typo (a rule that silently never matches). Called by the site's page.js.
   * @param {string} site
   * @param {string[]} pages
   */
  function registerPages(site, pages) {
    sitePages.set(site, new Set(pages));
  }

  // ---------------------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------------------

  /** @returns {SettingDef[]} every setting, registration order (a new array; defs are frozen). */
  function all() {
    return settingList.slice();
  }

  /** @param {string} id @returns {SettingDef|undefined} */
  function get(id) {
    return typeof id === 'string' ? settingById.get(id) : undefined;
  }

  /**
   * Sections sorted by `order`. No argument: all of them. `{ site: 'youtube' }`: that site's
   * sections plus the cross-site ones. `{ site: null }`: only the cross-site ones.
   * @param {{ site?: string|null }} [filter]
   * @returns {SectionDef[]}
   */
  function sections(filter) {
    const list = [...sectionById.values()];
    const order = new Map(list.map((s, i) => [s.id, i]));
    list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || order.get(a.id) - order.get(b.id));
    if (!filter || filter.site === undefined) return list;
    if (filter.site === null) return list.filter((s) => s.site === null);
    return list.filter((s) => s.site === null || s.site === filter.site);
  }

  /** @param {string} sectionId @returns {SettingDef[]} */
  function bySection(sectionId) {
    return settingList.filter((d) => d.section === sectionId);
  }

  /** @param {string} tag @returns {SettingDef[]} */
  function byTag(tag) {
    return settingList.filter((d) => d.tags?.includes(tag));
  }

  function cloneDefault(def) {
    return def.default !== null && typeof def.default === 'object' ? structuredClone(def.default) : def.default;
  }

  /**
   * Fresh `{ id: defaultValue }` map for every registered setting (list/object defaults are
   * copies, so callers may mutate the result).
   * @returns {Record<string, any>}
   */
  function defaults() {
    const out = {};
    for (const def of settingList) out[def.id] = cloneDefault(def);
    return out;
  }

  // ---------------------------------------------------------------------------------------
  // Validation
  // ---------------------------------------------------------------------------------------

  const decimals = (n) => (String(n).split('.')[1] ?? '').length;

  /** Trimmed, non-empty, short, de-duplicated strings: the default shape of a 'list'. */
  function plainStringList(items) {
    const out = [];
    for (const raw of items) {
      if (typeof raw !== 'string') continue;
      const s = raw.trim();
      if (s === '' || s.length > DEFAULT_ITEM_LENGTH || out.includes(s)) continue;
      out.push(s);
    }
    return out;
  }

  /**
   * Core of validateValue: `{ ok, value }`. `ok: false` means the input was unusable and `value`
   * is the default (callers such as save() report that instead of storing the default silently).
   * Out-of-range numbers are not a failure: they are clamped.
   * @param {SettingDef} def
   * @param {unknown} input
   * @returns {{ ok: boolean, value: any }}
   */
  function coerce(def, input) {
    const fail = () => ({ ok: false, value: cloneDefault(def) });
    try {
      let value;
      switch (def.type) {
        case 'toggle':
          if (typeof input !== 'boolean') return fail();
          value = input;
          break;

        case 'select': {
          const s = typeof input === 'number' ? String(input) : input;
          if (typeof s !== 'string' || !def.options?.some((o) => o.value === s)) return fail();
          value = s;
          break;
        }

        case 'number': {
          const n = typeof input === 'string' && input.trim() !== '' ? Number(input) : input;
          if (typeof n !== 'number' || !Number.isFinite(n)) return fail();
          const min = def.min ?? -Infinity;
          const max = def.max ?? Infinity;
          value = AP.util.clamp(n, min, max);
          if (def.step > 0) {
            const base = Number.isFinite(min) ? min : 0;
            const snapped = base + Math.round((value - base) / def.step) * def.step;
            value = AP.util.clamp(Number(snapped.toFixed(Math.max(decimals(def.step), decimals(base)))), min, max);
          }
          break;
        }

        case 'text':
        case 'textarea': {
          if (typeof input !== 'string') return fail();
          if (input.length > (def.maxLength ?? DEFAULT_MAX_LENGTH[def.type])) return fail();
          value = input;
          break;
        }

        case 'list': {
          if (!Array.isArray(input)) return fail();
          let items;
          if (def.options) {
            const allowed = new Set(def.options.map((o) => o.value));
            items = input.filter((v, i) => typeof v === 'string' && allowed.has(v) && input.indexOf(v) === i);
          } else if (typeof def.item === 'function') {
            items = input.map((raw) => def.item(raw)).filter((x) => x !== null && x !== undefined);
          } else {
            items = plainStringList(input);
          }
          if (def.maxItems > 0) items = items.slice(0, def.maxItems);
          value = structuredClone(items);
          break;
        }

        case 'object': {
          if (!isPlainObject(input)) return fail();
          const json = JSON.stringify(input);
          if (json.length > MAX_OBJECT_JSON) return fail();
          value = JSON.parse(json); // JSON-safe, detached copy
          break;
        }

        default:
          return fail();
      }

      if (typeof def.normalize === 'function') {
        const normalized = def.normalize(value);
        if (normalized === undefined) return fail();
        value = normalized;
      }
      return { ok: true, value };
    } catch {
      return fail(); // a throwing hook or hostile input must never break callers
    }
  }

  /**
   * Coerces `value` into a valid value for `def`, or returns the default. Never throws.
   * toggle: boolean · select: an option value (numbers are stringified) · number: finite, clamped
   * to min/max and snapped to `step` (numeric strings accepted) · text/textarea: string within
   * the length limit · list: array normalized by `options`/`item`/trimmed strings · object: plain
   * JSON object. `def.normalize` runs last.
   * @param {SettingDef} def
   * @param {unknown} value
   * @returns {any}
   */
  function validateValue(def, value) {
    return coerce(def, value).value;
  }

  /** The value a bulk "hide all" action sets for a select. */
  function bulkValue(def) {
    return def.bulkValue ?? def.options?.at(-1)?.value;
  }

  /**
   * Values that "hide everything" for the settings carrying `tag`:
   * `{ [id]: true }` for toggles, `{ [id]: bulkValue }` for selects. Other types are skipped.
   * @param {string} tag
   * @returns {Record<string, boolean|string>}
   */
  function bulkTargets(tag) {
    const out = {};
    for (const def of byTag(tag)) {
      if (def.type === 'toggle') out[def.id] = true;
      else if (def.type === 'select') {
        const v = bulkValue(def);
        if (v !== undefined) out[def.id] = v;
      }
    }
    return out;
  }

  /**
   * Does `value` turn the setting "on" relative to the everything-off baseline? toggle: true;
   * select: anything but the default; other types: non-empty / non-zero.
   * @param {SettingDef} def
   * @param {unknown} value
   * @returns {boolean}
   */
  function isHidingValue(def, value) {
    switch (def.type) {
      case 'toggle':
        return value === true;
      case 'select':
        return typeof value === 'string' && value !== def.default;
      case 'number':
        return typeof value === 'number' && value !== 0;
      case 'list':
        return Array.isArray(value) && value.length > 0;
      case 'text':
      case 'textarea':
        return typeof value === 'string' && value !== '';
      default:
        return false;
    }
  }

  // ---------------------------------------------------------------------------------------
  // `requires`
  // ---------------------------------------------------------------------------------------

  const REQUIRES_RE = /^([A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+)(?:(!?=)([A-Za-z0-9._-]+))?$/;

  /**
   * Parses a `requires` string: 'id' (truthy), 'id=value' or 'id!=value'. Returns null when it is
   * not well formed.
   * @param {unknown} text
   * @returns {{ id: string, op: 'truthy'|'='|'!=', value: string|null }|null}
   */
  function parseRequires(text) {
    if (typeof text !== 'string') return null;
    const m = REQUIRES_RE.exec(text);
    if (!m) return null;
    return { id: m[1], op: m[2] ?? 'truthy', value: m[3] ?? null };
  }

  /**
   * Does the current value of the setting `requires` points at satisfy it? 'id' means "on" in the
   * sense of isHidingValue; 'id=value' compares the value as text (so it also works for toggles
   * with 'true'/'false').
   * @param {{ op: string, value: string|null }} cond result of parseRequires()
   * @param {SettingDef} dep the setting it points at
   * @param {unknown} value that setting's current value
   * @returns {boolean}
   */
  function requiresMet(cond, dep, value) {
    if (cond.op === '=') return String(value) === cond.value;
    if (cond.op === '!=') return String(value) !== cond.value;
    return isHidingValue(dep, value);
  }

  // ---------------------------------------------------------------------------------------
  // Selector hygiene (shared by the compiler, validateRegistry and the engine's custom rules)
  // ---------------------------------------------------------------------------------------

  /**
   * Walks CSS text outside strings, tracking ( ) [ ] nesting. Calls `onChar(ch, depthParen+Bracket)`
   * for every character outside strings. Returns false on malformed input (unterminated string,
   * newline in a string, stray/unbalanced closers).
   * @param {string} text
   * @param {(ch: string, depth: number, i: number) => boolean|void} onChar return false to abort
   * @returns {boolean}
   */
  function scan(text, onChar) {
    const stack = [];
    let quote = null;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (quote) {
        if (ch === '\\') i++;
        else if (ch === quote) quote = null;
        else if (ch === '\n') return false;
        continue;
      }
      if (ch === '\\') {
        i++; // escaped character: not structure
        continue;
      }
      if (ch === '"' || ch === "'") {
        quote = ch;
        continue;
      }
      if (ch === '(') stack.push(')');
      else if (ch === '[') stack.push(']');
      else if ((ch === ')' || ch === ']') && stack.pop() !== ch) return false;
      if (onChar(ch, stack.length, i) === false) return false;
    }
    return quote === null && stack.length === 0;
  }

  /** Control characters other than tab, newline, form feed and carriage return. */
  function hasControlChars(text) {
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c < 32 && c !== 9 && c !== 10 && c !== 12 && c !== 13) return true;
    }
    return false;
  }

  /**
   * True when `selector` is safe to splice into a stylesheet as the tail of a rule: no braces,
   * semicolons, at-rules, comments or HTML outside strings, balanced brackets/quotes, bounded
   * length. (Whether it is *valid CSS* is the browser's call; one bad rule cannot void others.)
   * @param {unknown} selector
   * @returns {boolean}
   */
  function isSafeSelector(selector) {
    if (typeof selector !== 'string') return false;
    const s = selector.trim();
    if (s === '' || s.length > 1000 || hasControlChars(s)) return false;
    if (s.includes('/*') || s.includes('*/')) return false;
    return scan(s, (ch) => !'{};@<'.includes(ch));
  }

  /**
   * Splits a selector list at top-level commas (commas inside :is(), :has(), [attr="a,b"] stay).
   * @param {string} selector
   * @returns {string[]} trimmed, whitespace-collapsed, non-empty parts
   */
  function splitSelectorList(selector) {
    const parts = [];
    let from = 0;
    scan(selector, (ch, depth, i) => {
      if (ch === ',' && depth === 0) {
        parts.push(selector.slice(from, i));
        from = i + 1;
      }
    });
    parts.push(selector.slice(from));
    return parts.map((p) => p.replace(/\s+/g, ' ').trim()).filter(Boolean);
  }

  /**
   * A `rules` entry must be exactly one block: starts with ':scope-on' (or '@media'/'@supports'),
   * contains ':scope-on', braces balanced and closing only at the very end, nothing unsafe.
   * @param {unknown} rule
   * @returns {boolean}
   */
  function isSafeRule(rule) {
    if (typeof rule !== 'string') return false;
    const r = rule.trim();
    if (r === '' || r.length > 4000 || !r.includes(SCOPE)) return false;
    if (!(r.startsWith(SCOPE) || /^@(media|supports)\b/.test(r))) return false;
    if (r.includes('/*') || /<\/?style/i.test(r)) return false;
    let depth = 0;
    let closedAt = -1;
    let braceError = false;
    const balanced = scan(r, (ch, _d, i) => {
      if (ch === '{') {
        if (closedAt !== -1) braceError = true; // a second top-level block
        depth++;
      } else if (ch === '}') {
        depth--;
        if (depth < 0) braceError = true;
        else if (depth === 0) closedAt = i;
      } else if (ch === ';' && depth === 0) braceError = true; // a statement outside any block
      return !braceError;
    });
    return balanced && !braceError && depth === 0 && closedAt === r.length - 1;
  }

  // ---------------------------------------------------------------------------------------
  // CSS compiler
  // ---------------------------------------------------------------------------------------

  /** Escapes a value for use inside a double-quoted CSS string. */
  const cssString = (s) => String(s).replace(/[\\"]/g, '\\$&').replace(/[\n\r\f]/g, ' ');

  /**
   * The gating compound selector: `html[data-at-peace~="<token>"]` plus, if `page` is given, a
   * page condition on the same <html> compound: `[data-at-peace-page="<page>"]` OR
   * `[data-at-peace-next="<page>"]`. The second attribute exists only while a navigation is in
   * flight and names its target page; accepting both keeps a page's rules active from the moment
   * its navigation starts (new elements never paint unhidden) until the old page is gone
   * (old elements do not pop back into view). Specificity is that of the single attribute form.
   * @param {string} token
   * @param {string|null} [page]
   * @returns {string}
   */
  function gate(token, page) {
    const base = `html[${ATTR.tokens}~="${cssString(token)}"]`;
    if (!page) return base;
    const p = cssString(page);
    return `${base}:is([${ATTR.page}="${p}"],[${ATTR.next}="${p}"])`;
  }

  function emitCss(out, prefix, hide, rules) {
    for (const selector of hide ?? []) {
      if (!isSafeSelector(selector)) continue; // validateRegistry() names it
      // Almost every selector is a single one: skip the second scan for those.
      const parts = selector.includes(',') ? splitSelectorList(selector) : [selector.replace(/\s+/g, ' ').trim()];
      for (const part of parts) out.push(`${prefix} ${part} { display: none !important; }`);
    }
    for (const rule of rules ?? []) {
      if (isSafeRule(rule)) out.push(rule.trim().split(SCOPE).join(prefix).replace(/\s*\n\s*/g, ' '));
    }
  }

  /**
   * Compiles the stylesheet rules for one site as an array (one entry = one CSS rule), starting
   * with the always-on filter rule. Cross-site settings never contribute.
   * @param {string} site
   * @returns {string[]}
   */
  function compileRules(site) {
    const cached = cssCache.get(site);
    if (cached) return cached.rules;

    const rules = [`${gate(MASTER_ID)} [${ATTR.filtered}] { display: none !important; }`];
    for (const def of settingList) {
      if (siteOf(def.id) !== site || !ID_RE.test(def.id)) continue;
      const page = typeof def.page === 'string' && PAGE_RE.test(def.page) ? def.page : null;
      if (def.type === 'toggle') {
        emitCss(rules, gate(def.id, page), def.hide, def.rules);
      } else if (def.type === 'select' && isPlainObject(def.variants)) {
        for (const [value, variant] of Object.entries(def.variants)) {
          if (!VALUE_RE.test(value) || !def.options?.some((o) => o.value === value) || !isPlainObject(variant)) continue;
          emitCss(rules, gate(`${def.id}=${value}`, page), variant.hide, variant.rules);
        }
      }
    }
    Object.freeze(rules);
    cssCache.set(site, { rules, css: rules.join('\n') });
    return rules;
  }

  /**
   * The stylesheet text for one site (one rule per line).
   * @param {string} site
   * @returns {string}
   */
  function compileCss(site) {
    compileRules(site);
    return cssCache.get(site).css;
  }

  /**
   * Tokens for the `data-at-peace` attribute on <html>.
   * - `[]` when `general.enabled` is false (YouTube untouched).
   * - Otherwise `general.enabled` first, then, for every setting of `site` (cross-site settings
   *   never appear): a toggle that is true → `<id>`; a select → `<id>=<current value>`, ALWAYS,
   *   default included. Emitting the default too keeps the attribute a full, predictable
   *   description of the select state (handy in devtools and tests) and costs one short token.
   * `settings` is an effective map; missing keys count as their default.
   * @param {Record<string, any>} settings
   * @param {string} site
   * @returns {string[]}
   */
  function tokensFor(settings, site) {
    const master = settingById.get(MASTER_ID);
    const enabled = settings?.[MASTER_ID] ?? master?.default ?? true;
    if (enabled === false) return [];
    const tokens = [MASTER_ID];
    for (const def of settingList) {
      if (siteOf(def.id) !== site || !ID_RE.test(def.id)) continue;
      const value = settings?.[def.id] ?? def.default;
      if (def.type === 'toggle') {
        if (value === true) tokens.push(def.id);
      } else if (def.type === 'select' && typeof value === 'string' && VALUE_RE.test(value)) {
        tokens.push(`${def.id}=${value}`);
      }
    }
    return tokens;
  }

  // ---------------------------------------------------------------------------------------
  // Registry validation
  // ---------------------------------------------------------------------------------------

  const isStringArray = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');

  function validateCss(id, where, hide, rules, problems) {
    if (hide !== undefined) {
      if (!isStringArray(hide)) problems.push(`${id}: ${where}hide must be an array of selector strings`);
      else {
        for (const sel of hide) {
          if (!isSafeSelector(sel)) problems.push(`${id}: ${where}hide has an unsafe or malformed selector: ${JSON.stringify(sel)}`);
          else if (splitSelectorList(sel).length > 1) {
            problems.push(`${id}: ${where}hide has a selector list (split it into one entry per selector): ${JSON.stringify(sel)}`);
          }
        }
      }
    }
    if (rules !== undefined) {
      if (!isStringArray(rules)) problems.push(`${id}: ${where}rules must be an array of rule strings`);
      else {
        for (const rule of rules) {
          if (!isSafeRule(rule)) problems.push(`${id}: ${where}rules entry must be exactly one block starting with ":scope-on": ${JSON.stringify(rule.slice?.(0, 80))}`);
        }
      }
    }
  }

  function validateOne(def, problems) {
    const id = def.id;
    for (const key of Object.keys(def)) {
      if (!KNOWN_KEYS.has(key)) problems.push(`${id}: unknown property "${key}" (typo?)`);
    }
    if (!ID_RE.test(id)) problems.push(`${id}: id must be dot-separated segments of [A-Za-z0-9_-] (at least two)`);

    const sec = sectionById.get(def.section);
    const site = siteOf(id);
    if (!sec) problems.push(`${id}: unknown section "${def.section}" (call AP.schema.section() first)`);
    else if ((sec.site ?? null) !== site) {
      problems.push(`${id}: belongs to ${site ? `site "${site}"` : 'no site (cross-site)'} but section "${sec.id}" is ${sec.site ? `site "${sec.site}"` : 'cross-site'}`);
    }

    if (typeof def.label !== 'string' || def.label.trim() === '') problems.push(`${id}: missing label`);
    if (def.description !== undefined && typeof def.description !== 'string') problems.push(`${id}: description must be a string`);
    if (def.group !== undefined && typeof def.group !== 'string') problems.push(`${id}: group must be a string`);
    if (def.unit !== undefined && typeof def.unit !== 'string') problems.push(`${id}: unit must be a string`);
    if (def.feature !== undefined && (typeof def.feature !== 'string' || def.feature === '')) problems.push(`${id}: feature must be a non-empty string`);
    if (def.since !== undefined && !(typeof def.since === 'string' && VERSION_RE.test(def.since))) problems.push(`${id}: since must look like "0.1.0"`);
    for (const flag of ['advanced', 'quick', 'preset', 'portable']) {
      if (def[flag] !== undefined && typeof def[flag] !== 'boolean') problems.push(`${id}: ${flag} must be a boolean`);
    }
    if (def.quick === true && def.type !== 'toggle' && def.type !== 'select') problems.push(`${id}: only toggles and selects can be quick toggles`);

    if (!TYPES.includes(def.type)) {
      problems.push(`${id}: type must be one of ${TYPES.join(', ')}`);
      return; // nothing else can be judged
    }

    // default
    if (!('default' in def)) problems.push(`${id}: missing default`);
    else {
      const { ok, value } = coerce(def, def.default);
      if (!ok || !deepEqual(value, def.default)) {
        problems.push(`${id}: default ${JSON.stringify(def.default)} is not valid for this setting${ok ? ` (it normalizes to ${JSON.stringify(value)})` : ''}`);
      }
    }

    // options
    const hasOptions = def.options !== undefined;
    if (def.type === 'select' && !hasOptions) problems.push(`${id}: a select needs options`);
    if (hasOptions) {
      if (def.type !== 'select' && def.type !== 'list') problems.push(`${id}: options only make sense on a select or a multi-select list`);
      else if (!Array.isArray(def.options) || def.options.length === 0) problems.push(`${id}: options must be a non-empty array`);
      else {
        const seen = new Set();
        for (const o of def.options) {
          if (!isPlainObject(o) || typeof o.value !== 'string' || typeof o.label !== 'string' || o.label === '') {
            problems.push(`${id}: every option needs a string value and a label`);
          } else {
            for (const key of Object.keys(o)) if (!['value', 'label', 'short'].includes(key)) problems.push(`${id}: option "${o.value}" has an unknown property "${key}"`);
            if (o.short !== undefined && !(typeof o.short === 'string' && o.short.trim() !== '' && o.short.length <= MAX_SHORT_LABEL)) {
              problems.push(`${id}: option "${o.value}" short label must be a non-empty string of at most ${MAX_SHORT_LABEL} characters`);
            }
            if (!VALUE_RE.test(o.value)) problems.push(`${id}: option value "${o.value}" may only contain A-Z a-z 0-9 . _ -`);
            if (seen.has(o.value)) problems.push(`${id}: duplicate option value "${o.value}"`);
            seen.add(o.value);
          }
        }
      }
    }

    // number bounds
    for (const key of ['min', 'max', 'step']) {
      if (def[key] !== undefined && def.type !== 'number') problems.push(`${id}: ${key} only applies to numbers`);
      else if (def[key] !== undefined && !Number.isFinite(def[key])) problems.push(`${id}: ${key} must be a finite number`);
    }
    if (Number.isFinite(def.min) && Number.isFinite(def.max) && def.min > def.max) problems.push(`${id}: min is greater than max`);
    if (def.step !== undefined && !(def.step > 0)) problems.push(`${id}: step must be positive`);
    if (def.maxLength !== undefined && !(def.type === 'text' || def.type === 'textarea')) problems.push(`${id}: maxLength only applies to text/textarea`);
    if (def.maxItems !== undefined && def.type !== 'list') problems.push(`${id}: maxItems only applies to lists`);
    if (def.item !== undefined && (def.type !== 'list' || typeof def.item !== 'function')) problems.push(`${id}: item must be a function on a list`);
    if (def.normalize !== undefined && typeof def.normalize !== 'function') problems.push(`${id}: normalize must be a function`);

    // tags, requires, bulkValue
    if (def.tags !== undefined) {
      if (!isStringArray(def.tags)) problems.push(`${id}: tags must be an array of strings`);
      else for (const tag of def.tags) if (!KNOWN_TAGS.includes(tag)) problems.push(`${id}: unknown tag "${tag}" (known: ${KNOWN_TAGS.join(', ')})`);
    }
    if (def.requires !== undefined) {
      const cond = parseRequires(def.requires);
      const dep = cond ? settingById.get(cond.id) : undefined;
      if (!cond) problems.push(`${id}: requires must look like "other.id", "other.id=value" or "other.id!=value" (got ${JSON.stringify(def.requires)})`);
      else if (cond.id === id) problems.push(`${id}: requires itself`);
      else if (!dep) problems.push(`${id}: requires unknown setting "${cond.id}"`);
      else if (cond.op !== 'truthy') {
        const allowed = dep.type === 'select' ? dep.options?.map((o) => o.value) : dep.type === 'toggle' ? ['true', 'false'] : null;
        if (!allowed) problems.push(`${id}: "${def.requires}" compares a value, which only works for a select or a toggle`);
        else if (!allowed.includes(cond.value)) problems.push(`${id}: "${cond.value}" is not a value of ${cond.id} (${allowed.join(', ')})`);
      }
    }
    if (def.bulkValue !== undefined && !(def.type === 'select' && def.options?.some((o) => o.value === def.bulkValue))) {
      problems.push(`${id}: bulkValue must be one of the options of a select`);
    }

    // CSS
    const hasCss = def.hide !== undefined || def.rules !== undefined || def.variants !== undefined || def.page !== undefined;
    if (def.type !== 'toggle' && (def.hide !== undefined || def.rules !== undefined)) problems.push(`${id}: hide/rules belong on toggles (selects use variants)`);
    if (def.type !== 'select' && def.variants !== undefined) problems.push(`${id}: variants belong on selects`);
    if (site === null && hasCss) problems.push(`${id}: cross-site settings cannot carry CSS or a page`);
    if (def.page !== undefined) {
      if (typeof def.page !== 'string' || !PAGE_RE.test(def.page)) problems.push(`${id}: page must be a lowercase page-type name`);
      else if (site && sitePages.has(site) && !sitePages.get(site).has(def.page)) {
        problems.push(`${id}: unknown ${site} page type "${def.page}" (known: ${[...sitePages.get(site)].join(', ')})`);
      }
    }
    if (def.type === 'toggle') validateCss(id, '', def.hide, def.rules, problems);
    if (def.type === 'select' && def.variants !== undefined) {
      if (!isPlainObject(def.variants)) problems.push(`${id}: variants must be an object keyed by option value`);
      else {
        for (const [value, variant] of Object.entries(def.variants)) {
          if (!def.options?.some((o) => o.value === value)) problems.push(`${id}: variants key "${value}" is not an option`);
          if (!isPlainObject(variant)) problems.push(`${id}: variants.${value} must be { hide?, rules? }`);
          else validateCss(id, `variants.${value}.`, variant.hide, variant.rules, problems);
        }
      }
    }

    // A site setting must do something.
    if (site && def.hide === undefined && def.rules === undefined && def.variants === undefined && !def.feature) {
      problems.push(`${id}: does nothing (no hide/rules/variants and no \`feature\` naming the JS that reads it)`);
    }
  }

  /**
   * Checks the whole registry and returns every problem as a plain sentence. Never throws.
   * Used by tests and tools, not in production paths.
   * @returns {string[]}
   */
  function validateRegistry() {
    const problems = [...registrationProblems];
    try {
      for (const sec of sectionById.values()) {
        if (typeof sec.title !== 'string' || sec.title.trim() === '') problems.push(`section "${sec.id}": missing title`);
        if (!Number.isFinite(sec.order)) problems.push(`section "${sec.id}": order must be a number`);
        if (sec.site !== null && !SITE_KEYS.includes(sec.site)) problems.push(`section "${sec.id}": unknown site "${sec.site}"`);
        if (!settingList.some((d) => d.section === sec.id)) problems.push(`section "${sec.id}": has no settings`);
      }
      for (const def of settingList) {
        try {
          validateOne(def, problems);
        } catch (err) {
          problems.push(`${def.id}: could not be validated (${err?.message ?? err})`);
        }
      }
    } catch (err) {
      problems.push(`validateRegistry failed unexpectedly: ${err?.message ?? err}`);
    }
    return problems;
  }

  AP.schema = {
    SITE_PREFIXES,
    MASTER_ID,
    ATTR,
    KNOWN_TAGS,
    section,
    define,
    registerPages,
    siteOf,
    all,
    get,
    sections,
    bySection,
    byTag,
    defaults,
    coerce,
    validateValue,
    validateRegistry,
    bulkTargets,
    bulkValue,
    isHidingValue,
    parseRequires,
    requiresMet,
    isSafeSelector,
    splitSelectorList,
    gate,
    compileRules,
    compileCss,
    tokensFor,
  };
})();
