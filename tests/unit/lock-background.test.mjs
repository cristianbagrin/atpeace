// The background side of the settings lock (Phase 4b): LOCK_UNLOCK / LOCK_RELOCK, GET_STATUS.lock,
// FOCUS_END while locked, STATS_CLEAR, ONBOARDING_DONE and the keyboard shortcut behind the lock.
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
const PAGE = { url: 'moz-extension://fake-uuid/src/pages/options/options.html' };
const WEB = { tab: { id: 3 }, url: 'https://www.youtube.com/watch?v=x' };

describe('LOCK_UNLOCK / LOCK_RELOCK', () => {
  test('with no lock it is simply fine', async () => {
    assert.deepEqual(await send('LOCK_UNLOCK', {}, PAGE), { ok: true, unlockedUntil: 0 });
  });

  test('password mode: the right password opens the lock for ten minutes, a wrong one does not', async () => {
    const lock = await AP.lock.createPasswordLock('correct horse');
    await w.settings({ 'advanced.lock': lock });
    assert.deepEqual(await send('LOCK_UNLOCK', { password: 'nope' }, PAGE), { ok: false, error: 'wrong-password' });
    assert.deepEqual(await send('LOCK_UNLOCK', {}, PAGE), { ok: false, error: 'wrong-password' });
    assert.equal((await w.state()).lockUnlockedUntil, 0);
    assert.deepEqual(await send('LOCK_UNLOCK', { password: 'correct horse' }, PAGE), { ok: true, unlockedUntil: w.now() + 600_000 });
    assert.equal((await w.state()).lockUnlockedUntil, w.now() + 600_000);
    assert.equal((await AP.lock.read(w.now())).locked, false);
    w.advance(600_001);
    assert.equal((await AP.lock.read(w.now())).locked, true, 'ten minutes later it is closed again');
  });

  test('friction mode: only a page that did the waiting (frictionDone) opens it', async () => {
    await w.settings({ 'advanced.lock': { mode: 'friction', waitSeconds: 60 } });
    assert.deepEqual(await send('LOCK_UNLOCK', {}, PAGE), { ok: false, error: 'friction-required' });
    assert.deepEqual(await send('LOCK_UNLOCK', { frictionDone: 'yes' }, PAGE), { ok: false, error: 'friction-required' });
    assert.equal((await send('LOCK_UNLOCK', { frictionDone: true }, PAGE)).ok, true);
  });

  test('LOCK_RELOCK closes it right away', async () => {
    await w.settings({ 'advanced.lock': { mode: 'friction' } });
    await send('LOCK_UNLOCK', { frictionDone: true }, PAGE);
    assert.deepEqual(await send('LOCK_RELOCK', {}, PAGE), { ok: true });
    assert.equal((await w.state()).lockUnlockedUntil, 0);
    assert.equal((await AP.lock.read(w.now())).locked, true);
  });

  test('a content script (a sender with a web page URL) can neither unlock nor relock nor clear nor finish onboarding', async () => {
    await w.settings({ 'advanced.lock': { mode: 'friction' } });
    for (const type of ['LOCK_UNLOCK', 'LOCK_RELOCK', 'STATS_CLEAR', 'ONBOARDING_DONE']) {
      assert.deepEqual(await send(type, { frictionDone: true }, WEB), { ok: false, error: 'not-allowed' }, type);
    }
    assert.equal((await w.state()).lockUnlockedUntil, 0);
  });

  test('the unlock survives the background rewriting state (reconcile keeps lockUnlockedUntil)', async () => {
    await w.settings({ 'advanced.lock': { mode: 'friction' } });
    await send('LOCK_UNLOCK', { frictionDone: true }, PAGE);
    await send('FOCUS_START', { minutes: 5 });
    await AP.bg.sessions.reconcile();
    assert.equal((await w.state()).lockUnlockedUntil, w.now() + 600_000);
  });
});

describe('GET_STATUS.lock', () => {
  test('mode and unlockedUntil follow the lock (0 while locked or without a lock)', async () => {
    assert.deepEqual((await send('GET_STATUS')).lock, { mode: 'none', unlockedUntil: 0 });
    await w.settings({ 'advanced.lock': { mode: 'friction' } });
    assert.deepEqual((await send('GET_STATUS')).lock, { mode: 'friction', unlockedUntil: 0 });
    await send('LOCK_UNLOCK', { frictionDone: true }, PAGE);
    assert.deepEqual((await send('GET_STATUS')).lock, { mode: 'friction', unlockedUntil: w.now() + 600_000 });
  });
});

