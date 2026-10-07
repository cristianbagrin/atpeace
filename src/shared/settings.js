// Settings storage (PLAN §4.3, §5). Everything that reads or writes the `settings` and
// `customPresets` keys of storage.local goes through here, in every context.
//
// Effective settings = validate(defaults ⊕ stored ⊕ schedule-override preset), the same function
// for content scripts, pages and the background. Values are always checked against the schema
// (schema-core.js): unknown ids are dropped, bad values fall back to the default.
//
// Writes: `settings` and `customPresets` only. `state` and `stats` are written exclusively by the
// background (see state.js); this file just *reads* `state.scheduleOverride`.
// Writes from one context are serialized through a queue, so two quick calls cannot overwrite
// each other. Two different contexts (popup + options) can still race inside the same few
// milliseconds; the last write wins, which is acceptable for hand-made settings.
//
// AP.debug follows `advanced.debug` whenever effective settings are computed.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;
  const { isPlainObject, deepEqual } = AP.util;

  /** Version of the stored settings layout. Bump it and append a migration when ids change. */
  const SCHEMA_VERSION = 2;

  /** Settings that existed in version 1 and were removed in version 2 (feedback round 1). */
  const REMOVED_IN_V2 = Object.freeze([
    'pause.askIntention', // the "what did you come for" prompt
    'pause.escalate', // longer breath for repeat visits
    'pause.escalateStep',
    'pause.showCount', // always on now
    'pause.expiryOverlay', // always on now
    'advanced.customCss',
    'yt.general.calmTitles',
  ]);

  /**
   * Migration pipeline: `MIGRATIONS[i]` turns stored settings of version i+1 into version i+2.
   * Pure functions `(storedMap) => storedMap`. Renaming an id after release lives here, never in
   * the schema (PLAN §4.1).
   *   v1 → v2  drops the stored values of settings that were removed.
   * @type {Array<(stored: Record<string, any>) => Record<string, any>>}
   */
  const MIGRATIONS = [
    (stored) => {
      const next = { ...stored };
      for (const id of REMOVED_IN_V2) delete next[id];
      return next;
    },
  ];

  const KEYS = Object.freeze({
    settings: 'settings',
    customPresets: 'customPresets',
    state: 'state',
    stats: 'stats',
    meta: 'meta',
  });

  /** Storage keys whose changes can alter the effective settings or the preset list. */
  const WATCHED = [KEYS.settings, KEYS.state, KEYS.customPresets, KEYS.meta];

  const EXPORT_APP = 'at-peace';
  const MAX_IMPORT_BYTES = 5_000_000;

  const area = () => AP.api.storage.local;

  /** Waits before the 2nd, 3rd and 4th attempt of a failed storage read. */
  const READ_RETRY_DELAYS_MS = [60, 250, 800];

  /**
   * `storage.local.get` with a few retries. Firefox was seen to reject a read with the opaque
   * "An unexpected error occurred" now and then in automated runs (not reproducible on demand);
   * without a retry that would silently drop a settings update and leave the page in its old
   * state. A dead extension context ("Extension context invalidated") is not retried.
   * Writes are never retried here: the caller decides.
   * @param {string|string[]|null} keys
   * @returns {Promise<Record<string, any>>}
   */
  async function readStorage(keys) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await area().get(keys);
      } catch (err) {
        const text = String(err?.message ?? err);
        if (attempt >= READ_RETRY_DELAYS_MS.length || /context invalidated/i.test(text)) throw err;
        AP.log('storage read failed, retrying:', text);
        await AP.util.sleep(READ_RETRY_DELAYS_MS[attempt]);
      }
    }
  }

  // ---------------------------------------------------------------------------------------
  // Pure helpers
  // ---------------------------------------------------------------------------------------

  /**
   * Runs stored settings through the migration pipeline.
   * @param {unknown} stored
   * @param {number} fromVersion version the data was written with (1 when unknown)
   * @param {{ migrations?: Function[], toVersion?: number }} [options] (tests inject their own)
   * @returns {Record<string, any>} a new map
   */
  function migrate(stored, fromVersion = 1, { migrations = MIGRATIONS, toVersion = SCHEMA_VERSION } = {}) {
    let data = isPlainObject(stored) ? { ...stored } : {};
    const from = Number.isInteger(fromVersion) && fromVersion >= 1 ? fromVersion : 1;
    for (let v = from; v < toVersion; v++) {
      const step = migrations[v - 1];
      if (typeof step === 'function') data = step(data) ?? data;
    }
    return data;
  }

  /**
   * defaults ⊕ stored ⊕ override, every value validated. Pure: no storage, no side effects.
   * @param {unknown} stored  raw stored settings
   * @param {Record<string, any>|null} [override]  preset values applied by an active schedule
   * @returns {Record<string, any>} one value for every registered setting
   */
  function merge(stored, override = null) {
    const out = AP.schema.defaults();
    const base = isPlainObject(stored) ? stored : {};
    for (const def of AP.schema.all()) {
      for (const layer of [base, override]) {
        if (!layer || !Object.hasOwn(layer, def.id) || layer[def.id] === undefined) continue;
        const { ok, value } = AP.schema.coerce(def, layer[def.id]);
        if (ok) out[def.id] = value;
      }
    }
    return out;
  }

  /** Ids whose value differs between two effective maps (all ids when `before` is missing). */
  function diffIds(before, after) {
    const ids = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
    return [...ids].filter((id) => !deepEqual(before?.[id], after?.[id]));
  }

  /** The preset-values map the active schedule override points at, or null. */
  function overrideFrom(state, customPresets) {
    const id = isPlainObject(state) ? state.scheduleOverride : null;
    return typeof id === 'string' ? AP.presets.valuesFor(id, customPresets) : null;
  }

  // ---------------------------------------------------------------------------------------
  // Reading
  // ---------------------------------------------------------------------------------------

  /** Raw stored settings (`{}` when nothing was saved yet). Not validated, not merged. */
  async function load() {
    const { settings } = await readStorage(KEYS.settings);
    return isPlainObject(settings) ? settings : {};
  }

  /**
   * The settings everything else should act on. Also keeps AP.debug in sync with advanced.debug.
   * @returns {Promise<Record<string, any>>}
   */
  async function effective() {
    const got = await readStorage(WATCHED);
    const version = isPlainObject(got.meta) && Number.isInteger(got.meta.schemaVersion) ? got.meta.schemaVersion : 1;
    // Migrate in memory only; the background persists the migrated map on install/update.
    const stored = version < SCHEMA_VERSION ? migrate(got.settings, version) : got.settings;
    const result = merge(stored, overrideFrom(got.state, got.customPresets));
    AP.debug = result['advanced.debug'] === true;
    return result;
  }

  // ---------------------------------------------------------------------------------------
  // Writing (serialized)
  // ---------------------------------------------------------------------------------------

  let queue = Promise.resolve();
  function enqueue(task) {
    const run = queue.then(task, task);
    queue = run.catch(() => {});
    return run;
  }

  /**
   * Merges `patch` into the stored settings. Each value is validated against its definition;
   * unknown ids are dropped; unusable values (wrong type, not an option…) are reported and not
   * stored; numbers are clamped. Writes `settings` only, and only when something changed.
   * @param {Record<string, any>} patch
   * @returns {Promise<{ changed: string[], unknown: string[], invalid: string[] }>}
   */
  function save(patch) {
    if (!isPlainObject(patch)) throw new TypeError('AP.settings.save(patch): patch must be an object');
    return enqueue(async () => {
      const stored = await load();
      const next = { ...stored };
      const report = { changed: [], unknown: [], invalid: [] };
      for (const [id, raw] of Object.entries(patch)) {
        const def = AP.schema.get(id);
        if (!def) {
          report.unknown.push(id);
          continue;
        }
        const { ok, value } = AP.schema.coerce(def, raw);
        if (!ok) {
          report.invalid.push(id);
          continue;
        }
        const current = Object.hasOwn(next, id) ? next[id] : def.default;
        if (deepEqual(current, value)) continue;
        next[id] = value;
        report.changed.push(id);
      }
      if (report.changed.length > 0) await area().set({ [KEYS.settings]: next });
      return report;
    });
  }

  /**
   * Back to defaults. With `ids`: just those settings. Without: everything that can be exported,
   * i.e. all settings except `portable: false` ones (the settings lock survives a reset).
   * @param {string[]} [ids]
   * @returns {Promise<{ changed: string[] }>}
   */
  function reset(ids) {
    return enqueue(async () => {
      const stored = await load();
      const next = { ...stored };
      const changed = [];
      const targets = Array.isArray(ids)
        ? ids
        : Object.keys(stored).filter((id) => AP.schema.get(id)?.portable !== false);
      for (const id of targets) {
        if (typeof id === 'string' && Object.hasOwn(next, id)) {
          delete next[id];
          changed.push(id);
        }
      }
      if (changed.length > 0) await area().set({ [KEYS.settings]: next });
      return { changed };
    });
  }

  /**
   * Applies a preset: for every setting a preset may touch, `settings := defaults ⊕ preset.values`;
   * everything else (theme, schedules, lock, …) is left alone. The caller asks for confirmation.
   * @param {string|Record<string, any>} presetIdOrValues built-in/custom preset id, or a values map
   * @returns {Promise<{ ok: boolean, changed: string[], error?: string }>}
   */
  function applyPreset(presetIdOrValues) {
    return enqueue(async () => {
      const got = await readStorage([KEYS.settings, KEYS.customPresets]);
      const stored = isPlainObject(got.settings) ? got.settings : {};
      const values = AP.presets.valuesFor(presetIdOrValues, got.customPresets);
      if (!values) return { ok: false, changed: [], error: 'unknown-preset' };

      const next = {};
      for (const [id, v] of Object.entries(stored)) {
        const def = AP.schema.get(id);
        if (!def || !AP.presets.inScope(def)) next[id] = v; // keep: out of scope (or from a newer version)
      }
      Object.assign(next, values);

      const changed = AP.schema
        .all()
        .filter((def) => AP.presets.inScope(def))
        .filter((def) => {
          const before = Object.hasOwn(stored, def.id) ? AP.schema.validateValue(def, stored[def.id]) : def.default;
          const after = Object.hasOwn(values, def.id) ? values[def.id] : def.default;
          return !deepEqual(before, after);
        })
        .map((def) => def.id);
      if (!deepEqual(stored, next)) await area().set({ [KEYS.settings]: next });
      return { ok: true, changed };
    });
  }

  // ---------------------------------------------------------------------------------------
  // Custom presets
  // ---------------------------------------------------------------------------------------

  /** @returns {Promise<import('./presets.js').Preset[]>} the user's presets, cleaned. */
  async function listCustomPresets() {
    const { customPresets } = await readStorage(KEYS.customPresets);
    return AP.presets.sanitizeCustom(customPresets);
  }

  /** The stored shape of a custom preset (no `builtIn` flag). */
  const storable = (p) => ({ id: p.id, name: p.name, values: p.values, createdAt: p.createdAt });

  const cleanName = (name) => (typeof name === 'string' ? name.trim().slice(0, 60) : '');

  /**
   * "Save current as preset". Without `values` it captures the in-scope settings that differ from
   * their defaults right now.
   * @param {string} name
   * @param {Record<string, any>} [values]
   * @returns {Promise<{ ok: boolean, preset?: object, error?: string }>}
   */
  function saveCustomPreset(name, values) {
    return enqueue(async () => {
      const clean = cleanName(name);
      if (clean === '') return { ok: false, error: 'name-required' };
      const got = await readStorage([KEYS.settings, KEYS.customPresets]);
      const list = AP.presets.sanitizeCustom(got.customPresets);
      if (list.length >= AP.presets.MAX_CUSTOM_PRESETS) return { ok: false, error: 'too-many-presets' };
      const preset = {
        id: AP.util.uid('preset'),
        name: clean,
        values: AP.presets.sanitize(values ?? AP.presets.capture(isPlainObject(got.settings) ? got.settings : {})).values,
        createdAt: Date.now(),
      };
      await area().set({ [KEYS.customPresets]: [...list, preset].map(storable) });
      return { ok: true, preset };
    });
  }

  /** @returns {Promise<{ ok: boolean, error?: string }>} */
  function renameCustomPreset(id, name) {
    return enqueue(async () => {
      const clean = cleanName(name);
      if (clean === '') return { ok: false, error: 'name-required' };
      const { customPresets } = await readStorage(KEYS.customPresets);
      const list = AP.presets.sanitizeCustom(customPresets);
      const target = list.find((p) => p.id === id);
      if (!target) return { ok: false, error: 'unknown-preset' };
      target.name = clean;
      await area().set({ [KEYS.customPresets]: list.map(storable) });
      return { ok: true };
    });
  }

  /**
   * "Update from current": a custom preset takes the in-scope settings as they are now (or `values`).
   * Its name, id and date stay, so schedules that point at it keep working.
   * @param {string} id
   * @param {Record<string, any>} [values]
   * @returns {Promise<{ ok: boolean, preset?: object, error?: string }>}
   */
  function updateCustomPreset(id, values) {
    return enqueue(async () => {
      const got = await readStorage([KEYS.settings, KEYS.customPresets]);
      const list = AP.presets.sanitizeCustom(got.customPresets);
      const target = list.find((p) => p.id === id);
      if (!target) return { ok: false, error: 'unknown-preset' };
      target.values = AP.presets.sanitize(values ?? AP.presets.capture(isPlainObject(got.settings) ? got.settings : {})).values;
      await area().set({ [KEYS.customPresets]: list.map(storable) });
      return { ok: true, preset: target };
    });
  }

  /** @returns {Promise<{ ok: boolean, error?: string }>} */
  function deleteCustomPreset(id) {
    return enqueue(async () => {
      const { customPresets } = await readStorage(KEYS.customPresets);
      const list = AP.presets.sanitizeCustom(customPresets);
      const rest = list.filter((p) => p.id !== id);
      if (rest.length === list.length) return { ok: false, error: 'unknown-preset' };
      await area().set({ [KEYS.customPresets]: rest.map(storable) });
      return { ok: true };
    });
  }

  /**
   * Puts a deleted custom preset back (Undo): same id, name, values and date, at its old place in
   * the list, so a schedule that points at it works again.
   * @param {object} preset what listCustomPresets() returned before it was deleted
   * @param {number} [index] where it was
   * @returns {Promise<{ ok: boolean, error?: string }>}
   */
  function restoreCustomPreset(preset, index = Infinity) {
    return enqueue(async () => {
      const { customPresets } = await readStorage(KEYS.customPresets);
      const list = AP.presets.sanitizeCustom(customPresets);
      const [back] = AP.presets.sanitizeCustom([preset]);
      if (!back) return { ok: false, error: 'invalid-preset' };
      if (list.some((p) => p.id === back.id)) return { ok: false, error: 'exists' };
      if (list.length >= AP.presets.MAX_CUSTOM_PRESETS) return { ok: false, error: 'too-many-presets' };
      list.splice(Math.max(0, Math.min(list.length, Number.isFinite(index) ? index : list.length)), 0, back);
      await area().set({ [KEYS.customPresets]: list.map(storable) });
      return { ok: true };
    });
  }

  // ---------------------------------------------------------------------------------------
  // Subscribing
  // ---------------------------------------------------------------------------------------

  /**
   * Calls `cb(effective, changedIds, { keys })` after settings, schedule state, custom presets or
   * meta change in storage (debounced 50 ms). `changedIds` lists settings whose *effective* value
   * changed since the previous call, which can be empty (e.g. only `customPresets` changed).
   * Pass `initial` (the effective map, or a promise of it) that the caller already holds so the
   * first diff is exact; otherwise the current settings are read when subscribing.
   * Errors inside `cb` are logged, never thrown into the browser's event dispatch.
   * @param {(effective: Record<string, any>, changedIds: string[], info: { keys: string[] }) => void} cb
   * @param {Record<string, any>|Promise<Record<string, any>>} [initial]
   * @returns {() => void} unsubscribe
   */
  function subscribe(cb, initial) {
    let previous = Promise.resolve(initial ?? effective()).catch(() => null);
    let pendingKeys = new Set();

    const flush = AP.util.debounce(async () => {
      const keys = [...pendingKeys];
      pendingKeys = new Set();
      try {
        const before = await previous;
        const next = await effective();
        previous = Promise.resolve(next);
        cb(next, diffIds(before, next), { keys });
      } catch (err) {
        AP.warn('settings subscriber failed', err);
      }
    }, 50);

    const onChanged = (changes, areaName) => {
      if (areaName !== 'local') return;
      for (const key of WATCHED) if (changes && key in changes) pendingKeys.add(key);
      if (pendingKeys.size > 0) flush();
    };

    AP.api.storage.onChanged.addListener(onChanged);
    return () => {
      AP.api.storage.onChanged.removeListener(onChanged);
      flush.cancel();
    };
  }

  // ---------------------------------------------------------------------------------------
  // Export / import
  // ---------------------------------------------------------------------------------------

  /**
   * Everything a user would want in a backup: stored settings (valid ones, `portable: false`
   * ones such as the lock excluded) and custom presets. Returns a plain object; the caller
   * stringifies it. Never includes `state`, `stats` or `meta`.
   */
  async function exportAll() {
    const got = await readStorage([KEYS.settings, KEYS.customPresets]);
    const settings = {};
    for (const [id, raw] of Object.entries(isPlainObject(got.settings) ? got.settings : {})) {
      const def = AP.schema.get(id);
      if (!def || def.portable === false) continue;
      const { ok, value } = AP.schema.coerce(def, raw);
      if (ok) settings[id] = value;
    }
    return {
      app: EXPORT_APP,
      schemaVersion: SCHEMA_VERSION,
      version: AP.api.runtime.getManifest().version,
      exportedAt: new Date().toISOString(),
      settings,
      customPresets: AP.presets.sanitizeCustom(got.customPresets).map(storable),
    };
  }

  /**
   * @typedef {Object} ImportReport
   * @property {boolean} ok            false = nothing was changed
   * @property {string} [error]        'invalid-json' | 'too-large' | 'not-an-export'
   * @property {number} applied        settings written
   * @property {{key: string, reason: string}[]} dropped   keys ignored (unknown, not importable, reserved…)
   * @property {{key: string, reason: string}[]} invalid   keys whose value was unusable
   * @property {{ added: number, replaced: number, dropped: string[] }} presets
   * @property {number|null} fromVersion  schemaVersion of the file
   * @property {boolean} newerThanThisVersion  the file comes from a newer At Peace; unknown settings were dropped
   */

  /**
   * Restores a backup made by exportAll(). Accepts the JSON text or the parsed object. Settings
   * are REPLACED by the file's (except `portable: false` ones such as the lock, which an import
   * can never touch); custom presets are merged by id. Every value is validated; the report says
   * what was dropped and why. Nothing is written when the file is not an At Peace export.
   * @param {string|object} input
   * @returns {Promise<ImportReport>}
   */
  function importAll(input) {
    return enqueue(async () => {
      const report = {
        ok: false,
        applied: 0,
        dropped: [],
        invalid: [],
        presets: { added: 0, replaced: 0, dropped: [] },
        fromVersion: null,
        newerThanThisVersion: false,
      };
      let data = input;
      if (typeof input === 'string') {
        if (input.length > MAX_IMPORT_BYTES) return { ...report, error: 'too-large' };
        try {
          data = JSON.parse(input);
        } catch {
          return { ...report, error: 'invalid-json' };
        }
      }
      if (!isPlainObject(data) || data.app !== EXPORT_APP || !isPlainObject(data.settings)) {
        return { ...report, error: 'not-an-export' };
      }

      report.fromVersion = Number.isInteger(data.schemaVersion) ? data.schemaVersion : 1;
      report.newerThanThisVersion = report.fromVersion > SCHEMA_VERSION;
      const incoming = migrate(data.settings, report.fromVersion);

      const got = await readStorage([KEYS.settings, KEYS.customPresets]);
      const stored = isPlainObject(got.settings) ? got.settings : {};
      const next = {};
      // Keep what an import must never touch.
      for (const [id, v] of Object.entries(stored)) if (AP.schema.get(id)?.portable === false) next[id] = v;

      for (const [id, raw] of Object.entries(incoming)) {
        const def = AP.schema.get(id);
        if (!def) report.dropped.push({ key: id, reason: 'unknown setting' });
        else if (def.portable === false) report.dropped.push({ key: id, reason: 'cannot be imported' });
        else {
          const { ok, value } = AP.schema.coerce(def, raw);
          if (ok) {
            next[id] = value;
            report.applied++;
          } else report.invalid.push({ key: id, reason: 'value not allowed for this setting' });
        }
      }

      // Custom presets: merge by id (the file's wins), reserved or malformed ones are dropped.
      const merged = AP.presets.sanitizeCustom(got.customPresets);
      if (Array.isArray(data.customPresets)) {
        for (const raw of data.customPresets) {
          const preset = AP.presets.sanitizeCustom([raw])[0];
          if (!preset) {
            report.presets.dropped.push(String(isPlainObject(raw) ? (raw.name ?? raw.id ?? '?') : '?'));
            continue;
          }
          const at = merged.findIndex((p) => p.id === preset.id);
          if (at === -1) {
            merged.push(preset);
            report.presets.added++;
          } else {
            merged[at] = preset;
            report.presets.replaced++;
          }
        }
      }

      await area().set({
        [KEYS.settings]: next,
        [KEYS.customPresets]: merged.slice(0, AP.presets.MAX_CUSTOM_PRESETS).map(storable),
      });
      report.ok = true;
      return report;
    });
  }

  AP.settings = {
    SCHEMA_VERSION,
    MIGRATIONS,
    KEYS,
    readStorage,
    migrate,
    merge,
    diffIds,
    load,
    effective,
    save,
    reset,
    applyPreset,
    listCustomPresets,
    saveCustomPreset,
    renameCustomPreset,
    updateCustomPreset,
    deleteCustomPreset,
    restoreCustomPreset,
    subscribe,
    exportAll,
    importAll,
  };
})();
