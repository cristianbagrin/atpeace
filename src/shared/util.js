// Small, dependency-free helpers shared by every context. Keep this file boring and tested.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;

  /**
   * Delays `fn` until `ms` have passed without another call. Trailing edge only.
   * @template {(...args: any[]) => void} F
   * @param {F} fn
   * @param {number} ms
   * @returns {F & { cancel: () => void, flush: () => void }}
   */
  function debounce(fn, ms) {
    let timer = null;
    let lastArgs = null;
    const run = () => {
      timer = null;
      const args = lastArgs;
      lastArgs = null;
      fn(...args);
    };
    const debounced = (...args) => {
      lastArgs = args;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(run, ms);
    };
    debounced.cancel = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      lastArgs = null;
    };
    // Runs the pending call right now (if there is one), e.g. before the page unloads.
    debounced.flush = () => {
      if (timer === null) return;
      clearTimeout(timer);
      run();
    };
    return debounced;
  }

  /**
   * Runs `fn` at most once per `ms`: immediately on the first call (leading edge), and once
   * more at the end of the window with the latest arguments if calls arrived meanwhile.
   * @template {(...args: any[]) => void} F
   * @param {F} fn
   * @param {number} ms
   * @returns {F & { cancel: () => void }}
   */
  function throttle(fn, ms) {
    let timer = null;
    let lastRun = -Infinity;
    let pendingArgs = null;
    const fire = (args) => {
      lastRun = Date.now();
      fn(...args);
    };
    const throttled = (...args) => {
      const wait = ms - (Date.now() - lastRun);
      if (wait <= 0 && timer === null) {
        fire(args);
        return;
      }
      pendingArgs = args;
      if (timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        const a = pendingArgs;
        pendingArgs = null;
        if (a) fire(a);
      }, Math.max(wait, 0));
    };
    throttled.cancel = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      pendingArgs = null;
    };
    return throttled;
  }

  /**
   * Coalesces bursts of calls into one call per animation frame, using the latest arguments.
   * Falls back to a ~60 Hz timeout where there is no `requestAnimationFrame` (workers, tests).
   * Caveat: browsers pause animation frames in hidden tabs, so do not use it for work that must
   * keep running while the tab is in the background.
   * @template {(...args: any[]) => void} F
   * @param {F} fn
   * @returns {F & { cancel: () => void }}
   */
  function rafThrottle(fn) {
    let handle = null;
    let lastArgs = null;
    const hasRaf = typeof globalThis.requestAnimationFrame === 'function';
    const schedule = (cb) => (hasRaf ? globalThis.requestAnimationFrame(cb) : setTimeout(cb, 16));
    const unschedule = (h) => (hasRaf ? globalThis.cancelAnimationFrame(h) : clearTimeout(h));
    const throttled = (...args) => {
      lastArgs = args;
      if (handle !== null) return;
      handle = schedule(() => {
        handle = null;
        const a = lastArgs;
        lastArgs = null;
        fn(...a);
      });
    };
    throttled.cancel = () => {
      if (handle !== null) unschedule(handle);
      handle = null;
      lastArgs = null;
    };
    return throttled;
  }

  /**
   * Local calendar day as `YYYY-MM-DD`. Uses the *local* date on purpose: "today" for stats,
   * daily limits and schedules means the user's day, not UTC's (PLAN §5.4).
   * @param {Date|number} [date] defaults to now
   * @returns {string}
   */
  function dayKey(date = new Date()) {
    const d = date instanceof Date ? date : new Date(date);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  /**
   * Limits `n` to the closed range [min, max]. NaN becomes `min`. Requires min <= max.
   * @param {number} n
   * @param {number} min
   * @param {number} max
   * @returns {number}
   */
  function clamp(n, min, max) {
    if (Number.isNaN(n)) return min;
    return Math.min(max, Math.max(min, n));
  }

  /**
   * Short random id (12 hex chars), optionally prefixed: `uid('rule')` → `rule_3fa91c0b72de`.
   * Not for secrets that must survive an adversary; fine for ids and nonces' uniqueness needs.
   * @param {string} [prefix]
   * @returns {string}
   */
  function uid(prefix = '') {
    const bytes = new Uint8Array(6);
    if (globalThis.crypto?.getRandomValues) {
      globalThis.crypto.getRandomValues(bytes);
    } else {
      for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    return prefix ? `${prefix}_${hex}` : hex;
  }

  /**
   * @param {number} ms
   * @returns {Promise<void>}
   */
  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * True for `{}`-style objects (literals, `Object.create(null)`, JSON.parse results), false for
   * arrays, null, class instances, Dates, Maps… The prototype check is realm-independent:
   * objects handed to a content script by the browser (storage, messages) can come from a
   * different realm than our own `Object.prototype`.
   * @param {unknown} value
   * @returns {value is Record<string, unknown>}
   */
  function isPlainObject(value) {
    if (value === null || typeof value !== 'object') return false;
    if (Object.prototype.toString.call(value) !== '[object Object]') return false;
    const proto = Object.getPrototypeOf(value);
    return proto === null || Object.getPrototypeOf(proto) === null;
  }

  /**
   * Structural equality for JSON-like data: primitives (NaN equals NaN), arrays and plain
   * objects, compared recursively. Anything else (functions, Dates, Maps…) is compared by
   * identity, because settings and storage values never contain those.
   * @param {unknown} a
   * @param {unknown} b
   * @returns {boolean}
   */
  function deepEqual(a, b) {
    if (a === b) return true;
    if (typeof a === 'number' && typeof b === 'number') return Number.isNaN(a) && Number.isNaN(b);
    if (Array.isArray(a) || Array.isArray(b)) {
      if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
      return a.every((item, i) => deepEqual(item, b[i]));
    }
    if (isPlainObject(a) && isPlainObject(b)) {
      const keysA = Object.keys(a);
      if (keysA.length !== Object.keys(b).length) return false;
      return keysA.every((key) => Object.hasOwn(b, key) && deepEqual(a[key], b[key]));
    }
    return false;
  }

  AP.util = { debounce, throttle, rafThrottle, dayKey, clamp, uid, sleep, isPlainObject, deepEqual };
})();
