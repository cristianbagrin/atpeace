// The isolated-world end of the MAIN-world page bridge (src/sites/youtube/page-bridge.js).
//
//   AP.yt.bridge.call('setAutonav', false)  →  Promise<{ ok: true, value? } | { ok: false, error }>
//
// It never rejects and never throws: when the bridge is absent (MAIN-world injection blocked,
// an old page that loaded before the extension, a browser without `world: "MAIN"`) or does not
// answer in time, the promise resolves `{ ok: false, error: 'no-bridge' | 'timeout' }` and the
// callers fall back to DOM methods or do nothing. Other error codes come from the bridge:
// 'no-player', 'no-method', 'bad-command', 'bad-argument', 'failed'.
//
// Protocol (all `window.postMessage`, same window only; the page can read it, so the nonce is an
// anti-crosstalk measure, not a secret): see the header of page-bridge.js.
//   hello → hello-ack handshake (repeated whenever the bridge announces `ready`, so it works
//   whichever of the two scripts starts first), then cmd/res pairs matched by id.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;
  AP.yt ??= {};

  const NS = 'at-peace';
  const HANDSHAKE_MS = 2500;
  const COMMAND_MS = 2000;
  /** After a failed handshake, do not make every caller wait again for this long. */
  const RETRY_AFTER_MS = 10_000;

  let nonce = null;
  let listening = false;
  let acked = false;
  let nextId = 1;
  let failedAt = -Infinity;
  /** @type {Map<number, (res: object) => void>} */
  const pending = new Map();
  /** @type {Array<(connected: boolean) => void>} callers waiting for the handshake */
  let waiting = [];

  const origin = () => globalThis.location?.origin ?? '*';

  function post(message) {
    try {
      globalThis.postMessage({ ns: NS, ...message }, origin());
    } catch (err) {
      AP.log('[bridge] postMessage failed', err);
    }
  }

  function hello() {
    post({ dir: 'hello', nonce });
  }

  function onMessage(event) {
    try {
      if (event.source !== globalThis) return;
      const msg = event.data;
      if (msg === null || typeof msg !== 'object' || msg.ns !== NS) return;
      if (msg.dir === 'ready') {
        // The bridge (re)started or only just loaded: introduce ourselves again.
        acked = false;
        hello();
      } else if (msg.dir === 'hello-ack') {
        acked = true;
        const resolvers = waiting;
        waiting = [];
        for (const resolve of resolvers) resolve(true);
      } else if (msg.dir === 'res' && msg.nonce === nonce) {
        const done = pending.get(msg.id);
        if (done) {
          pending.delete(msg.id);
          const { ok, value, error } = msg;
          done(ok === true ? { ok: true, value } : { ok: false, error: typeof error === 'string' ? error : 'failed' });
        }
      }
    } catch {
      /* a malformed message from the page must never break us */
    }
  }

  /** Starts listening and says hello (once). */
  function start() {
    if (listening) return;
    listening = true;
    nonce = AP.util?.uid ? `${AP.util.uid('n')}${AP.util.uid('')}` : `n_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    globalThis.addEventListener('message', onMessage);
    hello();
  }

  /** Resolves true once the bridge has acknowledged us, false after the handshake timeout. */
  function handshake() {
    if (acked) return Promise.resolve(true);
    if (Date.now() - failedAt < RETRY_AFTER_MS) return Promise.resolve(false);
    start();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        waiting = waiting.filter((fn) => fn !== settle);
        failedAt = Date.now();
        resolve(false);
      }, HANDSHAKE_MS);
      const settle = (connected) => {
        clearTimeout(timer);
        resolve(connected);
      };
      waiting.push(settle);
      if (listening && !acked) hello(); // a hello that raced the bridge's load is repeated here
    });
  }

  /**
   * Runs a bridge command.
   * @param {string} cmd  setAutonav | setPlaybackRate | getPlaybackRate | pauseVideo | getPlayerState | keepActive | setTags | setDebug | retag
   * @param {...any} args JSON-able arguments
   * @returns {Promise<{ ok: true, value?: any } | { ok: false, error: string }>}
   */
  async function call(cmd, ...args) {
    try {
      if (!(await handshake())) return { ok: false, error: 'no-bridge' };
      const id = nextId++;
      return await new Promise((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          resolve({ ok: false, error: 'timeout' });
        }, COMMAND_MS);
        pending.set(id, (res) => {
          clearTimeout(timer);
          resolve(res);
        });
        post({ dir: 'cmd', nonce, id, cmd, args });
      });
    } catch (err) {
      AP.log('[bridge] call failed', cmd, err);
      return { ok: false, error: 'failed' };
    }
  }

  /** Stops listening (tests, extension teardown). The next call() starts over. */
  function stop() {
    if (listening) globalThis.removeEventListener('message', onMessage);
    listening = false;
    acked = false;
    nonce = null;
    failedAt = -Infinity;
    for (const done of pending.values()) done({ ok: false, error: 'no-bridge' });
    pending.clear();
    for (const resolve of waiting) resolve(false);
    waiting = [];
  }

  AP.yt.bridge = { call, start, stop, isReady: () => acked };
})();
