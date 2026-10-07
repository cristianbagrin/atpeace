// The breath shared by the pause page and the in-page overlay (src/shared/breath.js).
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadAtPeace, installFakeBrowser, uninstallFakeBrowser, CORE_SCRIPTS } from './_load.mjs';

let AP;

beforeEach(async () => {
  installFakeBrowser();
  AP = await loadAtPeace([...CORE_SCRIPTS, 'src/shared/breath.js']);
});
afterEach(() => uninstallFakeBrowser());

describe('plan', () => {
  test('in/out pairs of about 8 s, stretched evenly over the breath', () => {
    assert.deepEqual(AP.breath.plan(6), { cycles: 1, half: 3000 });
    assert.deepEqual(AP.breath.plan(3), { cycles: 1, half: 1500 });
    assert.deepEqual(AP.breath.plan(8), { cycles: 1, half: 4000 });
    assert.deepEqual(AP.breath.plan(12), { cycles: 2, half: 3000 }); // round(1.5) = 2
    assert.deepEqual(AP.breath.plan(30), { cycles: 4, half: 3750 });
  });

  test('never zero cycles, and the halves always add up to the whole breath', () => {
    for (const seconds of [1, 3, 5, 6, 9, 12, 17, 24, 30]) {
      const { cycles, half } = AP.breath.plan(seconds);
      assert.ok(cycles >= 1);
      assert.ok(Math.abs(half * cycles * 2 - seconds * 1000) < 1e-6, String(seconds));
    }
  });
});

describe('guidance', () => {
  test('in on even half-breaths, out on odd ones', () => {
    assert.deepEqual([0, 1, 2, 3].map(AP.breath.guidance), ['Breathe in…', '…and out', 'Breathe in…', '…and out']);
  });
});

describe('frames', () => {
  test('the disc grows to 1 on every in-breath and returns to 0.6, with a lung-like ease', () => {
    const f = AP.breath.frames(2, false);
    assert.deepEqual(f.map((k) => k.transform), ['scale(0.6)', 'scale(1)', 'scale(0.6)', 'scale(1)', 'scale(0.6)']);
    assert.deepEqual(f.map((k) => k.offset), [0, 0.25, 0.5, 0.75, 1]);
    assert.ok(f.every((k) => k.easing === 'cubic-bezier(0.45, 0, 0.55, 1)' && k.opacity === undefined));
  });

  test('reduced motion: the size never changes, the disc only fades', () => {
    const f = AP.breath.frames(1, true);
    assert.deepEqual(f.map((k) => k.transform), ['scale(0.8)', 'scale(0.8)', 'scale(0.8)']);
    assert.deepEqual(f.map((k) => k.opacity), [0.55, 1, 0.55]);
  });
});

describe('ordinal', () => {
  test('first, 2nd, 3rd, 4th … and the teens', () => {
    assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(AP.breath.ordinal), ['first', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th']);
  });
});

describe('ticksPath', () => {
  test('sixty ticks, the same drawing as the pages\' dial', async () => {
    const path = AP.breath.ticksPath();
    assert.equal(path.split('M').length - 1, 60);
    await import(new URL(`../../src/pages/common/logic.js?t=${Math.random()}`, import.meta.url).href);
    assert.equal(path, AP.ui.dialTicksPath());
  });
});
