// The settings lock (Phase 4b). It protects the person from their own 11 pm self, not from an
// attacker: anyone who can open devtools can clear the extension's storage. What it does:
//
//   modes     none · password (PBKDF2-SHA256 hash, never the password) · friction (wait, then type
//             a calm sentence). The lock itself is the `advanced.lock` setting (schema/advanced.js).
//   rule      While locked, anything that makes YouTube MORE hidden or strict is always allowed
//             (a toggle on, a stricter select, a block started, the pause switched on). Anything
//             that LOOSENS (shows something again, master switch off, shorter breath, a schedule
//             removed or disabled, a higher daily limit, a preset that loosens anything, an import,
//             a reset…) needs an unlock first. Unlocking lasts 10 minutes (`state.lockUnlockedUntil`,
//             written by the background on LOCK_UNLOCK) or until "Lock now".
//   one place isLoosening(def, old, new) is the ONLY function that decides what "loosening" means.
//             Settings without an obvious direction count as loosening (the safe default); a short
//             explicit list of purely cosmetic ones (theme, debug logs, playback speed, theater
//             mode) is always allowed. The unit tests walk every shipped setting.
//   guards    guardPatch() is the pure check; AP.lock.save / applyPreset / reset / importAll wrap
//             AP.settings.* with it so no page can change settings around the lock by accident
//             (tests/unit/lock.test.mjs scans the pages for direct calls).
//
// Loaded in the extension pages and the background (not in content scripts). Needs util.js,
// schema-core.js, schema/advanced.js, presets.js and settings.js (they are only used when called).
(() => {
  'use strict';
  const AP = globalThis.AtPeace;
  const { isPlainObject, deepEqual } = AP.util;

  const LOCK_ID = 'advanced.lock';
  /** How long an unlock lasts. */
  const UNLOCK_MS = 10 * 60_000;
  const DEFAULT_WAIT_SECONDS = 60;
  const MIN_WAIT_SECONDS = 10;
  const MAX_WAIT_SECONDS = 600;
  const PBKDF2_ITERATIONS = 250_000;
  const SALT_BYTES = 16;
  const MIN_PASSWORD_LENGTH = 4;
  const MAX_PASSWORD_LENGTH = 200;

  /** Calm sentences for friction mode. One is picked at random each time. */
  const SENTENCES = Object.freeze([
    'I am changing this on purpose.',
    'I have thought about this, and I still want it.',
    'This is a calm choice, not a habit.',
    'I would make this same choice tomorrow morning.',
    'I am not doing this out of boredom.',
  ]);

  // ---------------------------------------------------------------------------------------
  // isLoosening
  // ---------------------------------------------------------------------------------------

  /** Purely cosmetic or neutral: no direction, no risk. Always allowed. */
  const NEUTRAL = new Set(['general.theme', 'advanced.debug', 'yt.watch.defaultSpeed', 'yt.watch.autoTheater']);

  /**
   * Selects whose option order does not run "least → most hidden" (the schema convention).
   * Higher rank = stricter. Equal ranks are interchangeable (all the home-feed redirects hide the
   * same feed).
   */
  const SELECT_RANKS = Object.freeze({
    'yt.home.feedMode': { show: 0, hide: 1, subscriptions: 1, watchLater: 1, playlists: 1, custom: 1 },
    'pause.sessionMinutes': { 5: 4, 10: 3, 15: 2, 30: 1, 60: 0 }, // a shorter session is the stricter one
    'focus.unlockFriction': { none: 0, wait: 1, phrase: 2 },
  });

  /**
   * Numbers with a direction. `higher`: a bigger number is stricter. `lower`: a smaller one is.
   * `limit`: like a limit where 0 means "no limit" (the loosest value) and smaller is stricter.
   */
  const NUMBER_DIRECTION = Object.freeze({
    'pause.breathSeconds': 'higher',
    'pause.escalateStep': 'higher',
    'focus.dailyMinutes': 'limit',
    'focus.limitGrace': 'lower',
  });

  const asList = (v) => (Array.isArray(v) ? v : []);
  const isOn = (item) => !isPlainObject(item) || item.enabled !== false;
  const subset = (a, b) => asList(a).every((x) => asList(b).includes(x));

  /** Does the new list still hold everything that `isStillEnforced` requires of each old, enabled item? */
  function listKeepsEnforcing(oldList, newList, keyOf, isStillEnforced) {
    const next = new Map(asList(newList).map((item) => [keyOf(item), item]));
    return !asList(oldList).some((item) => isOn(item) && !isStillEnforced(item, next.get(keyOf(item))));
  }

  /** Lists with their own shape: what counts as "as strict as before" for one old item. */
  const LIST_RULES = Object.freeze({
    // A paused site must stay in the list, enabled, on the same domain.
    'pause.sites': (o, n) => Boolean(n) && isOn(n) && n.domain === o.domain,
    // A running schedule must stay enabled and do at least what it did: same action and window, no fewer days or sites.
    'focus.schedules': (o, n) =>
      Boolean(n) && isOn(n) && n.action === o.action && n.start === o.start && n.end === o.end && subset(o.days, n.days) && subset(o.siteKeys, n.siteKeys),
  });
  const LIST_KEYS = Object.freeze({ 'pause.sites': (i) => i?.siteKey, 'focus.schedules': (i) => i?.id });

  const selectRank = (def, value) => {
    const ranks = SELECT_RANKS[def.id];
    if (ranks) return Object.hasOwn(ranks, value) ? ranks[value] : -1;
    return def.options?.findIndex((o) => o.value === value) ?? -1; // convention: least → most hidden
  };

  /**
   * Would changing `def` from `oldValue` to `newValue` make YouTube (or the commitments around it)
   * LESS hidden / less strict? This is the one decision the lock is built on.
   *
   *   toggle   on → off                       (every "hide" toggle, the master switch, pause on, strict…)
   *   select   to a lower rank                (option order least → most hidden, or SELECT_RANKS)
   *   number   against its direction          (shorter breath, higher daily limit or limit off, more grace)
   *   list     an old item removed or changed (hidden elements, filters; for pause sites and schedules:
   *            removed, disabled, or no longer doing what it did). Adding is never loosening.
   *   object   the lock itself: any change once a lock is set (setting the first one is not loosening)
   *   text     any change (a redirect target, custom CSS: no direction)
   *   anything without an obvious direction, and anything unknown: loosening.
   * An unchanged value is not a loosening.
   * @param {import('./schema-core.js').SettingDef|null|undefined} def
   * @param {unknown} oldValue
   * @param {unknown} newValue
   * @returns {boolean}
   */
  function isLoosening(def, oldValue, newValue) {
    if (!def || typeof def !== 'object') return true;
    if (deepEqual(oldValue, newValue)) return false;
    if (NEUTRAL.has(def.id)) return false;

    if (def.id === LOCK_ID) return isPlainObject(oldValue) && oldValue.mode !== undefined && oldValue.mode !== 'none';

    switch (def.type) {
      case 'toggle':
        return oldValue === true && newValue !== true;

      case 'select':
        return selectRank(def, newValue) < selectRank(def, oldValue);

      case 'number': {
        const o = Number(oldValue);
        const n = Number(newValue);
        if (!Number.isFinite(o) || !Number.isFinite(n)) return true;
        switch (NUMBER_DIRECTION[def.id]) {
          case 'higher':
            return n < o;
          case 'lower':
            return n > o;
          case 'limit':
            return o > 0 && (n === 0 || n > o);
          default:
            return true;
        }
      }

      case 'list': {
        if (!Array.isArray(oldValue) || !Array.isArray(newValue)) return true;
        const rule = LIST_RULES[def.id];
        if (rule) return !listKeepsEnforcing(oldValue, newValue, LIST_KEYS[def.id], rule);
        return oldValue.some((item) => !newValue.some((other) => deepEqual(item, other)));
      }

      default:
        return true; // text, textarea, object and anything new: no obvious direction
    }
  }

  // ---------------------------------------------------------------------------------------
  // Status and guards (pure)
  // ---------------------------------------------------------------------------------------

  const clampWait = (v) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(MAX_WAIT_SECONDS, Math.max(MIN_WAIT_SECONDS, n)) : DEFAULT_WAIT_SECONDS;
  };

  /**
   * What the rest of the code needs to know about the lock.
   * @param {unknown} lockValue the stored `advanced.lock`
   * @param {unknown} unlockedUntil `state.lockUnlockedUntil` (ms), 0 / missing = not unlocked
   * @param {number} [now]
   * @returns {{ mode: 'none'|'password'|'friction', locked: boolean, unlockedUntil: number, waitSeconds: number }}
   */
  function status(lockValue, unlockedUntil, now = Date.now()) {
    const def = AP.schema.get(LOCK_ID);
    const lock = def ? AP.schema.validateValue(def, lockValue) : { mode: 'none' };
    const until = typeof unlockedUntil === 'number' && Number.isFinite(unlockedUntil) && unlockedUntil > now ? unlockedUntil : 0;
    return {
      mode: lock.mode,
      locked: lock.mode !== 'none' && until === 0,
      unlockedUntil: lock.mode === 'none' ? 0 : until,
      waitSeconds: clampWait(lock.waitSeconds ?? DEFAULT_WAIT_SECONDS),
    };
  }

  /** Is the lock holding right now? Accepts a status() result or `{ mode, unlockedUntil }`. */
  function isEnforcing(lockState, now = Date.now()) {
    if (!isPlainObject(lockState)) return false;
    if (lockState.mode === undefined || lockState.mode === 'none') return false;
    return !(typeof lockState.unlockedUntil === 'number' && lockState.unlockedUntil > now);
  }

  /**
   * Which settings of `patch` the lock refuses right now. Pure.
   * @param {Record<string, any>} patch   `{ id: newValue }`, like AP.settings.save()
   * @param {Record<string, any>} current effective/stored values before the change (missing = default)
   * @param {{ mode?: string, unlockedUntil?: number }} lockState
   * @param {number} [now]
   * @returns {{ allowed: boolean, blocked: string[] }}
   */
  function guardPatch(patch, current, lockState, now = Date.now()) {
    const blocked = [];
    if (!isEnforcing(lockState, now) || !isPlainObject(patch)) return { allowed: true, blocked };
    for (const [id, raw] of Object.entries(patch)) {
      const def = AP.schema.get(id);
      if (!def) continue; // save() drops unknown ids
      const next = AP.schema.coerce(def, raw);
      if (!next.ok) continue; // save() refuses unusable values itself
      const had = isPlainObject(current) && Object.hasOwn(current, id) ? AP.schema.validateValue(def, current[id]) : def.default;
      if (isLoosening(def, had, next.value)) blocked.push(id);
    }
    return { allowed: blocked.length === 0, blocked };
  }

  /**
   * The patch an applied preset amounts to: for every setting presets may touch, the preset's value
   * or the default (what AP.settings.applyPreset does). Feed it to guardPatch().
   * @param {Record<string, any>} values a preset's values map
   * @returns {Record<string, any>}
   */
  function presetPatch(values) {
    const patch = {};
    for (const def of AP.schema.all()) {
      if (!AP.presets.inScope(def)) continue;
      patch[def.id] = isPlainObject(values) && Object.hasOwn(values, def.id) ? values[def.id] : def.default;
    }
    return patch;
  }

  // ---------------------------------------------------------------------------------------
  // Password hashing (WebCrypto)
  // ---------------------------------------------------------------------------------------

  const toBase64 = (bytes) => btoa(String.fromCharCode(...bytes));
  const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));

  async function derive(password, salt, iterations) {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) throw new Error('WebCrypto is not available');
    const key = await subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    return new Uint8Array(await subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
  }

  /** A password that can work as one: long enough and not absurd. Returns a sentence, or null when fine. */
  function passwordProblem(password) {
    if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    if (password.length > MAX_PASSWORD_LENGTH) return `Use at most ${MAX_PASSWORD_LENGTH} characters.`;
    return null;
  }

  /**
   * The `advanced.lock` value for a new password: salted PBKDF2-SHA256, 250k iterations. The
   * password itself is never kept.
   * @param {string} password
   * @returns {Promise<{ mode: 'password', salt: string, hash: string, iterations: number }>}
   */
  async function createPasswordLock(password) {
    const problem = passwordProblem(password);
    if (problem) throw new Error(problem);
    const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
    const hash = await derive(password, salt, PBKDF2_ITERATIONS);
    return { mode: 'password', salt: toBase64(salt), hash: toBase64(hash), iterations: PBKDF2_ITERATIONS };
  }

  /** The `advanced.lock` value for friction mode. @param {number} [waitSeconds] */
  function createFrictionLock(waitSeconds = DEFAULT_WAIT_SECONDS) {
    return { mode: 'friction', waitSeconds: clampWait(waitSeconds) };
  }

  /**
   * Does `password` match the stored hash? Never throws; a malformed lock never matches.
   * @param {string} password
   * @param {{ salt?: string, hash?: string, iterations?: number }} lock
   * @returns {Promise<boolean>}
   */
  async function verifyPassword(password, lock) {
    try {
      if (typeof password !== 'string' || !isPlainObject(lock) || typeof lock.salt !== 'string' || typeof lock.hash !== 'string') return false;
      const iterations = Number.isInteger(lock.iterations) && lock.iterations >= 1000 ? lock.iterations : PBKDF2_ITERATIONS;
      const expected = fromBase64(lock.hash);
      const actual = await derive(password, fromBase64(lock.salt), iterations);
      if (expected.length !== actual.length) return false;
      let diff = 0;
      for (let i = 0; i < actual.length; i++) diff |= expected[i] ^ actual[i]; // constant time over the length
      return diff === 0;
    } catch {
      return false;
    }
  }

  /** @returns {string} one of SENTENCES */
  function pickSentence() {
    return SENTENCES[Math.floor(Math.random() * SENTENCES.length)];
  }

  // ---------------------------------------------------------------------------------------
  // Reading and guarded writing (storage)
  // ---------------------------------------------------------------------------------------

  /** The lock's status from storage. @returns {ReturnType<typeof status>} */
  async function read(now = Date.now()) {
    const got = await AP.settings.readStorage(['settings', 'state']);
    const lock = isPlainObject(got.settings) ? got.settings[LOCK_ID] : undefined;
    const until = isPlainObject(got.state) ? got.state.lockUnlockedUntil : 0;
    return status(lock, until, now);
  }

  /**
   * Calls `cb(status)` now and whenever the lock changes: a setting or the state changed in
   * storage, or the unlock ran out. Returns the function that stops it.
   * @param {(status: ReturnType<typeof status>) => void} cb
   * @returns {() => void}
   */
  function watch(cb) {
    let timer = null;
    let stopped = false;
    const run = async () => {
      clearTimeout(timer);
      try {
        const now = await read();
        if (stopped) return;
        cb(now);
        if (now.unlockedUntil > 0) timer = setTimeout(run, Math.max(50, now.unlockedUntil - Date.now() + 50));
      } catch (err) {
        AP.warn('lock watcher failed', err);
      }
    };
    const later = AP.util.debounce(run, 30);
    const onChanged = (changes, area) => {
      if (area === 'local' && changes && (changes.settings || changes.state)) later();
    };
    AP.api.storage.onChanged.addListener(onChanged);
    run();
    return () => {
      stopped = true;
      clearTimeout(timer);
      later.cancel();
      AP.api.storage.onChanged.removeListener(onChanged);
    };
  }

  /**
   * Would the lock refuse this patch right now? Reads the stored settings and the lock status.
   * @param {Record<string, any>} patch
   * @returns {Promise<{ allowed: boolean, blocked: string[], status: ReturnType<typeof status> }>}
   */
  async function check(patch) {
    const [stored, now] = await Promise.all([AP.settings.load(), read()]);
    return { ...guardPatch(patch, AP.settings.merge(stored), now), status: now };
  }

  /**
   * AP.settings.save() behind the lock. Pages and the background use this, never save() directly.
   * @param {Record<string, any>} patch
   * @returns {Promise<{ ok: boolean, blocked: string[], report: { changed: string[], unknown: string[], invalid: string[] } | null }>}
   */
  async function save(patch) {
    const verdict = await check(patch);
    if (!verdict.allowed) return { ok: false, blocked: verdict.blocked, report: null };
    return { ok: true, blocked: [], report: await AP.settings.save(patch) };
  }

  /**
   * AP.settings.applyPreset() behind the lock: refused when the preset would loosen anything.
   * @param {string|Record<string, any>} presetIdOrValues
   * @returns {Promise<{ ok: boolean, changed: string[], error?: string, blocked?: string[] }>}
   */
  async function applyPreset(presetIdOrValues) {
    const { customPresets } = await AP.settings.readStorage('customPresets');
    const values = AP.presets.valuesFor(presetIdOrValues, customPresets);
    if (!values) return { ok: false, changed: [], error: 'unknown-preset' };
    const verdict = await check(presetPatch(values));
    if (!verdict.allowed) return { ok: false, changed: [], error: 'locked', blocked: verdict.blocked };
    return AP.settings.applyPreset(presetIdOrValues);
  }

  /**
   * AP.settings.reset() behind the lock. A full reset always loosens, so it needs an unlock; a
   * reset of some ids is judged like a patch of their defaults.
   * @param {string[]} [ids]
   * @returns {Promise<{ ok: boolean, changed: string[], error?: string, blocked?: string[] }>}
   */
  async function reset(ids) {
    if (Array.isArray(ids)) {
      const patch = {};
      for (const id of ids) {
        const def = AP.schema.get(id);
        if (def) patch[id] = def.default;
      }
      const verdict = await check(patch);
      if (!verdict.allowed) return { ok: false, changed: [], error: 'locked', blocked: verdict.blocked };
    } else if ((await read()).locked) {
      return { ok: false, changed: [], error: 'locked' };
    }
    return { ok: true, ...(await AP.settings.reset(ids)) };
  }

  /**
   * AP.settings.importAll() behind the lock: an import replaces settings wholesale, so it needs an unlock.
   * @param {string|object} input
   */
  async function importAll(input) {
    if ((await read()).locked) {
      return { ok: false, error: 'locked', applied: 0, dropped: [], invalid: [], presets: { added: 0, replaced: 0, dropped: [] }, fromVersion: null, newerThanThisVersion: false };
    }
    return AP.settings.importAll(input);
  }

  AP.lock = {
    LOCK_ID,
    UNLOCK_MS,
    DEFAULT_WAIT_SECONDS,
    MIN_WAIT_SECONDS,
    MAX_WAIT_SECONDS,
    PBKDF2_ITERATIONS,
    MIN_PASSWORD_LENGTH,
    SENTENCES,
    NEUTRAL,
    clampWait,
    isLoosening,
    status,
    isEnforcing,
    guardPatch,
    presetPatch,
    passwordProblem,
    createPasswordLock,
    createFrictionLock,
    verifyPassword,
    pickSentence,
    read,
    watch,
    check,
    save,
    applyPreset,
    reset,
    importAll,
  };
})();
