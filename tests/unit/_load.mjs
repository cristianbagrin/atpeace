// Test helpers shared by all unit tests (not a test file itself: no `.test.` in the name).
//
//   loadAtPeace(paths)   evaluates classic scripts in order and returns the fresh `AtPeace` namespace
//   installFakeBrowser() puts an in-memory `browser` (storage, runtime, tabs) on globalThis
//
// Classic scripts only mutate `globalThis`, so importing them is enough (PLAN §3.1). ESLint parses
// everything under src/ with sourceType "script", which is what rejects stray import/export.
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * The shared scripts every context loads first, in order. Mirror of the lists in manifest.json,
 * src/background/sw-chrome.js and the pages' <script> tags (tests/unit/manifest.test.mjs checks the
 * manifest and the service worker against it).
 */
export const CORE_SCRIPTS = [
  'src/shared/namespace.js',
  'src/shared/browser-api.js',
  'src/shared/util.js',
  'src/shared/messages.js',
];

let loadCounter = 0;

/**
 * Loads classic scripts into a brand-new `globalThis.AtPeace`.
 * Install a fake `browser` BEFORE calling this if the scripts read `AP.api` at load time.
 * @param {string[]} relPaths repo-relative paths, in load order
 * @returns {Promise<any>} globalThis.AtPeace
 */
export async function loadAtPeace(relPaths) {
  delete globalThis.AtPeace;
  for (const rel of relPaths) {
    const url = pathToFileURL(join(ROOT, rel));
    // A unique query defeats the module cache so every call re-runs the script (fresh state).
    url.searchParams.set('load', String(++loadCounter));
    await import(url.href);
  }
  return globalThis.AtPeace;
}

// ---------------------------------------------------------------------------------------------
// Fake `browser`
// ---------------------------------------------------------------------------------------------

/** Minimal WebExtension event: addListener / removeListener / hasListener (+ dispatch for tests). */
export function createEvent() {
  const listeners = [];
  return {
    addListener: (fn) => {
      if (!listeners.includes(fn)) listeners.push(fn);
    },
    removeListener: (fn) => {
      const i = listeners.indexOf(fn);
      if (i !== -1) listeners.splice(i, 1);
    },
    hasListener: (fn) => listeners.includes(fn),
    /** Test-only: calls every listener, returns their return values. */
    dispatch: (...args) => [...listeners].map((fn) => fn(...args)),
    get listeners() {
      return [...listeners];
    },
  };
}

/**
 * One storage area (local / session). Mirrors the real API where it matters for our code:
 * - values are copied in and out (structured clone), so callers cannot mutate stored state;
 * - `get(null | undefined)` returns everything, `get(string | string[])` only present keys,
 *   `get({ key: default })` fills in defaults;
 * - `onChanged` fires only for keys whose value actually changed, with `{ oldValue?, newValue? }`
 *   (a missing `oldValue` = key was new, a missing `newValue` = key was removed);
 * - listeners run synchronously inside set/remove/clear, after the write is applied.
 * @param {string} areaName
 * @param {{ dispatch: Function }} rootChanged the shared `storage.onChanged` event
 */
function createStorageArea(areaName, rootChanged) {
  const data = new Map();
  const onChanged = createEvent();

  const emit = (changes) => {
    if (Object.keys(changes).length === 0) return;
    onChanged.dispatch(changes);
    rootChanged.dispatch(changes, areaName);
  };

  const keysOf = (keys) => (typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : []);

  return {
    onChanged,

    async get(keys) {
      const out = {};
      if (keys === undefined || keys === null) {
        for (const [k, v] of data) out[k] = structuredClone(v);
      } else if (typeof keys === 'string' || Array.isArray(keys)) {
        for (const k of keysOf(keys)) if (data.has(k)) out[k] = structuredClone(data.get(k));
      } else {
        for (const [k, def] of Object.entries(keys)) {
          out[k] = structuredClone(data.has(k) ? data.get(k) : def);
        }
      }
      return out;
    },

    async set(items) {
      const changes = {};
      for (const [k, v] of Object.entries(items)) {
        const next = structuredClone(v);
        const had = data.has(k);
        const prev = data.get(k);
        if (had && isDeepStrictEqual(prev, next)) continue;
        data.set(k, next);
        changes[k] = had ? { oldValue: structuredClone(prev), newValue: structuredClone(next) } : { newValue: structuredClone(next) };
      }
      emit(changes);
    },

    async remove(keys) {
      const changes = {};
      for (const k of keysOf(keys)) {
        if (!data.has(k)) continue;
        changes[k] = { oldValue: structuredClone(data.get(k)) };
        data.delete(k);
      }
      emit(changes);
    },

    async clear() {
      const changes = {};
      for (const [k, v] of data) changes[k] = { oldValue: structuredClone(v) };
      data.clear();
      emit(changes);
    },
  };
}

/**
 * Builds a fake `browser` object. `runtime.sendMessage` delivers to this same fake's
 * `runtime.onMessage` listeners (as if the sender were another context), following the real
 * rules: first listener that returns `true`/a Promise or calls sendResponse answers; no listener
 * rejects with the "Receiving end does not exist" error.
 * @param {{ version?: string, sender?: object }} [options]
 */
export function createFakeBrowser({ version = '0.0.0-test', sender = { id: 'fake@at-peace' } } = {}) {
  const storageChanged = createEvent();
  const onMessage = createEvent();
  const removedTabs = [];

  return {
    storage: {
      onChanged: storageChanged,
      local: createStorageArea('local', storageChanged),
      session: createStorageArea('session', storageChanged),
    },

    runtime: {
      id: 'fake@at-peace',
      onMessage,
      onInstalled: createEvent(),
      onStartup: createEvent(),
      getManifest: () => ({ manifest_version: 3, name: 'At Peace', version }),
      getURL: (path) => `moz-extension://fake-uuid/${String(path).replace(/^\//, '')}`,

      sendMessage(message) {
        const listeners = onMessage.listeners;
        if (listeners.length === 0) {
          return Promise.reject(new Error('Could not establish connection. Receiving end does not exist.'));
        }
        return new Promise((resolve) => {
          let settled = false;
          const sendResponse = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
          };
          let respondsLater = false;
          for (const fn of listeners) {
            const result = fn(structuredClone(message), sender, sendResponse);
            if (result === true) respondsLater = true;
            else if (result && typeof result.then === 'function') {
              respondsLater = true;
              result.then(sendResponse);
            }
            if (settled) return;
          }
          if (!respondsLater && !settled) resolve(undefined);
        });
      },
    },

    tabs: {
      removed: removedTabs,
      async remove(id) {
        removedTabs.push(id);
      },
    },
  };
}

/** Installs a fresh fake as `globalThis.browser` and returns it. Call before loading scripts. */
export function installFakeBrowser(options) {
  const fake = createFakeBrowser(options);
  globalThis.browser = fake;
  return fake;
}

/** Removes the fake (and AtPeace) from globalThis. Call in `afterEach`/`after`. */
export function uninstallFakeBrowser() {
  delete globalThis.browser;
  delete globalThis.AtPeace;
}