describe('ending a focus block while the lock holds', () => {
  test('is refused with "locked" and works after the unlock (focus.unlockFriction none)', async () => {
    await w.settings({ 'advanced.lock': { mode: 'friction' }, 'focus.unlockFriction': 'none' });
    await send('FOCUS_START', { minutes: 25 });
    assert.deepEqual(await send('FOCUS_END', {}), { ok: false, error: 'locked' });
    assert.ok((await w.state()).blocks.some((b) => b.reason === 'focus'));
    await send('LOCK_UNLOCK', { frictionDone: true }, PAGE);
    assert.deepEqual(await send('FOCUS_END', {}), { ok: true });
    assert.ok(!(await w.state()).blocks.some((b) => b.reason === 'focus'));
  });

  test('with no lock nothing changes', async () => {
    await w.settings({ 'focus.unlockFriction': 'none' });
    await send('FOCUS_START', { minutes: 25 });
    assert.deepEqual(await send('FOCUS_END', {}), { ok: true });
  });
});

describe('the keyboard shortcut Alt+Shift+P behind the lock', () => {
  test('turning At Peace on is allowed while locked; turning it off is not, until unlocked', async () => {
    w.set(Date.now()); // AP.lock.save() judges the unlock by the real clock; the test clock must agree
    await w.settings({ 'advanced.lock': { mode: 'friction' }, 'general.enabled': false });
    await AP.background.onCommand('toggle-enabled');
    assert.equal((await fake.storage.local.get('settings')).settings['general.enabled'], true);
    await AP.background.onCommand('toggle-enabled');
    assert.equal((await fake.storage.local.get('settings')).settings['general.enabled'], true, 'refused: it would loosen');
    await send('LOCK_UNLOCK', { frictionDone: true }, PAGE);
    await AP.background.onCommand('toggle-enabled');
    assert.equal((await fake.storage.local.get('settings')).settings['general.enabled'], false);
  });
});

describe('STATS_CLEAR', () => {
  const seed = async () => {
    await fake.storage.local.set({ stats: { [AP.util.dayKey(w.now())]: { youtube: { activeSec: 600, opens: 3, turnedBack: 1, continued: 2, blockedHits: 0 } }, '2026-01-02': { youtube: { activeSec: 5, opens: 1, turnedBack: 0, continued: 0, blockedHits: 0 } } } });
  };

  test('forgets every day', async () => {
    await seed();
    assert.deepEqual(await send('STATS_CLEAR', {}, PAGE), { ok: true, days: 2 });
    assert.deepEqual((await fake.storage.local.get('stats')).stats, {});
    assert.deepEqual(await AP.state.getStats(), {});
  });

  test('clearing resets a reached daily limit (the block goes away)', async () => {
    await w.settings({ 'focus.dailyMinutes': 5 });
    await seed();
    await AP.bg.sessions.reconcile();
    assert.ok((await w.state()).blocks.some((b) => b.reason === 'limit'));
    await send('STATS_CLEAR', {}, PAGE);
    assert.ok(!(await w.state()).blocks.some((b) => b.reason === 'limit'));
  });

  test('is refused while the lock holds, because it would lift the limit', async () => {
    await seed();
    await w.settings({ 'advanced.lock': { mode: 'friction' } });
    assert.deepEqual(await send('STATS_CLEAR', {}, PAGE), { ok: false, error: 'locked' });
    assert.ok(Object.keys((await fake.storage.local.get('stats')).stats).length > 0);
    await send('LOCK_UNLOCK', { frictionDone: true }, PAGE);
    assert.equal((await send('STATS_CLEAR', {}, PAGE)).ok, true);
  });
});

describe('ONBOARDING_DONE', () => {
  test('sets meta.onboarded and keeps what meta already says', async () => {
    await AP.background.onInstalled({ reason: 'install' });
    assert.equal((await fake.storage.local.get('meta')).meta.onboarded, false);
    const installedAt = (await fake.storage.local.get('meta')).meta.installedAt;
    assert.deepEqual(await send('ONBOARDING_DONE', {}, PAGE), { ok: true });
    const { meta } = await fake.storage.local.get('meta');
    assert.equal(meta.onboarded, true);
    assert.equal(meta.installedAt, installedAt);
    assert.equal(meta.schemaVersion, AP.settings.SCHEMA_VERSION);
  });

  test('works even when meta was never written', async () => {
    assert.deepEqual(await send('ONBOARDING_DONE', {}, PAGE), { ok: true });
    assert.equal((await fake.storage.local.get('meta')).meta.onboarded, true);
  });
});

describe('the welcome page', () => {
  test('the first install opens it, an update does not', async () => {
    fake.tabs.created.length = 0;
    const real = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true });
    try {
      await AP.background.onInstalled({ reason: 'update' });
      assert.equal(fake.tabs.created.length, 0);
      await AP.background.onInstalled({ reason: 'install' });
      assert.deepEqual(fake.tabs.created.map((t) => t.url), ['moz-extension://fake-uuid/src/pages/welcome/welcome.html']);
    } finally {
      globalThis.fetch = real;
    }
  });
});
