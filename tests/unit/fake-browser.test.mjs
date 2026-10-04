// The fake `browser` is test infrastructure that later phases (settings, state, stats) rely on,
// so its storage semantics get their own tests.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeBrowser, uninstallFakeBrowser } from './_load.mjs';

let fake;
let local;
let events;

beforeEach(() => {
  fake = installFakeBrowser();
  local = fake.storage.local;
  events = [];
  local.onChanged.addListener((changes) => events.push({ via: 'local', changes }));
  fake.storage.onChanged.addListener((changes, area) => events.push({ via: 'root', area, changes }));
});

afterEach(() => uninstallFakeBrowser());

describe('fake storage.local: reads and writes', () => {
  test('starts empty', async () => {
    assert.deepEqual(await local.get(), {});
    assert.deepEqual(await local.get(null), {});
  });

  test('set then get with every key form', async () => {
    await local.set({ a: 1, b: { c: [1, 2] }, d: 'x' });
    assert.deepEqual(await local.get(), { a: 1, b: { c: [1, 2] }, d: 'x' });
    assert.deepEqual(await local.get('a'), { a: 1 });
    assert.deepEqual(await local.get(['a', 'd', 'missing']), { a: 1, d: 'x' });
    assert.deepEqual(await local.get({ a: 99, z: 'default' }), { a: 1, z: 'default' });
  });

  test('set merges, it does not replace the whole area', async () => {
    await local.set({ a: 1 });
    await local.set({ b: 2 });
    assert.deepEqual(await local.get(), { a: 1, b: 2 });
  });

  test('values are copied in and out (no aliasing with stored state)', async () => {
    const input = { list: [1] };
    await local.set({ k: input });
    input.list.push(2);
    const out = await local.get('k');
    assert.deepEqual(out.k, { list: [1] });
    out.k.list.push(3);
    assert.deepEqual((await local.get('k')).k, { list: [1] });
  });

  test('remove accepts a key or an array and ignores unknown keys', async () => {
    await local.set({ a: 1, b: 2, c: 3 });
    await local.remove('a');
    await local.remove(['b', 'nope']);
    assert.deepEqual(await local.get(), { c: 3 });
  });

  test('clear empties the area', async () => {
    await local.set({ a: 1, b: 2 });
    await local.clear();
    assert.deepEqual(await local.get(), {});
  });

  test('session is a separate area', async () => {
    await local.set({ a: 1 });
    await fake.storage.session.set({ a: 2 });
    assert.deepEqual(await local.get('a'), { a: 1 });
    assert.deepEqual(await fake.storage.session.get('a'), { a: 2 });
  });
});

describe('fake storage.local: onChanged', () => {
  test('new key: only newValue', async () => {
    await local.set({ a: 1 });
    assert.deepEqual(events[0], { via: 'local', changes: { a: { newValue: 1 } } });
    assert.deepEqual(events[1], { via: 'root', area: 'local', changes: { a: { newValue: 1 } } });
    assert.equal(events.length, 2);
  });

  test('changed key: oldValue and newValue', async () => {
    await local.set({ a: { n: 1 } });
    events.length = 0;
    await local.set({ a: { n: 2 } });
    assert.deepEqual(events[0].changes, { a: { oldValue: { n: 1 }, newValue: { n: 2 } } });
  });

  test('one event per call, covering all changed keys', async () => {
    await local.set({ a: 1, b: 2 });
    assert.equal(events.filter((e) => e.via === 'local').length, 1);
    assert.deepEqual(Object.keys(events[0].changes).sort(), ['a', 'b']);
  });

  test('unchanged values do not fire (deep comparison), and changed siblings still do', async () => {
    await local.set({ a: { x: [1] }, b: 1 });
    events.length = 0;
    await local.set({ a: { x: [1] } });
    assert.equal(events.length, 0);
    await local.set({ a: { x: [1] }, b: 2 });
    assert.deepEqual(Object.keys(events[0].changes), ['b']);
  });

  test('remove: only oldValue; unknown keys do not fire', async () => {
    await local.set({ a: 1 });
    events.length = 0;
    await local.remove(['a', 'nope']);
    assert.deepEqual(events[0].changes, { a: { oldValue: 1 } });
    events.length = 0;
    await local.remove('a');
    assert.equal(events.length, 0);
  });

  test('clear reports every removed key', async () => {
    await local.set({ a: 1, b: 2 });
    events.length = 0;
    await local.clear();
    assert.deepEqual(events[0].changes, { a: { oldValue: 1 }, b: { oldValue: 2 } });
    events.length = 0;
    await local.clear(); // already empty
    assert.equal(events.length, 0);
  });

  test('listeners see the write already applied', async () => {
    let seen;
    fake.storage.local.onChanged.addListener(async () => {
      seen = await local.get('a');
    });
    await local.set({ a: 5 });
    assert.deepEqual(seen, { a: 5 });
  });

  test('event payloads are copies', async () => {
    await local.set({ a: { n: 1 } });
    events[0].changes.a.newValue.n = 99;
    assert.deepEqual((await local.get('a')).a, { n: 1 });
  });

  test('session writes report area "session" on the root event only', async () => {
    await fake.storage.session.set({ s: 1 });
    assert.deepEqual(events, [{ via: 'root', area: 'session', changes: { s: { newValue: 1 } } }]);
  });

  test('removeListener stops delivery', async () => {
    const calls = [];
    const fn = (c) => calls.push(c);
    local.onChanged.addListener(fn);
    assert.equal(local.onChanged.hasListener(fn), true);
    local.onChanged.removeListener(fn);
    assert.equal(local.onChanged.hasListener(fn), false);
    await local.set({ a: 1 });
    assert.equal(calls.length, 0);
  });
});

describe('fake runtime', () => {
  test('sendMessage rejects like a browser when nobody listens', async () => {
    await assert.rejects(fake.runtime.sendMessage({ type: 'X' }), /Receiving end does not exist/);
  });

  test('sendMessage supports sendResponse + return true, and Promise-returning listeners', async () => {
    const off = (fn) => fake.runtime.onMessage.removeListener(fn);
    const a = (_m, _s, respond) => {
      setTimeout(() => respond('from-callback'), 1);
      return true;
    };
    fake.runtime.onMessage.addListener(a);
    assert.equal(await fake.runtime.sendMessage({}), 'from-callback');
    off(a);
    const b = async () => 'from-promise';
    fake.runtime.onMessage.addListener(b);
    assert.equal(await fake.runtime.sendMessage({}), 'from-promise');
  });

  test('getURL builds an extension URL', () => {
    assert.equal(fake.runtime.getURL('/src/pages/pause/pause.html'), 'moz-extension://fake-uuid/src/pages/pause/pause.html');
  });
});
