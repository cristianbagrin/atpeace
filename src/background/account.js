// Optional account (Settings → Account): the same account as Chris's other apps, at
// account.cristianbagrin.com. It keeps `settings` and `customPresets` in step across browsers.
// Nothing else leaves the browser: no stats, no state, and never the settings lock (its password
// hash stays on each device).
//
// Every change to a synced key is noted with its time and sent up; changes from other browsers come
// down in the same request. Per key, the newer change wins. While the settings lock holds, changes
// from other browsers wait (the account's position is not advanced), so another device can't be used
// to loosen a locked browser; they land once it is unlocked.
//
// Storage: `account` { email, token, seq, at?, error?, held? } and `account:dirty` { key: changedAt }.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;
  const api = AP.api;
  const bg = (AP.bg ??= {});
  const { isPlainObject } = AP.util;

  const API = 'https://account.cristianbagrin.com/api/';
  const APP = 'ap';
  const SYNCED = ['settings', 'customPresets'];
  /** Settings that stay on this device. */
  const LOCAL_ONLY = ['advanced.lock'];
  const ALARM = 'account-sync';
  const SOON_MS = 3000;

  const remoteKey = (k) => `@${APP}/${k}`;
  const localKey = (k) => (typeof k === 'string' && k.startsWith(`@${APP}/`) ? k.slice(APP.length + 2) : null);

  /** JSON with object keys in order, so equal values compare equal. */
  function stable(v) {
    if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
    if (v && typeof v === 'object') return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
    return JSON.stringify(v ?? null);
  }

  /** A key's value as it travels: settings without the device-only ones. */
  function travel(k, v) {
    if (k !== 'settings' || !isPlainObject(v)) return v ?? null;
    const out = { ...v };
    for (const id of LOCAL_ONLY) delete out[id];
    return out;
  }

  class ApiError extends Error {
    constructor(message, code) {
      super(message);
      this.code = code;
    }
  }

  async function call(path, body, token) {
    let res;
    try {
      res = await fetch(API + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new ApiError('Can’t reach your account. Check your connection.', 'offline');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(data.error ?? 'Something went wrong. Try again in a moment.', data.code ?? 'server');
    return data;
  }

  const read = async () => {
    const got = await api.storage.local.get(['account', 'account:dirty']);
    return { acct: isPlainObject(got.account) ? got.account : null, dirty: isPlainObject(got['account:dirty']) ? got['account:dirty'] : {} };
  };

  /** What sync itself just wrote, so storage.onChanged doesn't send it back up. */
  const applied = new Map();
  let timer;
  let running = null;

  async function isLocked() {
    const settings = await AP.settings.effective();
    const { lockUnlockedUntil } = await bg.store.readState();
    return AP.lock.status(settings['advanced.lock'], lockUnlockedUntil, bg.clock.now()).locked;
  }

  function soon() {
    clearTimeout(timer);
    timer = setTimeout(() => void now(), SOON_MS);
  }

  /** storage.onChanged: note the synced keys that changed here. */
  async function noteChanges(changes) {
    const keys = SYNCED.filter((k) => k in changes);
    if (keys.length === 0) return;
    const { acct, dirty } = await read();
    if (!acct?.token) return;
    let any = false;
    for (const k of keys) {
      const next = stable(travel(k, changes[k].newValue));
      if (applied.get(k) === next) {
        applied.delete(k);
        continue;
      }
      if (stable(travel(k, changes[k].oldValue)) === next) continue; // only the lock changed
      dirty[k] = bg.clock.now();
      any = true;
    }
    if (!any) return;
    await api.storage.local.set({ 'account:dirty': dirty });
    soon();
  }

  async function status() {
    const { acct, dirty } = await read();
    return { ok: true, email: acct?.email ?? '', signedIn: !!acct?.token, at: acct?.at ?? 0, error: acct?.error ?? '', held: !!acct?.held, pending: Object.keys(dirty).length };
  }

  /** Sign in (or create the account), then merge: the account's copy wins where it has one. */
  async function signIn({ email, password, create } = {}) {
    try {
      const res = await call(create ? 'signup' : 'login', { email: String(email ?? ''), password: String(password ?? '') });
      const dirty = {};
      for (const k of SYNCED) dirty[k] = 1;
      await api.storage.local.set({ account: { email: res.email, token: res.token, seq: 0 }, 'account:dirty': dirty });
    } catch (err) {
      return { ...(await status()), ok: false, error: err.message };
    }
    await now();
    return status();
  }

  async function signOut() {
    const { acct } = await read();
    await api.storage.local.remove(['account', 'account:dirty']);
    if (acct?.token) await call('logout', {}, acct.token).catch(() => {});
    return status();
  }

  async function forgot({ email } = {}) {
    try {
      await call('forgot', { email: String(email ?? ''), app: APP });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  /** Send what changed here and take what changed elsewhere. One run at a time. */
  function now() {
    running ??= run().finally(() => (running = null));
    return running;
  }

  async function run() {
    let { acct, dirty } = await read();
    if (!acct?.token) return;
    try {
      const keys = Object.keys(dirty).filter((k) => SYNCED.includes(k));
      const sent = Object.fromEntries(keys.map((k) => [k, dirty[k]]));
      const have = keys.length ? await api.storage.local.get(keys) : {};
      const changes = keys.filter((k) => have[k] !== undefined).map((k) => ({ k: remoteKey(k), v: travel(k, have[k]), t: sent[k] }));
      const res = await call('sync', { app: APP, since: acct.seq, changes }, acct.token);
      ({ acct, dirty } = await read());
      if (!acct?.token) return; // signed out meanwhile
      for (const k of keys) if (dirty[k] === sent[k]) delete dirty[k];
      const incoming = (res.changes ?? []).filter((c) => localKey(c.k) && SYNCED.includes(localKey(c.k)));
      const held = incoming.length > 0 && (await isLocked());
      if (!held) {
        await apply(incoming, dirty);
        acct.seq = res.seq;
      }
      acct.held = held;
      acct.at = bg.clock.now();
      delete acct.error;
      await api.storage.local.set({ account: acct, 'account:dirty': dirty });
      if (res.more && !held) return run();
    } catch (err) {
      ({ acct, dirty } = await read());
      if (!acct) return;
      if (err.code === 'signed_out') {
        // The password changed, or the account is gone: this browser keeps its settings.
        acct.token = '';
        dirty = {};
      }
      acct.error = err.message;
      await api.storage.local.set({ account: acct, 'account:dirty': dirty });
    }
  }

  async function apply(incoming, dirty) {
    const set = {};
    for (const c of incoming) {
      const k = localKey(c.k);
      if ((dirty[k] ?? 0) > c.t || c.v == null) continue; // changed here since: ours goes up next
      set[k] = c.v;
    }
    if (isPlainObject(set.settings)) {
      const { settings: mine } = await api.storage.local.get('settings');
      const keep = {};
      for (const id of LOCAL_ONLY) if (isPlainObject(mine) && Object.hasOwn(mine, id)) keep[id] = mine[id];
      const next = { ...travel('settings', set.settings), ...keep };
      set.settings = next;
    } else delete set.settings;
    if (!Array.isArray(set.customPresets) && !isPlainObject(set.customPresets)) delete set.customPresets;
    if (Object.keys(set).length === 0) return;
    for (const [k, v] of Object.entries(set)) applied.set(k, stable(travel(k, v)));
    await api.storage.local.set(set);
    setTimeout(() => applied.clear(), 2000);
  }

  /** From background.js's storage.onChanged listener (one listener per event, registered there). */
  function onStorage(changes) {
    noteChanges(changes).catch((err) => AP.warn('account: noting a change failed', err));
    // The lock may have just opened: let held changes land.
    if ('state' in changes) {
      read()
        .then(({ acct }) => (acct?.held ? now() : undefined))
        .catch(() => {});
    }
  }
  /** From background.js's alarms.onAlarm listener. */
  function onAlarm(alarm) {
    if (alarm?.name === ALARM) void now();
  }

  api.alarms?.get?.(ALARM)?.then?.((a) => a || api.alarms.create(ALARM, { periodInMinutes: 30 }))?.catch?.(() => {});
  read()
    .then(({ acct, dirty }) => (acct?.token && (Object.keys(dirty).length || bg.clock.now() - (acct.at ?? 0) > 15 * 60_000) ? now() : undefined))
    .catch(() => {});

  bg.account = { status, signIn, signOut, forgot, now, travel, onStorage, onAlarm, API, APP };
})();
