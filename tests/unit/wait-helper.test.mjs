// tests/helpers/wait.mjs: the polling helper that replaces page.waitForFunction(async …) in the browser specs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { until, pageUntil } from '../helpers/wait.mjs';

test('until awaits an async check, polls until it is truthy and returns the value', async () => {
  let calls = 0;
  const value = await until(async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return calls >= 3 ? { done: true } : false;
  }, { interval: 5 });
  assert.deepEqual(value, { done: true });
  assert.equal(calls, 3);
});

test('a promise is not "truthy": a check resolving to false keeps waiting (the waitForFunction trap)', async () => {
  const started = Date.now();
  await assert.rejects(until(async () => false, { timeout: 80, interval: 10 }), /timed out after 80 ms/);
  assert.ok(Date.now() - started >= 70, 'it really waited');
});

test('the timeout message names what was awaited; a number or string shorthand works', async () => {
  await assert.rejects(until(() => false, { timeout: 20, what: 'the kettle' }), /waiting for the kettle/);
  await assert.rejects(until(() => false, 20), /timed out after 20 ms/);
  await assert.rejects(until(() => false, 'the lid', 20), /waiting for the lid/);
});

test('an error thrown by the check is not swallowed, unless retryErrors says "not yet"', async () => {
  await assert.rejects(until(() => Promise.reject(new Error('page closed')), 100), /page closed/);
  let calls = 0;
  const value = await until(() => {
    calls += 1;
    if (calls < 3) throw new Error('stale element');
    return 'found';
  }, { retryErrors: true, interval: 5 });
  assert.equal(value, 'found');
  await assert.rejects(until(() => { throw new Error('stale element'); }, { retryErrors: true, timeout: 30, interval: 5 }), /waiting for .*: stale element/);
});

test('the (check, what, timeout) form of the older local helpers works', async () => {
  await assert.rejects(until(() => false, 'the lid', 25), /timed out after 25 ms waiting for the lid/);
});

test('pageUntil runs the function through page.evaluate, which awaits promises', async () => {
  let n = 0;
  const page = { evaluate: async (fn, arg) => fn(arg) };
  const result = await pageUntil(page, async (limit) => ++n >= limit, 3, { interval: 5 });
  assert.equal(result, true);
  assert.equal(n, 3);
});
