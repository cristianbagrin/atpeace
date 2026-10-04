import { test, describe, before, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { loadAtPeace, CORE_SCRIPTS } from './_load.mjs';

let util;
before(async () => {
  const AP = await loadAtPeace(CORE_SCRIPTS.slice(0, 3)); // namespace, browser-api (no-op without a browser), util
  util = AP.util;
});

afterEach(() => {
  mock.timers.reset();
  delete globalThis.requestAnimationFrame;
  delete globalThis.cancelAnimationFrame;
});

describe('debounce', () => {
  test('fires once, after the quiet period, with the last arguments', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const calls = [];
    const fn = util.debounce((x) => calls.push(x), 100);
    fn(1);
    mock.timers.tick(60);
    fn(2);
    mock.timers.tick(60);
    assert.deepEqual(calls, []);
    mock.timers.tick(40);
    assert.deepEqual(calls, [2]);
  });

  test('cancel drops the pending call', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const calls = [];
    const fn = util.debounce(() => calls.push('x'), 50);
    fn();
    fn.cancel();
    mock.timers.tick(100);
    assert.deepEqual(calls, []);
  });

  test('flush runs the pending call immediately, exactly once', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const calls = [];
    const fn = util.debounce((x) => calls.push(x), 50);
    fn('a');
    fn.flush();
    assert.deepEqual(calls, ['a']);
    mock.timers.tick(100);
    assert.deepEqual(calls, ['a']);
    fn.flush(); // nothing pending: no-op
    assert.deepEqual(calls, ['a']);
  });
});

describe('throttle', () => {
  test('leading call runs now; later calls collapse into one trailing call with the latest args', () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const calls = [];
    const fn = util.throttle((x) => calls.push(x), 100);
    fn(1); // leading
    fn(2);
    fn(3);
    assert.deepEqual(calls, [1]);
    mock.timers.tick(100);
    assert.deepEqual(calls, [1, 3]);
    mock.timers.tick(500);
    assert.deepEqual(calls, [1, 3]);
  });

  test('a call after the window has passed runs immediately again', () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const calls = [];
    const fn = util.throttle((x) => calls.push(x), 100);
    fn('a');
    mock.timers.tick(250);
    fn('b');
    assert.deepEqual(calls, ['a', 'b']);
  });

  test('cancel drops the trailing call', () => {
    mock.timers.enable({ apis: ['setTimeout', 'Date'] });
    const calls = [];
    const fn = util.throttle((x) => calls.push(x), 100);
    fn(1);
    fn(2);
    fn.cancel();
    mock.timers.tick(200);
    assert.deepEqual(calls, [1]);
  });
});

describe('rafThrottle', () => {
  test('uses requestAnimationFrame when present: one call per frame, latest args', () => {
    const frames = [];
    globalThis.requestAnimationFrame = (cb) => frames.push(cb);
    globalThis.cancelAnimationFrame = () => {};
    const calls = [];
    const fn = util.rafThrottle((x) => calls.push(x));
    fn(1);
    fn(2);
    fn(3);
    assert.equal(frames.length, 1);
    frames.shift()();
    assert.deepEqual(calls, [3]);
    fn(4);
    assert.equal(frames.length, 1);
  });

  test('falls back to a ~16 ms timeout without requestAnimationFrame', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const calls = [];
    const fn = util.rafThrottle((x) => calls.push(x));
    fn('a');
    fn('b');
    mock.timers.tick(15);
    assert.deepEqual(calls, []);
    mock.timers.tick(1);
    assert.deepEqual(calls, ['b']);
  });

  test('cancel drops the scheduled frame', () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    const calls = [];
    const fn = util.rafThrottle(() => calls.push('x'));
    fn();
    fn.cancel();
    mock.timers.tick(50);
    assert.deepEqual(calls, []);
  });
});

describe('dayKey', () => {
  test('formats the local date as YYYY-MM-DD with zero padding', () => {
    assert.equal(util.dayKey(new Date(2026, 0, 5, 12, 0, 0)), '2026-01-05');
    assert.equal(util.dayKey(new Date(2026, 11, 31, 8, 0, 0)), '2026-12-31');
  });

  test('uses the local day, not UTC, around midnight (any TZ)', () => {
    assert.equal(util.dayKey(new Date(2026, 5, 1, 0, 30, 0)), '2026-06-01'); // just after local midnight
    assert.equal(util.dayKey(new Date(2026, 4, 31, 23, 59, 59)), '2026-05-31'); // just before
  });

  test('defaults to now and accepts a timestamp', () => {
    const now = new Date();
    const expected = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    assert.equal(util.dayKey(), expected);
    assert.equal(util.dayKey(new Date(2026, 2, 9, 10).getTime()), '2026-03-09');
  });

  test('handles leap day', () => {
    assert.equal(util.dayKey(new Date(2028, 1, 29, 12)), '2028-02-29');
  });
});

