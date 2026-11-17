import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { loadAtPeace, installFakeBrowser, uninstallFakeBrowser, CORE_SCRIPTS } from './_load.mjs';

let fake;
let AP;

beforeEach(async () => {
  fake = installFakeBrowser();
  AP = await loadAtPeace(CORE_SCRIPTS);
  mock.method(console, 'warn', () => {}); // AP.warn → console.warn; keep test output clean
});

afterEach(() => {
  mock.restoreAll();
  uninstallFakeBrowser();
});

describe('AP.msg.TYPES', () => {
  test('declares every message from PLAN §8.1 (+ Phase 3c and 4b additions), each equal to its own name', () => {
    const expected = [
      'PAUSE_CONTINUE',
      'PAUSE_TURN_BACK',
      'PAUSE_OPENED',
      'FOCUS_START',
      'FOCUS_END',
      'HEARTBEAT',
      'CLOSE_TAB',
      'GET_STATUS',
      'OPEN_OPTIONS',
      'START_PICKER',
      'LIMIT_GRACE',
      'BLOCKED_OPENED',
      'LOCK_UNLOCK',
      'LOCK_RELOCK',
      'STATS_CLEAR',
      'ONBOARDING_DONE',
      'ACCOUNT_STATUS',
      'ACCOUNT_SIGN_IN',
      'ACCOUNT_SIGN_OUT',
      'ACCOUNT_FORGOT',
      'ACCOUNT_SYNC',
    ];
    assert.deepEqual(Object.keys(AP.msg.TYPES).sort(), [...expected].sort());
    for (const name of expected) assert.equal(AP.msg.TYPES[name], name);
  });

  test('is frozen', () => {
    assert.equal(Object.isFrozen(AP.msg.TYPES), true);
    assert.throws(() => {
      AP.msg.TYPES.NEW_ONE = 'x';
    }, TypeError);
  });
});

describe('AP.api', () => {
  test('is the browser object when `browser` exists', () => {
    assert.equal(AP.api, fake);
  });
});

describe('AP.msg.send', () => {
  test('sends { type, payload } and returns the response', async () => {
    const seen = [];
    fake.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      seen.push(message);
      sendResponse({ ok: true, echo: message.payload });
      return true;
    });
    const res = await AP.msg.send(AP.msg.TYPES.HEARTBEAT, { siteKey: 'youtube' });
    assert.deepEqual(res, { ok: true, echo: { siteKey: 'youtube' } });
    assert.deepEqual(seen, [{ type: 'HEARTBEAT', payload: { siteKey: 'youtube' } }]);
  });

  test('payload is optional', async () => {
    fake.runtime.onMessage.addListener((message, _s, sendResponse) => {
      sendResponse({ ok: true, hasPayload: message.payload !== undefined });
      return true;
    });
    assert.deepEqual(await AP.msg.send('GET_STATUS'), { ok: true, hasPayload: false });
  });

  test('"receiving end does not exist" is swallowed: warns and returns { ok:false, error:"no-receiver" }', async () => {
    // fake with no onMessage listeners rejects exactly like the browsers do
    const res = await AP.msg.send(AP.msg.TYPES.GET_STATUS);
    assert.deepEqual(res, { ok: false, error: 'no-receiver' });
    assert.equal(console.warn.mock.callCount(), 1);
    const [prefix, text] = console.warn.mock.calls[0].arguments;
    assert.equal(prefix, '[At Peace]');
    assert.match(text, /GET_STATUS/);
  });

  test('also matches the error text case-insensitively and inside longer messages', async () => {
    fake.runtime.sendMessage = () => Promise.reject(new Error('Error: could not establish connection. RECEIVING END DOES NOT EXIST.'));
    assert.deepEqual(await AP.msg.send('X'), { ok: false, error: 'no-receiver' });
  });

  test('"Extension context invalidated" is swallowed too', async () => {
    fake.runtime.sendMessage = () => Promise.reject(new Error('Extension context invalidated.'));
    assert.deepEqual(await AP.msg.send('X'), { ok: false, error: 'context-invalidated' });
    assert.equal(console.warn.mock.callCount(), 1);
  });

  test('any other error is rethrown', async () => {
    fake.runtime.sendMessage = () => Promise.reject(new Error('boom'));
    await assert.rejects(AP.msg.send('X'), /boom/);
    assert.equal(console.warn.mock.callCount(), 0);
  });

  test('a synchronous throw from the browser API is handled the same way', async () => {
    fake.runtime.sendMessage = () => {
      throw new Error('Could not establish connection. Receiving end does not exist.');
    };
    assert.deepEqual(await AP.msg.send('X'), { ok: false, error: 'no-receiver' });
  });
});
