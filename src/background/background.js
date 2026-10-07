// Background entry. Firefox runs this as a non-persistent event page, Chrome (tests only) as a
// service worker via sw-chrome.js. Either way: NO in-memory state that matters — read from storage
// on each event (PLAN §8). Listeners must be registered synchronously at top level so the browser
// can wake us for them.
//
// This file is the router and the lifecycle (install, startup, alarms, commands, storage changes).
// The substance lives next to it: sessions.js (pause sessions, focus, schedules, limit, reconcile),
// rules.js (DNR), stats.js (heartbeats, outcomes), guards.js (content-script registration for
// user-added sites), store.js (serialized storage access).
(() => {
  'use strict';
  const AP = globalThis.AtPeace;
  const api = AP.api;
  const T = AP.msg.TYPES;
  const bg = (AP.bg ??= {});
  const sessions = () => bg.sessions;

  const OPTIONS_PAGE = 'src/pages/options/options.html';
  const WELCOME_PAGE = 'src/pages/welcome/welcome.html';
  const STORAGE_KEYS_THAT_MATTER = ['settings', 'state', 'customPresets'];

  // ---------------------------------------------------------------------------------------
  // Small helpers
  // ---------------------------------------------------------------------------------------

  /** Site keys the background accepts stats and blocks for: YouTube plus every listed site. */
  async function knownSiteKeys() {
    return sessions().sitesOf(await AP.settings.effective());
  }

  /** Forwards START_PICKER to the active tab of the current window (the picker arrives in Phase 4). */
  async function forwardPicker() {
    try {
      const [tab] = await api.tabs.query({ active: true, currentWindow: true });
      if (tab?.id === undefined) return { ok: false, error: 'no-tab' };
      const reply = await api.tabs.sendMessage(tab.id, { type: T.START_PICKER });
      return { ok: true, reply };
    } catch {
      return { ok: false, error: 'no-picker' }; // not a YouTube tab, or the picker is not installed yet
    }
  }

  /**
   * Messages that open the settings lock, wipe history or write `meta` come from our own pages
   * only. A content script's sender has the web page's URL; an extension page's has ours (and the
   * unit tests' fake sender has none).
   */
  function fromExtensionPage(sender) {
    const url = sender?.url;
    return typeof url !== 'string' || url.startsWith(api.runtime.getURL(''));
  }

  /** Is the settings lock holding right now? (src/shared/lock.js) */
  async function isLocked() {
    const settings = await AP.settings.effective();
    const { lockUnlockedUntil } = await bg.store.readState();
    return AP.lock.status(settings['advanced.lock'], lockUnlockedUntil, bg.clock.now()).locked;
  }

  /**
   * LOCK_UNLOCK { password? | frictionDone? }: checks the password against the stored PBKDF2 hash
   * (password mode) or trusts the page that it made the person wait and type the sentence
   * (friction mode), then opens the lock for ten minutes.
   */
  async function onLockUnlock(payload, sender) {
    if (!fromExtensionPage(sender)) return { ok: false, error: 'not-allowed' };
    const lock = (await AP.settings.effective())['advanced.lock'];
    if (lock.mode === 'none') return { ok: true, unlockedUntil: 0 };
    if (lock.mode === 'password') {
      if (!(await AP.lock.verifyPassword(payload?.password, lock))) return { ok: false, error: 'wrong-password' };
    } else if (payload?.frictionDone !== true) {
      return { ok: false, error: 'friction-required' };
    }
    const until = bg.clock.now() + AP.lock.UNLOCK_MS;
    await bg.store.updateState((draft) => {
      draft.lockUnlockedUntil = until;
    });
    return { ok: true, unlockedUntil: until };
  }

  /** LOCK_RELOCK: close the lock again right away. */
  async function onLockRelock(_payload, sender) {
    if (!fromExtensionPage(sender)) return { ok: false, error: 'not-allowed' };
    await bg.store.updateState((draft) => {
      draft.lockUnlockedUntil = 0;
    });
    return { ok: true };
  }

  /**
   * STATS_CLEAR: forget all usage history. It resets today's count towards the daily limit, so
   * while the settings lock holds it needs an unlock like any other loosening.
   */
  async function onStatsClear(_payload, sender) {
    if (!fromExtensionPage(sender)) return { ok: false, error: 'not-allowed' };
    if (await isLocked()) return { ok: false, error: 'locked' };
    const days = await bg.stats.clear();
    await sessions().reconcile(); // a limit block that rested on the cleared numbers goes away
    return { ok: true, days };
  }

  /** ONBOARDING_DONE: the welcome page was finished. Only the background writes `meta`. */
  async function onOnboardingDone(_payload, sender) {
    if (!fromExtensionPage(sender)) return { ok: false, error: 'not-allowed' };
    await bg.store.queue('meta', async () => {
      const { meta } = await AP.settings.readStorage('meta');
      const stored = AP.util.isPlainObject(meta) ? meta : {};
      await api.storage.local.set({
        meta: { schemaVersion: AP.settings.SCHEMA_VERSION, installedAt: bg.clock.now(), lastVersion: api.runtime.getManifest().version, ...stored, onboarded: true },
      });
    });
    return { ok: true };
  }

  // ---------------------------------------------------------------------------------------
  // Message handlers
  // ---------------------------------------------------------------------------------------

  /**
   * Message router table: type → `(payload, sender) => response | Promise<response>`.
   * @type {Record<string, (payload: any, sender: any) => any>}
   */
  const handlers = {
    [T.GET_STATUS]: () => sessions().handlers.onGetStatus(),
    [T.PAUSE_OPENED]: (payload) => sessions().handlers.onPauseOpened(payload),
    [T.PAUSE_CONTINUE]: (payload) => sessions().handlers.onPauseContinue(payload),
    [T.PAUSE_TURN_BACK]: (payload) => sessions().handlers.onPauseTurnBack(payload),
    [T.FOCUS_START]: (payload) => sessions().handlers.onFocusStart(payload),
    [T.FOCUS_END]: (payload) => sessions().handlers.onFocusEnd(payload),
    [T.LIMIT_GRACE]: () => sessions().handlers.onLimitGrace(),
    [T.LOCK_UNLOCK]: onLockUnlock,
    [T.LOCK_RELOCK]: onLockRelock,
    [T.STATS_CLEAR]: onStatsClear,
    [T.ONBOARDING_DONE]: onOnboardingDone,

    [T.HEARTBEAT]: async (payload) => {
      const siteKey = payload?.siteKey;
      if (!bg.store.isSiteKey(siteKey) || !(await knownSiteKeys()).has(siteKey)) return { ok: false, error: 'bad-site' };
      const beat = await bg.stats.heartbeat(siteKey);
      // Only the moment the daily limit may have been crossed needs more than the stats write.
      if (beat.counted && siteKey === 'youtube') {
        const settings = await AP.settings.effective();
        if (Number(settings['focus.dailyMinutes']) > 0) {
          const state = await bg.store.readState();
          if (sessions().limitStatus(settings, state, { activeSec: beat.activeSec }, bg.clock.now()).reached) await sessions().reconcile();
        }
      }
      return { ok: true, counted: beat.counted };
    },

    [T.BLOCKED_OPENED]: async (payload) => {
      const siteKey = payload?.siteKey;
      if (!bg.store.isSiteKey(siteKey) || !(await knownSiteKeys()).has(siteKey)) return { ok: false, error: 'bad-site' };
      await bg.stats.recordCount(siteKey, 'blockedHits');
      return { ok: true };
    },

    [T.CLOSE_TAB]: async (_payload, sender) => {
      const tabId = sender?.tab?.id;
      if (tabId === undefined) return { ok: false, error: 'no-tab' };
      await api.tabs.remove(tabId);
      return { ok: true };
    },

    [T.OPEN_OPTIONS]: async (payload) => {
      const section = typeof payload?.section === 'string' && /^[\w.-]{1,60}$/.test(payload.section) ? payload.section : null;
      if (section) await api.tabs.create({ url: `${api.runtime.getURL(OPTIONS_PAGE)}#${section}` });
      else await api.runtime.openOptionsPage();
      return { ok: true };
    },

    [T.START_PICKER]: () => forwardPicker(),
  };

  /**
   * Resolves the response for one message. Never throws: handler failures become `{ ok:false }`.
   * @param {unknown} message
   * @param {any} sender
   * @returns {Promise<{ ok: boolean, [k: string]: any }>}
   */
  async function handleMessage(message, sender) {
    const type = AP.util.isPlainObject(message) ? message.type : undefined;
    // hasOwn: a message type like "toString" must not reach Object.prototype members.
    if (typeof type !== 'string' || !Object.hasOwn(handlers, type)) {
      return { ok: false, error: 'unknown' };
    }
    try {
      return await handlers[type](message.payload, sender);
    } catch (err) {
      AP.warn(`handler for ${type} failed`, err);
      return { ok: false, error: 'handler-failed' };
    }
  }

  // ---------------------------------------------------------------------------------------
  // Install, update, startup
  // ---------------------------------------------------------------------------------------

  /** Opens the welcome page when it exists (Phase 4 adds it). */
  async function openWelcomeIfPresent() {
    try {
      const url = api.runtime.getURL(WELCOME_PAGE);
      const res = await fetch(url);
      if (res.ok) await api.tabs.create({ url });
    } catch {
      /* no welcome page (yet): nothing to open */
    }
  }

  /**
   * First install: write `meta`, start from the Gentle preset, welcome the person. Update: migrate
   * stored settings if the layout changed. Either way the rules and alarms are brought up to date.
   * @param {{ reason?: string }} [details]
   */
  async function onInstalled(details = {}) {
    const version = api.runtime.getManifest().version;
    AP.log('onInstalled', details.reason, version);
    const now = bg.clock.now();
    try {
      if (details.reason === 'install') {
        await bg.store.queue('meta', () =>
          api.storage.local.set({ meta: { schemaVersion: AP.settings.SCHEMA_VERSION, installedAt: now, onboarded: false, lastVersion: version } }),
        );
        if (Object.keys(await AP.settings.load()).length === 0) await AP.settings.applyPreset(AP.presets.DEFAULT_ID);
        await openWelcomeIfPresent();
      } else if (details.reason === 'update') {
        await bg.store.queue('meta', async () => {
          const { meta, settings } = await AP.settings.readStorage(['meta', 'settings']);
          const stored = AP.util.isPlainObject(meta) ? meta : {};
          const from = Number.isInteger(stored.schemaVersion) ? stored.schemaVersion : 1;
          const next = { installedAt: now, onboarded: false, ...stored, schemaVersion: AP.settings.SCHEMA_VERSION, lastVersion: version };
          const patch = { meta: next };
          if (from < AP.settings.SCHEMA_VERSION) patch.settings = AP.settings.migrate(settings, from);
          await api.storage.local.set(patch);
          if (from < 2) await bg.stats.dropLegacyIntentions(); // 0.1.0 kept "what did you come for" lines in the stats
        });
      }
    } catch (err) {
      AP.warn('install handling failed', err);
    }
    await refreshEverything();
  }

  /** Rules, alarms, guard registration: everything derived from storage. */
  async function refreshEverything() {
    try {
      await sessions().reconcile();
      await bg.guards.sync();
    } catch (err) {
      AP.warn('refresh failed', err);
    }
  }

  // ---------------------------------------------------------------------------------------
  // Commands (keyboard shortcuts)
  // ---------------------------------------------------------------------------------------

  /** @param {string} name one of the manifest `commands` */
  async function onCommand(name) {
    try {
      if (name === 'toggle-enabled') {
        const settings = await AP.settings.effective();
        // Behind the settings lock: turning At Peace off is a loosening, turning it on is not.
        await AP.lock.save({ 'general.enabled': settings['general.enabled'] === false });
      } else if (name === 'focus-25') {
        await sessions().handlers.onFocusStart({ minutes: 25 });
      } else if (name === 'open-picker') {
        await forwardPicker();
      }
    } catch (err) {
      AP.warn(`command ${name} failed`, err);
    }
  }

  // ---------------------------------------------------------------------------------------
  // Listeners (registered synchronously, as an event page requires)
  // ---------------------------------------------------------------------------------------

  // Chrome MV3 does not accept a returned Promise from onMessage listeners, so answer through
  // sendResponse and return true (keep the channel open). Works identically in Firefox.
  api.runtime.onMessage.addListener((message, sender, sendResponse) => {
    handleMessage(message, sender).then(sendResponse);
    return true;
  });

  api.runtime.onInstalled.addListener((details) => {
    onInstalled(details);
  });

  api.runtime.onStartup.addListener(() => {
    AP.log('onStartup');
    refreshEverything();
  });

  // Settings, state or presets changed (an options page, a schedule override, a test…): recompute
  // the derived things. The write we cause ourselves settles after one extra no-op pass.
  let pendingKeys = new Set();
  const onStorageSettled = AP.util.debounce(() => {
    const keys = pendingKeys;
    pendingKeys = new Set();
    sessions()
      .reconcile()
      .then(() => (keys.has('settings') ? bg.guards.sync() : undefined))
      .catch((err) => AP.warn('reacting to a storage change failed', err));
  }, 30);
  api.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    for (const key of STORAGE_KEYS_THAT_MATTER) if (key in changes) pendingKeys.add(key);
    if (pendingKeys.size > 0) onStorageSettled();
  });

  api.alarms?.onAlarm?.addListener(() => {
    sessions()
      .reconcile()
      .catch((err) => AP.warn('alarm handling failed', err));
  });

  api.commands?.onCommand?.addListener((name) => {
    onCommand(name);
  });

  const onPermissionsChanged = () => {
    bg.guards.sync().catch((err) => AP.warn('guard sync failed', err));
  };
  api.permissions?.onAdded?.addListener(onPermissionsChanged);
  api.permissions?.onRemoved?.addListener(onPermissionsChanged);

  AP.background = { handlers, handleMessage, onInstalled, onCommand, refreshEverything };
})();
