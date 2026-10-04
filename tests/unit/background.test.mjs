// The background router and lifecycle (src/background/background.js), on top of the real
// background modules and a fake browser (tests/unit/_bg.mjs).
import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { uninstallFakeBrowser } from './_load.mjs';
import { bgWorld } from './_bg.mjs';

let w;
let AP;
let fake;

beforeEach(async () => {
  w = await bgWorld();
  ({ AP, fake } = w);
  mock.method(console, 'warn', () => {});
});

afterEach(() => {
  mock.restoreAll();
  uninstallFakeBrowser();
});

const send = (type, payload, sender = {}) => AP.background.handleMessage({ type, payload }, sender);

describe('background message router', () => {
  test('registers its listeners synchronously at load (required for event pages)', () => {
    assert.equal(fake.runtime.onMessage.listeners.length, 1);
    assert.equal(fake.runtime.onInstalled.listeners.length, 1);
    assert.equal(fake.runtime.onStartup.listeners.length, 1);
    assert.equal(fake.storage.onChanged.listeners.length, 1);
    assert.equal(fake.alarms.onAlarm.listeners.length, 1);
    assert.equal(fake.commands.onCommand.listeners.length, 1);
    assert.equal(fake.permissions.onAdded.listeners.length, 1);
    assert.equal(fake.permissions.onRemoved.listeners.length, 1);
  });

  test('every message type of the protocol has a handler', () => {
    for (const type of Object.values(AP.msg.TYPES)) assert.equal(typeof AP.background.handlers[type], 'function', type);
  });

  test('unknown types answer { ok:false, error:"unknown" }', async () => {
    assert.deepEqual(await AP.msg.send('NOPE'), { ok: false, error: 'unknown' });
  });

  test('inherited Object.prototype names are not handlers', async () => {
    for (const type of ['toString', 'constructor', '__proto__', 'hasOwnProperty']) {
      assert.deepEqual(await AP.background.handleMessage({ type }, {}), { ok: false, error: 'unknown' }, type);
    }
  });

  test('malformed messages are unknown, not crashes', async () => {
    for (const message of [undefined, null, 'GET_STATUS', 42, [], {}, { type: 7 }]) {
      assert.deepEqual(await AP.background.handleMessage(message, {}), { ok: false, error: 'unknown' });
    }
  });

  test('CLOSE_TAB closes sender.tab.id (also id 0), and fails cleanly without a tab', async () => {
    assert.deepEqual(await send('CLOSE_TAB', undefined, { tab: { id: 42 } }), { ok: true });
    assert.deepEqual(await send('CLOSE_TAB', undefined, { tab: { id: 0 } }), { ok: true });
    assert.deepEqual(fake.tabs.removed, [42, 0]);
    assert.deepEqual(await send('CLOSE_TAB'), { ok: false, error: 'no-tab' });
  });

  test('a throwing handler becomes { ok:false, error:"handler-failed" } and is logged', async () => {
    AP.background.handlers.BOOM = () => {
      throw new Error('nope');
    };
    assert.deepEqual(await AP.background.handleMessage({ type: 'BOOM' }, {}), { ok: false, error: 'handler-failed' });
    assert.equal(console.warn.mock.callCount(), 1);
  });

  test('handlers receive (payload, sender)', async () => {
    const calls = [];
    AP.background.handlers.ECHO = (payload, sender) => {
      calls.push([payload, sender]);
      return { ok: true };
    };
    await AP.background.handleMessage({ type: 'ECHO', payload: { a: 1 } }, { tab: { id: 3 } });
    assert.deepEqual(calls, [[{ a: 1 }, { tab: { id: 3 } }]]);
  });

  test('OPEN_OPTIONS opens the options page, or a section of it', async () => {
    assert.deepEqual(await send('OPEN_OPTIONS'), { ok: true });
    assert.equal(fake.runtime.optionsPageOpened, 1);
    assert.deepEqual(await send('OPEN_OPTIONS', { section: 'focus' }), { ok: true });
    assert.deepEqual(fake.tabs.created, [{ url: 'moz-extension://fake-uuid/src/pages/options/options.html#focus' }]);
    // a hostile section name never reaches the URL
    await send('OPEN_OPTIONS', { section: '"><script>' });
    assert.equal(fake.runtime.optionsPageOpened, 2);
  });

  test('START_PICKER is forwarded to the active tab', async () => {
    assert.deepEqual((await send('START_PICKER')).ok, true);
    assert.deepEqual(fake.tabs.sentToTabs, [{ id: 7, message: { type: 'START_PICKER' } }]);
    fake.tabs.activeTab = null;
    assert.deepEqual(await send('START_PICKER'), { ok: false, error: 'no-tab' });
  });
});