describe('clamp', () => {
  test('limits to the range', () => {
    assert.equal(util.clamp(5, 0, 10), 5);
    assert.equal(util.clamp(-3, 0, 10), 0);
    assert.equal(util.clamp(99, 0, 10), 10);
    assert.equal(util.clamp(0, 0, 10), 0);
    assert.equal(util.clamp(10, 0, 10), 10);
  });
  test('handles infinities and NaN', () => {
    assert.equal(util.clamp(Infinity, 0, 10), 10);
    assert.equal(util.clamp(-Infinity, 0, 10), 0);
    assert.equal(util.clamp(NaN, 3, 10), 3);
  });
});

describe('uid', () => {
  test('is 12 hex chars', () => {
    assert.match(util.uid(), /^[0-9a-f]{12}$/);
  });
  test('prefixes with an underscore separator', () => {
    assert.match(util.uid('rule'), /^rule_[0-9a-f]{12}$/);
  });
  test('does not repeat', () => {
    const seen = new Set(Array.from({ length: 2000 }, () => util.uid()));
    assert.equal(seen.size, 2000);
  });
});

describe('sleep', () => {
  test('resolves after the delay', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });
    let done = false;
    const p = util.sleep(1000).then(() => {
      done = true;
    });
    mock.timers.tick(999);
    await Promise.resolve();
    assert.equal(done, false);
    mock.timers.tick(1);
    await p;
    assert.equal(done, true);
  });
});

describe('isPlainObject', () => {
  test('accepts object literals, null-prototype objects and JSON results', () => {
    assert.equal(util.isPlainObject({}), true);
    assert.equal(util.isPlainObject({ a: 1 }), true);
    assert.equal(util.isPlainObject(Object.create(null)), true);
    assert.equal(util.isPlainObject(JSON.parse('{"a":{"b":1}}')), true);
  });
  test('rejects everything else', () => {
    for (const v of [null, undefined, 0, 'x', true, [], () => {}, new Date(), new Map(), /x/, new (class Foo {})()]) {
      assert.equal(util.isPlainObject(v), false, String(v));
    }
  });
  test('accepts plain objects from another realm', () => {
    const foreign = vm.runInNewContext('({ a: 1 })');
    assert.notEqual(Object.getPrototypeOf(foreign), Object.prototype);
    assert.equal(util.isPlainObject(foreign), true);
    assert.equal(util.isPlainObject(vm.runInNewContext('[1]')), false);
  });
});

describe('deepEqual', () => {
  test('primitives', () => {
    assert.equal(util.deepEqual(1, 1), true);
    assert.equal(util.deepEqual('a', 'a'), true);
    assert.equal(util.deepEqual(1, '1'), false);
    assert.equal(util.deepEqual(null, undefined), false);
    assert.equal(util.deepEqual(NaN, NaN), true);
    assert.equal(util.deepEqual(null, null), true);
  });
  test('arrays', () => {
    assert.equal(util.deepEqual([1, 2, 3], [1, 2, 3]), true);
    assert.equal(util.deepEqual([1, 2, 3], [1, 2]), false);
    assert.equal(util.deepEqual([1, 2], [2, 1]), false);
    assert.equal(util.deepEqual([], {}), false);
    assert.equal(util.deepEqual([[1], [2]], [[1], [2]]), true);
  });
  test('plain objects, ignoring key order', () => {
    assert.equal(util.deepEqual({ a: 1, b: { c: [1, { d: 2 }] } }, { b: { c: [1, { d: 2 }] }, a: 1 }), true);
    assert.equal(util.deepEqual({ a: 1 }, { a: 2 }), false);
    assert.equal(util.deepEqual({ a: 1 }, { a: 1, b: 2 }), false);
  });
  test('an undefined value is not the same as a missing key', () => {
    assert.equal(util.deepEqual({ a: undefined }, {}), false);
    assert.equal(util.deepEqual({ a: undefined }, { b: undefined }), false);
  });
  test('non-plain objects compare by identity', () => {
    const d = new Date(0);
    assert.equal(util.deepEqual(d, d), true);
    assert.equal(util.deepEqual(new Date(0), new Date(0)), false);
  });
  test('does not confuse prototype members with own keys', () => {
    assert.equal(util.deepEqual({ a: 1 }, { toString: 1 }), false);
  });
});
