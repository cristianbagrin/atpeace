import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { loadAtPeace, installFakeBrowser, uninstallFakeBrowser, CORE_SCRIPTS } from './_load.mjs';

const BACKGROUND = [...CORE_SCRIPTS, 'src/background/background.js'];

let fake;
let AP;

beforeEach(async () => {
  fake = installFakeBrowser({ version: '9.8.7' });
  AP = await loadAtPeace(BACKGROUND);
  mock.method(console, 'warn', () => {});
});

afterEach(() => {
  mock.restoreAll();
  uninstallFakeBrowser();
});

describe('background message router', () => {
  test('registers its listeners synchronously at load (required for event pages)', () => {
    assert.equal(fake.runtime.onMessage.listeners.length, 1);
    assert.equal(fake.runtime.onInstalled.listeners.length, 1);
    assert.equal(fake.runtime.onStartup.listeners.length, 1);
  });

  test('GET_STATUS answers { ok:true, version } through the real send() path', async () => {
    assert.deepEqual(await AP.msg.send(AP.msg.TYPES.GET_STATUS), { ok: true, version: '9.8.7' });
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

  test('CLOSE_TAB closes sender.tab.id', async () => {
    const res = await AP.background.handleMessage({ type: 'CLOSE_TAB' }, { tab: { id: 42 } });
    assert.deepEqual(res, { ok: true });
    assert.deepEqual(fake.tabs.removed, [42]);
  });

  test('CLOSE_TAB without a tab (e.g. from a popup) is a clean failure', async () => {
    assert.deepEqual(await AP.background.handleMessage({ type: 'CLOSE_TAB' }, {}), { ok: false, error: 'no-tab' });
    assert.deepEqual(fake.tabs.removed, []);
  });

  test('tab id 0 is a valid id', async () => {
    await AP.background.handleMessage({ type: 'CLOSE_TAB' }, { tab: { id: 0 } });
    assert.deepEqual(fake.tabs.removed, [0]);
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
});