describe('HEARTBEAT and BLOCKED_OPENED', () => {
  test('beats of known sites are counted; unknown or malformed site keys are refused', async () => {
    assert.equal((await send('HEARTBEAT', { siteKey: 'youtube' })).ok, true);
    for (const siteKey of ['reddit.com', '', 5, undefined, '../x']) {
      assert.deepEqual(await send('HEARTBEAT', { siteKey }), { ok: false, error: 'bad-site' }, String(siteKey));
    }
    assert.deepEqual((await send('HEARTBEAT')).error, 'bad-site');
  });

  test('a beat that crosses the daily limit turns the block on at once (rules updated)', async () => {
    await w.settings({ 'focus.dailyMinutes': 1 });
    await send('GET_STATUS'); // settle
    assert.equal((await w.rules()).length, 0);
    await send('HEARTBEAT', { siteKey: 'youtube' }); // first beat: +30 s
    assert.equal((await w.rules()).length, 0);
    w.advance(30_000);
    await send('HEARTBEAT', { siteKey: 'youtube' }); // +30 s → 60 s = the limit
    const rules = await w.rules();
    assert.equal(rules.length, 1);
    assert.match(rules[0].action.redirect.regexSubstitution, /blocked\.html\?reason=limit#\\0$/);
  });

  test('BLOCKED_OPENED counts a hit for a known site', async () => {
    assert.deepEqual(await send('BLOCKED_OPENED', { siteKey: 'youtube', reason: 'focus' }), { ok: true });
    assert.equal((await AP.state.getStats(AP.util.dayKey(w.now()))).youtube.blockedHits, 1);
    assert.equal((await send('BLOCKED_OPENED', { siteKey: 'nope.com' })).ok, false);
  });
});

describe('GET_STATUS (Contract C3)', () => {
  test('has exactly the documented shape on a fresh install', async () => {
    const status = await send('GET_STATUS');
    assert.deepEqual(Object.keys(status).sort(), [
      'activeSchedules', 'block', 'blocks', 'limit', 'now', 'ok', 'scheduleOverride', 'sessions', 'today', 'version',
    ]);
    assert.equal(status.ok, true);
    assert.equal(status.version, '1.2.3');
    assert.equal(status.block, null);
    assert.deepEqual(status.sessions, {});
    assert.equal(status.scheduleOverride, null);
    assert.deepEqual(status.activeSchedules, []);
    assert.deepEqual(status.today, { youtube: { activeSec: 0, opens: 0, turnedBack: 0, continued: 0, blockedHits: 0 } });
    assert.deepEqual(status.limit, { dailyMinutes: 0, usedSec: 0, graceLeft: 1 });
  });

  test('reflects a focus block, a session, today\'s numbers and a running schedule', async () => {
    await w.settings({
      'pause.enabled': true,
      'focus.dailyMinutes': 30,
      'focus.schedules': [{ id: 's1', name: 'Work', days: [0, 1, 2, 3, 4, 5, 6], start: '09:00', end: '17:00', action: 'preset:focused', siteKeys: ['youtube'], enabled: true }],
    });
    await send('PAUSE_OPENED', { siteKey: 'youtube' });
    await send('PAUSE_CONTINUE', { siteKey: 'youtube', minutes: 15 });
    await send('HEARTBEAT', { siteKey: 'youtube' });
    const status = await send('GET_STATUS');
    assert.equal(status.sessions.youtube, w.now() + 15 * 60_000);
    assert.deepEqual(status.today.youtube, { activeSec: 30, opens: 1, turnedBack: 0, continued: 1, blockedHits: 0 });
    assert.deepEqual(status.limit, { dailyMinutes: 30, usedSec: 30, graceLeft: 1 });
    assert.equal(status.scheduleOverride, 'focused');
    assert.equal(status.activeSchedules.length, 1);
    assert.deepEqual(Object.keys(status.activeSchedules[0]).sort(), ['action', 'endsAt', 'id', 'name']);
    assert.equal(status.block, null, 'a preset schedule is not a block');
  });

  test('expired sessions are not reported', async () => {
    await w.settings({ 'pause.enabled': true });
    await AP.settings.readStorage('state');
    await fake.storage.local.set({ state: { sessions: { youtube: w.now() + 1000 } } });
    assert.ok((await send('GET_STATUS')).sessions.youtube);
    w.advance(5000);
    assert.deepEqual((await send('GET_STATUS')).sessions, {});
  });
});

describe('install and startup', () => {
  test('first install: meta written, Gentle preset applied, welcome page skipped when absent', async () => {
    await AP.background.onInstalled({ reason: 'install' });
    const { meta, settings } = await fake.storage.local.get(['meta', 'settings']);
    assert.deepEqual(meta, { schemaVersion: 1, installedAt: w.now(), onboarded: false, lastVersion: '1.2.3' });
    const gentle = AP.presets.get('gentle').values;
    assert.ok(Object.keys(gentle).length > 0);
    for (const [id, value] of Object.entries(gentle)) assert.deepEqual(settings[id], value, id);
    assert.deepEqual(fake.tabs.created, []);
  });

  test('first install opens the welcome page when it exists', async () => {
    mock.method(globalThis, 'fetch', async () => ({ ok: true }));
    await AP.background.onInstalled({ reason: 'install' });
    assert.deepEqual(fake.tabs.created, [{ url: 'moz-extension://fake-uuid/src/pages/welcome/welcome.html' }]);
  });

  test('a reinstall over existing settings never replaces them with the Gentle preset', async () => {
    await fake.storage.local.set({ settings: { 'general.theme': 'dark' } });
    await AP.background.onInstalled({ reason: 'install' });
    assert.deepEqual((await fake.storage.local.get('settings')).settings, { 'general.theme': 'dark' });
  });

  test('an update keeps settings, refreshes meta.lastVersion and migrates old layouts', async () => {
    await fake.storage.local.set({ settings: { 'general.theme': 'dark' }, meta: { schemaVersion: 1, installedAt: 5, onboarded: true, lastVersion: '0.0.1' } });
    await AP.background.onInstalled({ reason: 'update' });
    const { meta, settings } = await fake.storage.local.get(['meta', 'settings']);
    assert.deepEqual(meta, { schemaVersion: 1, installedAt: 5, onboarded: true, lastVersion: '1.2.3' });
    assert.deepEqual(settings, { 'general.theme': 'dark' });
  });

  test('install and startup bring rules, alarms and the guard registration up to date', async () => {
    await w.settings({ 'pause.enabled': true });
    await AP.background.refreshEverything();
    assert.equal((await w.rules()).length, 1);
    assert.deepEqual(fake.scripting.registered, []);
  });
});

describe('commands', () => {
  test('toggle-enabled flips the master switch', async () => {
    await AP.background.onCommand('toggle-enabled');
    assert.equal((await AP.settings.effective())['general.enabled'], false);
    await AP.background.onCommand('toggle-enabled');
    assert.equal((await AP.settings.effective())['general.enabled'], true);
  });

  test('focus-25 starts a 25 minute block on YouTube', async () => {
    await AP.background.onCommand('focus-25');
    const { block } = await send('GET_STATUS');
    assert.deepEqual(block, { until: w.now() + 25 * 60_000, reason: 'focus', siteKeys: ['youtube'] });
  });

  test('open-picker forwards to the active tab; unknown commands are ignored', async () => {
    await AP.background.onCommand('open-picker');
    assert.equal(fake.tabs.sentToTabs.length, 1);
    await AP.background.onCommand('something-else');
    assert.equal(fake.tabs.sentToTabs.length, 1);
  });

  test('the listener is wired to the commands event', async () => {
    fake.commands.onCommand.dispatch('focus-25');
    await new Promise((r) => setTimeout(r, 20));
    assert.ok((await w.state()).block);
  });
});

describe('storage and alarm events', () => {
  test('a settings change re-syncs the rules (debounced) and the alarm event reconciles', async () => {
    await fake.storage.local.set({ settings: { 'pause.enabled': true } });
    await new Promise((r) => setTimeout(r, 120));
    assert.equal((await w.rules()).length, 1);
    await fake.storage.local.set({ settings: { 'pause.enabled': false } });
    await new Promise((r) => setTimeout(r, 120));
    assert.equal((await w.rules()).length, 0);

    await w.settings({ 'pause.enabled': true });
    fake.alarms.onAlarm.dispatch({ name: 'tick' });
    await new Promise((r) => setTimeout(r, 120));
    assert.equal((await w.rules()).length, 1);
  });

  test('stats writes do not trigger a reconcile', async () => {
    await send('HEARTBEAT', { siteKey: 'youtube' });
    const before = fake.declarativeNetRequest.calls.length;
    await fake.storage.local.set({ stats: {} });
    await new Promise((r) => setTimeout(r, 120));
    assert.equal(fake.declarativeNetRequest.calls.length, before);
  });
});
