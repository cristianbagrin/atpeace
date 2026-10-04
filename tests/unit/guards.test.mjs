// Registration of the guard content script for user-added sites (src/background/guards.js).
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { uninstallFakeBrowser, ROOT } from './_load.mjs';
import { bgWorld } from './_bg.mjs';

let w;
let AP;
let fake;

const REDDIT = { siteKey: 'reddit.com', domain: 'reddit.com', enabled: true };
const YT = { siteKey: 'youtube', domain: 'youtube.com', enabled: true };

beforeEach(async () => {
  w = await bgWorld();
  ({ AP, fake } = w);
});
afterEach(() => uninstallFakeBrowser());

describe('guard registration', () => {
  test('every file the guard loads exists', () => {
    for (const f of AP.bg.guards.GUARD_FILES) assert.ok(existsSync(join(ROOT, f)), f);
  });

  test('nothing is registered while no user site has access', async () => {
    await w.settings({ 'pause.sites': [YT, REDDIT] });
    assert.deepEqual(await AP.bg.guards.sync(), { registered: [] });
    assert.deepEqual(fake.scripting.registered, []);
  });

  test('a granted site is registered at document_start with its subdomain pattern', async () => {
    await w.settings({ 'pause.sites': [YT, REDDIT] });
    fake.permissions.granted.add('*://*.reddit.com/*');
    assert.deepEqual(await AP.bg.guards.sync(), { registered: ['*://*.reddit.com/*'] });
    const [script] = fake.scripting.registered;
    assert.equal(script.id, 'at-peace-guard');
    assert.deepEqual(script.matches, ['*://*.reddit.com/*']);
    assert.equal(script.runAt, 'document_start');
    assert.equal(script.persistAcrossSessions, true);
    assert.equal(script.allFrames, false);
    assert.deepEqual(script.js, AP.bg.guards.GUARD_FILES);
    assert.equal(script.js[0], 'src/shared/namespace.js', 'the namespace loads first');
  });

  test('YouTube is never in the guard (the manifest already covers it)', async () => {
    fake.permissions.granted.add('*://*.youtube.com/*');
    assert.deepEqual(await AP.bg.guards.sync(), { registered: [] });
  });

  test('adding, changing and removing sites keeps one registration in sync', async () => {
    const OTHER = { siteKey: 'news.example.org', domain: 'news.example.org', enabled: false };
    fake.permissions.granted.add('*://*.reddit.com/*');
    fake.permissions.granted.add('*://*.news.example.org/*');
    await w.settings({ 'pause.sites': [YT, REDDIT] });
    await AP.bg.guards.sync();
    await w.settings({ 'pause.sites': [YT, REDDIT, OTHER] });
    await AP.bg.guards.sync();
    assert.equal(fake.scripting.registered.length, 1);
    assert.deepEqual(fake.scripting.registered[0].matches.sort(), ['*://*.news.example.org/*', '*://*.reddit.com/*'], 'a disabled pause site still gets the guard: a block may target it');
    fake.permissions.granted.delete('*://*.reddit.com/*'); // revoked in about:addons
    await AP.bg.guards.sync();
    assert.deepEqual(fake.scripting.registered[0].matches, ['*://*.news.example.org/*']);
    await w.settings({ 'pause.sites': [YT] });
    await AP.bg.guards.sync();
    assert.deepEqual(fake.scripting.registered, []);
  });

  test('syncing twice does not touch an up-to-date registration', async () => {
    fake.permissions.granted.add('*://*.reddit.com/*');
    await w.settings({ 'pause.sites': [YT, REDDIT] });
    await AP.bg.guards.sync();
    let updates = 0;
    const original = fake.scripting.updateContentScripts;
    fake.scripting.updateContentScripts = (...a) => {
      updates++;
      return original(...a);
    };
    await AP.bg.guards.sync();
    assert.equal(updates, 0);
  });

  test('permission and settings events trigger a sync', async () => {
    fake.permissions.granted.add('*://*.reddit.com/*');
    await w.settings({ 'pause.sites': [YT, REDDIT] });
    await new Promise((r) => setTimeout(r, 120)); // the storage listener syncs
    assert.equal(fake.scripting.registered.length, 1);
    fake.permissions.granted.delete('*://*.reddit.com/*');
    fake.permissions.onRemoved.dispatch({ origins: ['*://*.reddit.com/*'] });
    await new Promise((r) => setTimeout(r, 40));
    assert.equal(fake.scripting.registered.length, 0);
  });

  test('a browser without the scripting or permissions API is left alone', async () => {
    delete fake.scripting.registerContentScripts;
    assert.deepEqual(await AP.bg.guards.sync(), { registered: [] });
  });
});
