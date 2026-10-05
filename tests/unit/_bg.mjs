// Test world for the background (Phase 3c): the real background scripts on top of the fake
// `browser` of _load.mjs, extended with the pieces the background talks to — alarms,
// declarativeNetRequest (with the same refusals Chrome gives for RE2-incompatible regexes),
// scripting (content-script registration), permissions, commands and a few tabs calls.
import { loadAtPeace, createFakeBrowser, createEvent, CORE_SCRIPTS, SCHEMA_SCRIPTS } from './_load.mjs';

export const BACKGROUND_MODULES = [
  'src/shared/lock.js',
  'src/background/store.js',
  'src/background/stats.js',
  'src/background/sessions.js',
  'src/background/rules.js',
  'src/background/guards.js',
  'src/background/background.js',
];

/** Exactly what manifest.json's background.scripts loads (tests/unit/manifest.test.mjs keeps them equal). */
export const BACKGROUND_SCRIPTS = [...CORE_SCRIPTS, ...SCHEMA_SCRIPTS, ...BACKGROUND_MODULES];

/** What RE2 (Chrome's DNR regex engine) refuses: lookarounds and backreferences. */
const NOT_RE2 = /\(\?[=!<]|\\[1-9]/;

/**
 * @param {{ version?: string, grantedOrigins?: string[] }} [options]
 */
export function createBgBrowser(options = {}) {
  const base = createFakeBrowser({ version: options.version ?? '1.2.3' });

  // --- declarativeNetRequest -------------------------------------------------------------
  const rules = [];
  const dnr = {
    calls: [],
    /** ids that updateDynamicRules refuses (to test the fallback path). */
    refuseIds: new Set(),
    async getDynamicRules() {
      return structuredClone(rules);
    },
    async updateDynamicRules({ removeRuleIds = [], addRules = [] } = {}) {
      dnr.calls.push({ removeRuleIds: [...removeRuleIds], addRules: structuredClone(addRules) });
      const next = rules.filter((r) => !removeRuleIds.includes(r.id));
      for (const rule of addRules) {
        if (dnr.refuseIds.has(rule.id)) throw new Error(`Rule with id ${rule.id} refused by the test`);
        if (!Number.isInteger(rule.id) || rule.id < 1) throw new Error(`bad rule id ${rule.id}`);
        if (next.some((r) => r.id === rule.id)) throw new Error(`Rule with id ${rule.id} does not have a unique ID.`);
        const regex = rule.condition?.regexFilter;
        if (regex !== undefined && NOT_RE2.test(regex)) throw new Error(`regexFilter '${regex}' is not supported (RE2)`);
        if (regex !== undefined) new RegExp(regex); // must at least be a valid regex
        next.push(structuredClone(rule));
      }
      rules.length = 0;
      rules.push(...next);
    },
  };

  // --- alarms ----------------------------------------------------------------------------
  const alarmList = [];
  const alarms = {
    onAlarm: createEvent(),
    list: alarmList,
    async create(name, info) {
      const at = info.when ?? Date.now() + (info.delayInMinutes ?? 0) * 60_000;
      const i = alarmList.findIndex((a) => a.name === name);
      const alarm = { name, scheduledTime: at, ...(info.periodInMinutes ? { periodInMinutes: info.periodInMinutes } : {}) };
      if (i === -1) alarmList.push(alarm);
      else alarmList[i] = alarm;
    },
    async getAll() {
      return structuredClone(alarmList);
    },
    async clear(name) {
      const i = alarmList.findIndex((a) => a.name === name);
      if (i !== -1) alarmList.splice(i, 1);
      return i !== -1;
    },
  };

  // --- scripting & permissions -------------------------------------------------------------
  const registered = [];
  const scripting = {
    registered,
    async registerContentScripts(list) {
      for (const s of list) {
        if (registered.some((r) => r.id === s.id)) throw new Error(`Duplicate script ID '${s.id}'`);
        registered.push(structuredClone(s));
      }
    },
    async updateContentScripts(list) {
      for (const s of list) {
        const i = registered.findIndex((r) => r.id === s.id);
        if (i === -1) throw new Error(`Content script with ID '${s.id}' does not exist`);
        registered[i] = { ...registered[i], ...structuredClone(s) };
      }
    },
    async unregisterContentScripts({ ids } = {}) {
      for (const id of ids ?? registered.map((r) => r.id)) {
        const i = registered.findIndex((r) => r.id === id);
        if (i !== -1) registered.splice(i, 1);
      }
    },
    async getRegisteredContentScripts({ ids } = {}) {
      return structuredClone(registered.filter((r) => !ids || ids.includes(r.id)));
    },
  };

  const granted = new Set(options.grantedOrigins ?? []);
  const permissions = {
    granted,
    onAdded: createEvent(),
    onRemoved: createEvent(),
    async contains({ origins = [] } = {}) {
      return origins.every((o) => granted.has(o));
    },
  };

  // --- tabs, commands, runtime extras ------------------------------------------------------
  const created = [];
  const sentToTabs = [];
  const tabs = {
    ...base.tabs,
    created,
    sentToTabs,
    activeTab: { id: 7 },
    async create(props) {
      created.push(props);
      return { id: 100 + created.length, ...props };
    },
    async query() {
      return tabs.activeTab ? [tabs.activeTab] : [];
    },
    async sendMessage(id, message) {
      sentToTabs.push({ id, message });
      return { ok: true };
    },
  };

  const fake = {
    ...base,
    declarativeNetRequest: dnr,
    alarms,
    scripting,
    permissions,
    tabs,
    commands: { onCommand: createEvent() },
    runtime: {
      ...base.runtime,
      optionsPageOpened: 0,
      async openOptionsPage() {
        fake.runtime.optionsPageOpened++;
      },
    },
  };
  return fake;
}

/**
 * A fresh background: fake browser installed, every background script loaded, clock under test control.
 * @param {{ version?: string, grantedOrigins?: string[], now?: number }} [options]
 */
export async function bgWorld(options = {}) {
  const fake = createBgBrowser(options);
  globalThis.browser = fake;
  const AP = await loadAtPeace(BACKGROUND_SCRIPTS);
  let t = options.now ?? new Date(2026, 5, 10, 12, 0, 0).getTime();
  AP.bg.clock.now = () => t;
  return {
    AP,
    fake,
    /** Current fake time (ms). */
    now: () => t,
    /** Moves the clock; returns the new time. */
    set(ms) {
      t = ms;
      return t;
    },
    advance(ms) {
      t += ms;
      return t;
    },
    /** Writes settings (merged with what is stored). */
    async settings(patch) {
      const { settings = {} } = await fake.storage.local.get('settings');
      await fake.storage.local.set({ settings: { ...settings, ...patch } });
    },
    /** Normalized background view of `state`. */
    state: () => AP.bg.store.readState(),
    /** Dynamic rules as the browser holds them, sorted by id. */
    async rules() {
      return (await fake.declarativeNetRequest.getDynamicRules()).sort((a, b) => a.id - b.id);
    },
  };
}
