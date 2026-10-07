// Settings storage: effective(), save(), reset(), applyPreset(), custom presets, subscribe(),
// migrate(), export/import (src/shared/settings.js), against the in-memory fake `browser`.
import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { uninstallFakeBrowser } from './_load.mjs';
import { freshWorld } from './_fixtures.mjs';

let AP;
let fake;
let writes; // storage.local.set calls, by key list

beforeEach(async () => {
  ({ AP, fake } = await freshWorld());
  writes = [];
  const set = fake.storage.local.set.bind(fake.storage.local);
  fake.storage.local.set = (items) => {
    writes.push(Object.keys(items));
    return set(items);
  };
  mock.method(console, 'warn', () => {});
});

afterEach(() => {
  mock.restoreAll();
  uninstallFakeBrowser();
});

const store = (items) => fake.storage.local.set(items);
const stored = async (key) => (await fake.storage.local.get(key))[key];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(predicate, ms = 1000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (predicate()) return;
    await sleep(5);
  }
  assert.fail('timed out waiting for condition');
}

describe('load() and effective()', () => {
  test('load() is {} for nothing, garbage or arrays', async () => {
    assert.deepEqual(await AP.settings.load(), {});
    await store({ settings: [1, 2] });
    assert.deepEqual(await AP.settings.load(), {});
    await store({ settings: 'x' });
    assert.deepEqual(await AP.settings.load(), {});
  });

  test('load() returns what is stored, unvalidated', async () => {
    await store({ settings: { 'yt.general.hideAds': 'yes', ghost: 1 } });
    assert.deepEqual(await AP.settings.load(), { 'yt.general.hideAds': 'yes', ghost: 1 });
  });

  test('effective() is a full map of defaults when nothing is stored', async () => {
    const eff = await AP.settings.effective();
    assert.deepEqual(eff, AP.schema.defaults());
    assert.equal(eff['general.enabled'], true);
    assert.equal(eff['yt.general.hideAds'], false);
  });

  test('effective() = defaults ⊕ stored, validated: junk falls back, unknown ids vanish, numbers clamp', async () => {
    await store({
      settings: {
        'yt.general.hideAds': true,
        'yt.general.thumbnails': 'sideways',
        'pause.breathSeconds': 999,
        'pause.sessionMinutes': 30,
        'general.theme': 'dark',
        'yt.comments.hideAll': 'yes',
        'totally.unknown': 1,
      },
    });
    const eff = await AP.settings.effective();
    assert.equal(eff['yt.general.hideAds'], true);
    assert.equal(eff['yt.general.thumbnails'], 'show');
    assert.equal(eff['pause.breathSeconds'], 30);
    assert.equal(eff['pause.sessionMinutes'], '30');
    assert.equal(eff['general.theme'], 'dark');
    assert.equal(eff['yt.comments.hideAll'], false);
    assert.equal('totally.unknown' in eff, false);
    assert.deepEqual(Object.keys(eff).sort(), Object.keys(AP.schema.defaults()).sort());
  });

  test('a schedule override overlays preset values on top of stored settings', async () => {
    await store({ settings: { 'yt.general.hideAds': false, 'yt.guide.hideFooter': true, 'general.theme': 'dark' } });
    await store({ state: { scheduleOverride: 'focused' } });
    const eff = await AP.settings.effective();
    assert.equal(eff['yt.watch.hideRelated'], true, 'from the preset');
    assert.equal(eff['yt.general.hideAds'], true, 'preset beats stored');
    assert.equal(eff['yt.guide.hideFooter'], true, 'preset value too');
    assert.equal(eff['general.theme'], 'dark', 'out-of-scope settings keep the stored value');
    await store({ state: { scheduleOverride: null } });
    assert.equal((await AP.settings.effective())['yt.watch.hideRelated'], false);
  });

  test('the override can be a custom preset; an unknown preset id changes nothing', async () => {
    await store({ customPresets: [{ id: 'mine', name: 'Mine', values: { 'yt.comments.hideTeaser': true } }] });
    await store({ state: { scheduleOverride: 'mine' } });
    assert.equal((await AP.settings.effective())['yt.comments.hideTeaser'], true);
    await store({ state: { scheduleOverride: 'ghost' } });
    assert.equal((await AP.settings.effective())['yt.comments.hideTeaser'], false);
  });

  test('AP.debug follows advanced.debug', async () => {
    assert.equal(AP.debug, false);
    await store({ settings: { 'advanced.debug': true } });
    await AP.settings.effective();
    assert.equal(AP.debug, true);
    await store({ settings: { 'advanced.debug': false } });
    await AP.settings.effective();
    assert.equal(AP.debug, false);
  });

  test('merge() is pure and layers defaults, stored and override in that order', () => {
    const eff = AP.settings.merge({ 'yt.general.hideAds': true, 'yt.guide.hideFooter': true }, { 'yt.guide.hideFooter': false, 'yt.comments.hideTeaser': true });
    assert.equal(eff['yt.general.hideAds'], true);
    assert.equal(eff['yt.guide.hideFooter'], false);
    assert.equal(eff['yt.comments.hideTeaser'], true);
    assert.deepEqual(AP.settings.merge(null), AP.schema.defaults());
    assert.deepEqual(AP.settings.merge({ 'yt.general.hideAds': undefined }), AP.schema.defaults());
  });
});

describe('storage read retries', () => {
  /** Makes the next `failures` reads reject with `message`, then behave normally. */
  function failReads(failures, message = 'An unexpected error occurred') {
    const real = fake.storage.local.get.bind(fake.storage.local);
    let calls = 0;
    fake.storage.local.get = (...args) => {
      calls++;
      return calls <= failures ? Promise.reject(new Error(message)) : real(...args);
    };
    return () => calls;
  }

  test('a transient read failure (Firefox: "An unexpected error occurred") is retried', async () => {
    await store({ settings: { 'yt.general.hideAds': true } });
    const calls = failReads(2);
    const eff = await AP.settings.effective();
    assert.equal(eff['yt.general.hideAds'], true);
    assert.equal(calls(), 3);
    assert.deepEqual(await AP.settings.load(), { 'yt.general.hideAds': true });
  });

  test('state and stats reads share the retry', async () => {
    await store({ state: { scheduleOverride: 'focused' } });
    failReads(1);
    assert.equal((await AP.state.getState()).scheduleOverride, 'focused');
  });

  test('gives up after three retries and surfaces the error', async () => {
    const calls = failReads(99);
    await assert.rejects(AP.settings.effective(), /unexpected error/);
    assert.equal(calls(), 4);
  });

  test('a dead extension context is not retried', async () => {
    const calls = failReads(99, 'Extension context invalidated.');
    await assert.rejects(AP.settings.effective(), /context invalidated/);
    assert.equal(calls(), 1);
  });

  test('a subscriber still hears about a change whose first read failed', async () => {
    const calls = [];
    const stop = AP.settings.subscribe((eff, changed) => calls.push(changed));
    await sleep(10);
    await AP.settings.save({ 'yt.general.hideAds': true });
    failReads(1);
    await waitFor(() => calls.length === 1, 3000);
    assert.deepEqual(calls[0], ['yt.general.hideAds']);
    stop();
  });
});

describe('save()', () => {
  test('validates, reports unknown and invalid ids, clamps numbers, writes `settings` only', async () => {
    const report = await AP.settings.save({
      'yt.general.hideAds': true,
      'pause.breathSeconds': 100,
      'yt.comments.hideAll': 'yes',
      'yt.general.thumbnails': 'sideways',
      'no.such.id': 1,
      constructor: 5,
    });
    assert.deepEqual(report, {
      changed: ['yt.general.hideAds', 'pause.breathSeconds'],
      unknown: ['no.such.id', 'constructor'],
      invalid: ['yt.comments.hideAll', 'yt.general.thumbnails'],
    });
    assert.deepEqual(await stored('settings'), { 'yt.general.hideAds': true, 'pause.breathSeconds': 30 });
    assert.deepEqual(writes, [['settings']]);
  });

  test('is a read-modify-write that keeps other stored keys, including ones this version does not know', async () => {
    await store({ settings: { 'yt.guide.hideFooter': true, 'future.setting': 42 } });
    await AP.settings.save({ 'yt.general.hideAds': true });
    assert.deepEqual(await stored('settings'), { 'yt.guide.hideFooter': true, 'future.setting': 42, 'yt.general.hideAds': true });
  });

  test('does not write when nothing changed (no storage event, no churn)', async () => {
    await store({ settings: { 'yt.general.hideAds': true } });
    writes.length = 0;
    const same = await AP.settings.save({ 'yt.general.hideAds': true });
    assert.deepEqual(same.changed, []);
    const defaultValue = await AP.settings.save({ 'yt.guide.hideFooter': false }); // equals the default, never stored before
    assert.deepEqual(defaultValue.changed, []);
    assert.deepEqual(writes, []);
  });

  test('turning a stored setting back to its default stores that value explicitly', async () => {
    await AP.settings.save({ 'yt.general.hideAds': true });
    const report = await AP.settings.save({ 'yt.general.hideAds': false });
    assert.deepEqual(report.changed, ['yt.general.hideAds']);
    assert.equal((await stored('settings'))['yt.general.hideAds'], false);
  });

  test('concurrent saves are serialized: none is lost', async () => {
    const ids = ['yt.general.hideAds', 'yt.general.hidePremiumUpsells', 'yt.guide.hideFooter', 'yt.guide.hideExploreSection', 'yt.comments.hideTeaser'];
    await Promise.all(ids.map((id) => AP.settings.save({ [id]: true })));
    assert.deepEqual(Object.keys(await stored('settings')).sort(), [...ids].sort());
  });

  test('stores detached copies (list/object values)', async () => {
    const rules = [{ id: 'r1', selector: 'a', page: null, note: '', createdAt: 1 }];
    await AP.settings.save({ 'advanced.customRules': rules });
    rules[0].selector = 'mutated';
    assert.equal((await stored('settings'))['advanced.customRules'][0].selector, 'a');
  });

  test('a patch that is not an object is a programming error', () => {
    assert.throws(() => AP.settings.save(null), TypeError);
    assert.throws(() => AP.settings.save([['a', 1]]), TypeError);
  });

  test('a failed save rejects, and the queue keeps working for later saves', async () => {
    const realSet = fake.storage.local.set;
    fake.storage.local.set = () => Promise.reject(new Error('quota'));
    await assert.rejects(AP.settings.save({ 'yt.general.hideAds': true }), /quota/);
    fake.storage.local.set = realSet;
    assert.deepEqual((await AP.settings.save({ 'yt.guide.hideFooter': true })).changed, ['yt.guide.hideFooter']);
    assert.deepEqual(await stored('settings'), { 'yt.guide.hideFooter': true });
  });
});

describe('reset()', () => {
  beforeEach(() => store({ settings: { 'yt.general.hideAds': true, 'yt.guide.hideFooter': true, 'advanced.lock': { mode: 'password', hash: 'x' }, 'future.setting': 1 } }));

  test('with ids: just those', async () => {
    assert.deepEqual(await AP.settings.reset(['yt.general.hideAds', 'not.stored']), { changed: ['yt.general.hideAds'] });
    assert.deepEqual(Object.keys(await stored('settings')).sort(), ['advanced.lock', 'future.setting', 'yt.guide.hideFooter']);
  });

  test('without ids: everything portable goes, the lock stays', async () => {
    const { changed } = await AP.settings.reset();
    assert.deepEqual(changed.sort(), ['future.setting', 'yt.general.hideAds', 'yt.guide.hideFooter']);
    assert.deepEqual(await stored('settings'), { 'advanced.lock': { mode: 'password', hash: 'x' } });
  });

  test('nothing to reset → no write', async () => {
    await AP.settings.reset();
    writes.length = 0;
    assert.deepEqual(await AP.settings.reset(['yt.guide.hideFooter']), { changed: [] });
    assert.deepEqual(writes, []);
  });
});

describe('applyPreset()', () => {
  beforeEach(() =>
    store({
      settings: {
        'yt.comments.hideTeaser': true,
        'yt.general.hideAds': true,
        'general.theme': 'dark',
        'general.enabled': false,
        'pause.breathSeconds': 10,
        'advanced.customRules': [{ id: 'r1', selector: 'a', page: null, note: '', createdAt: 1 }],
        'focus.dailyMinutes': 30,
        'future.setting': 1,
      },
    }),
  );

  test('settings := defaults ⊕ preset for in-scope settings; everything else is left alone', async () => {
    writes.length = 0;
    const result = await AP.settings.applyPreset('focused');
    assert.equal(result.ok, true);
    assert.deepEqual(writes, [['settings']], 'only `settings` is written');
    const s = await stored('settings');
    // previous in-scope choice that is not in the preset is gone (back to default)
    assert.equal('yt.comments.hideTeaser' in s, true, 'Focused hides the teaser itself');
    // preset values applied
    assert.equal(s['yt.watch.hideRelated'], true);
    assert.equal(s['yt.home.feedMode'], 'hide');
    // out-of-scope + unknown keys untouched
    assert.equal(s['general.theme'], 'dark');
    assert.equal(s['general.enabled'], false);
    assert.equal(s['pause.breathSeconds'], 10);
    assert.equal(s['focus.dailyMinutes'], 30);
    assert.equal(s['advanced.customRules'].length, 1);
    assert.equal(s['future.setting'], 1);
  });

  test('"Untouched" clears every in-scope choice and nothing else', async () => {
    const result = await AP.settings.applyPreset('untouched');
    assert.equal(result.ok, true);
    assert.deepEqual(result.changed.sort(), ['yt.comments.hideTeaser', 'yt.general.hideAds']);
    const s = await stored('settings');
    assert.equal('yt.general.hideAds' in s, false);
    assert.equal(s['general.theme'], 'dark');
    assert.equal(s['future.setting'], 1);
  });

  test('`changed` lists in-scope settings whose effective value actually changed', async () => {
    const { changed } = await AP.settings.applyPreset('gentle');
    assert.ok(changed.includes('yt.comments.hideTeaser'), 'turned off');
    assert.ok(!changed.includes('yt.general.hideAds'), 'already on');
    assert.ok(changed.includes('yt.guide.hideFooter'), 'turned on');
    assert.ok(!changed.includes('general.theme'));
  });

  test('applying the same preset twice changes nothing the second time (and does not write)', async () => {
    await AP.settings.applyPreset('gentle');
    writes.length = 0;
    const again = await AP.settings.applyPreset('gentle');
    assert.deepEqual(again, { ok: true, changed: [] });
    assert.deepEqual(writes, []);
  });

  test('accepts a plain values map (validated) and custom preset ids; unknown ids fail cleanly', async () => {
    const byValues = await AP.settings.applyPreset({ 'yt.guide.hideFooter': true, 'yt.nope': 1, 'general.theme': 'light' });
    assert.equal(byValues.ok, true);
    const s = await stored('settings');
    assert.equal(s['yt.guide.hideFooter'], true);
    assert.equal(s['general.theme'], 'dark', 'out-of-scope values in a map are ignored');

    await store({ customPresets: [{ id: 'mine', name: 'Mine', values: { 'yt.comments.hideAll': true } }] });
    assert.equal((await AP.settings.applyPreset('mine')).ok, true);
    assert.equal((await stored('settings'))['yt.comments.hideAll'], true);

    assert.deepEqual(await AP.settings.applyPreset('ghost'), { ok: false, changed: [], error: 'unknown-preset' });
  });
});

describe('custom presets', () => {
  test('save current as preset captures in-scope, non-default values', async () => {
    await store({ settings: { 'yt.general.hideAds': true, 'yt.guide.hideFooter': false, 'general.theme': 'dark', 'yt.shorts.mode': 'block' } });
    const res = await AP.settings.saveCustomPreset('  Evening  ');
    assert.equal(res.ok, true);
    assert.match(res.preset.id, /^preset_[0-9a-f]{12}$/);
    assert.equal(res.preset.name, 'Evening');
    assert.deepEqual(res.preset.values, { 'yt.general.hideAds': true, 'yt.shorts.mode': 'block' });
    assert.deepEqual(await stored('customPresets'), [{ id: res.preset.id, name: 'Evening', values: res.preset.values, createdAt: res.preset.createdAt }]);
    assert.deepEqual((await AP.settings.listCustomPresets()).map((p) => p.name), ['Evening']);
  });

  test('explicit values are sanitized; names are required; the list is capped', async () => {
    const res = await AP.settings.saveCustomPreset('X', { 'yt.general.hideAds': true, 'general.theme': 'dark', nope: 1 });
    assert.deepEqual(res.preset.values, { 'yt.general.hideAds': true });
    assert.deepEqual(await AP.settings.saveCustomPreset('   '), { ok: false, error: 'name-required' });
    assert.deepEqual(await AP.settings.saveCustomPreset(null), { ok: false, error: 'name-required' });
    await store({ customPresets: Array.from({ length: 50 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, values: {} })) });
    assert.deepEqual(await AP.settings.saveCustomPreset('One too many'), { ok: false, error: 'too-many-presets' });
  });

  test('rename and delete; unknown ids fail cleanly', async () => {
    const { preset } = await AP.settings.saveCustomPreset('Old', {});
    assert.deepEqual(await AP.settings.renameCustomPreset(preset.id, ' New '), { ok: true });
    assert.equal((await AP.settings.listCustomPresets())[0].name, 'New');
    assert.deepEqual(await AP.settings.renameCustomPreset(preset.id, ''), { ok: false, error: 'name-required' });
    assert.deepEqual(await AP.settings.renameCustomPreset('ghost', 'x'), { ok: false, error: 'unknown-preset' });
    assert.deepEqual(await AP.settings.deleteCustomPreset('ghost'), { ok: false, error: 'unknown-preset' });
    assert.deepEqual(await AP.settings.deleteCustomPreset(preset.id), { ok: true });
    assert.deepEqual(await AP.settings.listCustomPresets(), []);
  });

  test('update from current replaces the values and keeps id, name and date', async () => {
    await store({ settings: { 'yt.general.hideAds': true } });
    const { preset } = await AP.settings.saveCustomPreset('Mine');
    await store({ settings: { 'yt.general.hideAds': false, 'yt.shorts.mode': 'block', 'general.theme': 'dark' } });
    const res = await AP.settings.updateCustomPreset(preset.id);
    assert.equal(res.ok, true);
    const [after] = await AP.settings.listCustomPresets();
    assert.deepEqual(after.values, { 'yt.shorts.mode': 'block' }, 'what is set now, in scope, off default');
    assert.equal(after.id, preset.id);
    assert.equal(after.name, 'Mine');
    assert.equal(after.createdAt, preset.createdAt);
    assert.deepEqual((await AP.settings.updateCustomPreset(preset.id, { 'yt.general.hideAds': true, nope: 1 })).preset.values, { 'yt.general.hideAds': true });
    assert.deepEqual(await AP.settings.updateCustomPreset('ghost'), { ok: false, error: 'unknown-preset' });
  });

  test('restore puts a deleted preset back where it was, with its id (a schedule may point at it)', async () => {
    const a = (await AP.settings.saveCustomPreset('A', { 'yt.general.hideAds': true })).preset;
    const b = (await AP.settings.saveCustomPreset('B', { 'yt.shorts.mode': 'block' })).preset;
    const c = (await AP.settings.saveCustomPreset('C', {})).preset;
    await AP.settings.deleteCustomPreset(b.id);
    assert.deepEqual((await AP.settings.listCustomPresets()).map((p) => p.name), ['A', 'C']);
    assert.deepEqual(await AP.settings.restoreCustomPreset(b, 1), { ok: true });
    const list = await AP.settings.listCustomPresets();
    assert.deepEqual(list.map((p) => p.name), ['A', 'B', 'C']);
    assert.deepEqual(list[1], { ...b, builtIn: false }, 'same id, values and date');
    assert.deepEqual(await AP.settings.restoreCustomPreset(b, 0), { ok: false, error: 'exists' });
    assert.deepEqual(await AP.settings.restoreCustomPreset({ id: 'bad id', name: 'x' }, 0), { ok: false, error: 'invalid-preset' });
    assert.deepEqual(await AP.settings.restoreCustomPreset(a), { ok: false, error: 'exists' });
    await AP.settings.deleteCustomPreset(c.id);
    assert.deepEqual(await AP.settings.restoreCustomPreset(c, 99), { ok: true }, 'an index past the end appends');
    assert.deepEqual((await AP.settings.listCustomPresets()).map((p) => p.name), ['A', 'B', 'C']);
  });

  test('a custom preset can be applied', async () => {
    await store({ settings: { 'yt.general.hideAds': true } });
    const { preset } = await AP.settings.saveCustomPreset('Ads on');
    await AP.settings.applyPreset('untouched');
    assert.equal((await AP.settings.effective())['yt.general.hideAds'], false);
    await AP.settings.applyPreset(preset.id);
    assert.equal((await AP.settings.effective())['yt.general.hideAds'], true);
  });
});

describe('subscribe()', () => {
  test('a burst of changes is one callback with the exact changed ids and the new effective map', async () => {
    const calls = [];
    const stop = AP.settings.subscribe((eff, changed, info) => calls.push({ eff, changed, info }));
    await sleep(10);
    await AP.settings.save({ 'yt.general.hideAds': true });
    await AP.settings.save({ 'yt.guide.hideFooter': true });
    await AP.settings.save({ 'pause.breathSeconds': 12 });
    await waitFor(() => calls.length > 0);
    await sleep(120);
    assert.equal(calls.length, 1, 'debounced');
    assert.deepEqual(calls[0].changed.sort(), ['pause.breathSeconds', 'yt.general.hideAds', 'yt.guide.hideFooter']);
    assert.deepEqual(calls[0].info, { keys: ['settings'] });
    assert.equal(calls[0].eff['yt.general.hideAds'], true);
    stop();
  });

  test('the next callback diffs against the previous one', async () => {
    const calls = [];
    const stop = AP.settings.subscribe((eff, changed) => calls.push(changed));
    await AP.settings.save({ 'yt.general.hideAds': true });
    await waitFor(() => calls.length === 1);
    await AP.settings.save({ 'yt.guide.hideFooter': true });
    await waitFor(() => calls.length === 2);
    assert.deepEqual(calls, [['yt.general.hideAds'], ['yt.guide.hideFooter']]);
    stop();
  });

  test('uses the caller\'s initial snapshot so a change between "read" and "subscribe" is not lost', async () => {
    const initial = AP.settings.effective(); // read before the change…
    await AP.settings.save({ 'yt.general.hideAds': true }); // …change lands before subscribe()
    const calls = [];
    const stop = AP.settings.subscribe((eff, changed) => calls.push(changed), initial);
    await store({ customPresets: [] }); // any watched key triggers a diff against the snapshot
    await waitFor(() => calls.length === 1);
    assert.deepEqual(calls[0], ['yt.general.hideAds']);
    stop();
  });

  test('state / customPresets / meta changes call back too (changed may be empty); other keys and areas are ignored', async () => {
    const calls = [];
    const stop = AP.settings.subscribe((eff, changed, info) => calls.push({ changed, keys: info.keys }));
    await sleep(10);
    await store({ stats: { '2026-01-01': {} } });
    await fake.storage.session.set({ settings: { 'yt.general.hideAds': true } });
    await sleep(120);
    assert.equal(calls.length, 0);
    await store({ customPresets: [{ id: 'a', name: 'A', values: {} }] });
    await waitFor(() => calls.length === 1);
    assert.deepEqual(calls[0], { changed: [], keys: ['customPresets'] });
    await store({ state: { scheduleOverride: 'focused' } });
    await waitFor(() => calls.length === 2);
    assert.deepEqual(calls[1].keys, ['state']);
    assert.ok(calls[1].changed.includes('yt.watch.hideRelated'), 'a schedule override changes effective values');
    stop();
  });

  test('unsubscribe stops callbacks (even ones already debounced)', async () => {
    const calls = [];
    const stop = AP.settings.subscribe(() => calls.push(1));
    await sleep(10);
    await AP.settings.save({ 'yt.general.hideAds': true });
    stop();
    await sleep(150);
    assert.equal(calls.length, 0);
    assert.equal(fake.storage.onChanged.listeners.length, 0);
  });

  test('a throwing callback is logged, not thrown, and later changes still arrive', async () => {
    let n = 0;
    const stop = AP.settings.subscribe(() => {
      n++;
      if (n === 1) throw new Error('subscriber bug');
    });
    await sleep(10);
    await AP.settings.save({ 'yt.general.hideAds': true });
    await waitFor(() => n === 1);
    await AP.settings.save({ 'yt.guide.hideFooter': true });
    await waitFor(() => n === 2);
    assert.ok(console.warn.mock.calls.length >= 1);
    stop();
  });
});

describe('migrate()', () => {
  test('is a no-op copy at the current version', () => {
    const input = { 'yt.general.hideAds': true, 'pause.askIntention': true };
    const out = AP.settings.migrate(input, AP.settings.SCHEMA_VERSION);
    assert.deepEqual(out, input);
    assert.notEqual(out, input);
    assert.equal(AP.settings.MIGRATIONS.length, AP.settings.SCHEMA_VERSION - 1);
  });

  test('v1 → v2 drops the removed settings and leaves everything else intact', () => {
    assert.equal(AP.settings.SCHEMA_VERSION, 2);
    const removed = ['pause.askIntention', 'pause.escalate', 'pause.escalateStep', 'pause.showCount', 'pause.expiryOverlay', 'advanced.customCss', 'yt.general.calmTitles'];
    const kept = {
      'pause.enabled': true,
      'pause.breathSeconds': 12,
      'pause.sites': [{ siteKey: 'youtube', domain: 'youtube.com', enabled: true }],
      'yt.general.hideAds': true,
      'advanced.customRules': [{ id: 'r1', selector: '.x', page: null, note: '', createdAt: 1 }],
      'advanced.lock': { mode: 'none' },
      'general.theme': 'dark',
      'a.setting.from.a.newer.version': 7, // not this migration's business: it is kept (merge() ignores unknown ids anyway)
    };
    const stored = { ...kept, ...Object.fromEntries(removed.map((id) => [id, id === 'advanced.customCss' ? 'a { color: red }' : true])) };
    const input = structuredClone(stored);
    const out = AP.settings.migrate(input, 1);
    assert.deepEqual(input, stored, 'the input is not mutated');
    assert.deepEqual(out, kept);
    for (const id of removed) assert.equal(Object.hasOwn(out, id), false, id);
    assert.deepEqual(AP.settings.migrate(out, 2), out, 'running it again changes nothing');
    assert.deepEqual(AP.settings.migrate({}, 1), {});
    assert.deepEqual(AP.settings.migrate({ 'pause.showCount': false }, 1), {}, 'a stored "off" no longer matters: the behaviour is always on');
  });

  test('effective() migrates an old stored layout in memory, whatever meta says', async () => {
    await store({ settings: { 'pause.askIntention': true, 'pause.breathSeconds': 11 }, meta: { schemaVersion: 1 } });
    const eff = await AP.settings.effective();
    assert.equal(eff['pause.breathSeconds'], 11);
    assert.equal('pause.askIntention' in eff, false);
  });

  test('an old backup (schemaVersion 1) imports without the removed settings and without complaint', async () => {
    const report = await AP.settings.importAll({ app: 'at-peace', schemaVersion: 1, settings: { 'pause.askIntention': true, 'pause.escalate': true, 'advanced.customCss': 'a{}', 'pause.breathSeconds': 8 } });
    assert.equal(report.ok, true);
    assert.equal(report.applied, 1);
    assert.deepEqual(report.dropped, []);
    assert.equal((await AP.settings.load())['pause.breathSeconds'], 8);
  });

  test('runs the pipeline in order from the stored version up to the target', () => {
    const migrations = [
      (s) => ({ ...s, step1: true }), // 1 → 2
      (s) => {
        const { old, ...rest } = s; // 2 → 3: a rename
        return { ...rest, renamed: old };
      },
      (s) => ({ ...s, step3: true }), // 3 → 4
    ];
    assert.deepEqual(AP.settings.migrate({ old: 1 }, 1, { migrations, toVersion: 4 }), { renamed: 1, step1: true, step3: true });
    assert.deepEqual(AP.settings.migrate({ old: 1 }, 2, { migrations, toVersion: 4 }), { renamed: 1, step3: true });
    assert.deepEqual(AP.settings.migrate({ old: 1 }, 3, { migrations, toVersion: 4 }), { old: 1, step3: true });
    assert.deepEqual(AP.settings.migrate({ old: 1 }, 4, { migrations, toVersion: 4 }), { old: 1 });
  });

  test('data from a NEWER version is passed through untouched; bad input is tolerated', () => {
    assert.deepEqual(AP.settings.migrate({ a: 1 }, 9, { migrations: [() => ({ boom: 1 })], toVersion: 2 }), { a: 1 });
    assert.deepEqual(AP.settings.migrate(null, 1), {});
    assert.deepEqual(AP.settings.migrate([1], 1), {});
    assert.deepEqual(AP.settings.migrate({ a: 1 }, 'x'), { a: 1 });
    assert.deepEqual(AP.settings.migrate({ a: 1 }, 0, { migrations: [(s) => ({ ...s, b: 2 })], toVersion: 2 }), { a: 1, b: 2 });
  });

  test('a step that returns nothing keeps the data; the input is never mutated', () => {
    const input = { a: 1 };
    const out = AP.settings.migrate(input, 1, { migrations: [(s) => { s.touched = true; }], toVersion: 2 });
    assert.deepEqual(input, { a: 1 });
    assert.deepEqual(out, { a: 1, touched: true });
  });
});

describe('exportAll() / importAll()', () => {
  const lock = { mode: 'password', salt: 's', hash: 'h' };

  beforeEach(() =>
    store({
      settings: { 'yt.general.hideAds': true, 'pause.breathSeconds': 12, 'advanced.lock': lock, 'future.setting': 1, 'yt.comments.hideAll': 'bad' },
      customPresets: [{ id: 'mine', name: 'Mine', values: { 'yt.guide.hideFooter': true }, createdAt: 5 }],
      state: { sessions: { youtube: 123 } },
      stats: { '2026-01-01': {} },
      meta: { schemaVersion: 1 },
    }),
  );

  test('export: app marker, version, valid portable settings and custom presets; never state, stats, meta or the lock', async () => {
    const out = await AP.settings.exportAll();
    assert.equal(out.app, 'at-peace');
    assert.equal(out.schemaVersion, AP.settings.SCHEMA_VERSION);
    assert.equal(out.version, '0.0.0-test');
    assert.match(out.exportedAt, /^\d{4}-\d\d-\d\dT/);
    assert.deepEqual(out.settings, { 'yt.general.hideAds': true, 'pause.breathSeconds': 12 });
    assert.deepEqual(out.customPresets, [{ id: 'mine', name: 'Mine', values: { 'yt.guide.hideFooter': true }, createdAt: 5 }]);
    assert.deepEqual(Object.keys(out).sort(), ['app', 'customPresets', 'exportedAt', 'schemaVersion', 'settings', 'version']);
    assert.doesNotThrow(() => JSON.stringify(out));
  });

  test('round trip: export → reset → import restores settings and presets, keeps the lock', async () => {
    const backup = JSON.stringify(await AP.settings.exportAll());
    await AP.settings.reset();
    await store({ customPresets: [] });
    const report = await AP.settings.importAll(backup);
    assert.equal(report.ok, true);
    assert.equal(report.applied, 2);
    assert.deepEqual(report.presets, { added: 1, replaced: 0, dropped: [] });
    assert.deepEqual(report.dropped, []);
    assert.deepEqual(report.invalid, []);
    const s = await stored('settings');
    assert.deepEqual(s, { 'advanced.lock': lock, 'yt.general.hideAds': true, 'pause.breathSeconds': 12 });
    assert.equal((await AP.settings.listCustomPresets()).length, 1);
    assert.deepEqual(await stored('state'), { sessions: { youtube: 123 } }, 'state untouched');
  });

  test('import REPLACES settings, but can never touch the lock; the report says what was dropped and why', async () => {
    const report = await AP.settings.importAll({
      app: 'at-peace',
      schemaVersion: 1,
      settings: {
        'yt.guide.hideFooter': true,
        'advanced.lock': { mode: 'none' },
        'no.such.setting': 1,
        'yt.comments.hideAll': 'sure',
        'pause.breathSeconds': 500,
      },
    });
    assert.equal(report.ok, true);
    assert.equal(report.applied, 2);
    assert.deepEqual(report.dropped, [
      { key: 'advanced.lock', reason: 'cannot be imported' },
      { key: 'no.such.setting', reason: 'unknown setting' },
    ]);
    assert.deepEqual(report.invalid, [{ key: 'yt.comments.hideAll', reason: 'value not allowed for this setting' }]);
    assert.deepEqual(await stored('settings'), { 'advanced.lock': lock, 'yt.guide.hideFooter': true, 'pause.breathSeconds': 30 });
  });

  test('custom presets merge by id (the file wins); reserved, malformed and surplus ones are reported', async () => {
    const report = await AP.settings.importAll({
      app: 'at-peace',
      settings: {},
      customPresets: [
        { id: 'mine', name: 'Renamed', values: { 'yt.general.hideAds': true } },
        { id: 'new', name: 'New', values: {} },
        { id: 'gentle', name: 'Impostor', values: {} },
        { id: 'x y', name: 'Bad id', values: {} },
        { name: 'No id' },
        'junk',
      ],
    });
    assert.deepEqual(report.presets, { added: 1, replaced: 1, dropped: ['Impostor', 'Bad id', 'No id', '?'] });
    const list = await AP.settings.listCustomPresets();
    assert.deepEqual(list.map((p) => [p.id, p.name]), [['mine', 'Renamed'], ['new', 'New']]);
  });

  test('not JSON, not an export, too large: reported, nothing written', async () => {
    const before = await fake.storage.local.get(null);
    writes.length = 0;
    assert.deepEqual((await AP.settings.importAll('{nope')).error, 'invalid-json');
    assert.deepEqual((await AP.settings.importAll('[]')).error, 'not-an-export');
    assert.deepEqual((await AP.settings.importAll({ settings: {} })).error, 'not-an-export');
    assert.deepEqual((await AP.settings.importAll({ app: 'other', settings: {} })).error, 'not-an-export');
    assert.deepEqual((await AP.settings.importAll({ app: 'at-peace', settings: [] })).error, 'not-an-export');
    assert.deepEqual((await AP.settings.importAll(null)).error, 'not-an-export');
    assert.deepEqual((await AP.settings.importAll('x'.repeat(5_000_001))).error, 'too-large');
    for (const input of ['{nope', '[]']) assert.equal((await AP.settings.importAll(input)).ok, false);
    assert.deepEqual(writes, []);
    assert.deepEqual(await fake.storage.local.get(null), before);
  });

  test('a file from a newer version imports what this version knows and says so', async () => {
    const report = await AP.settings.importAll({ app: 'at-peace', schemaVersion: 7, settings: { 'yt.general.hideAds': true, 'brand.new': true } });
    assert.equal(report.ok, true);
    assert.equal(report.newerThanThisVersion, true);
    assert.equal(report.fromVersion, 7);
    assert.deepEqual(report.dropped, [{ key: 'brand.new', reason: 'unknown setting' }]);
  });

  test('importing prototype-pollution style keys is harmless', async () => {
    const hostile = JSON.parse('{"app":"at-peace","settings":{"__proto__":{"polluted":true},"constructor":{"prototype":{"x":1}},"yt.general.hideAds":true}}');
    const report = await AP.settings.importAll(hostile);
    assert.equal(report.ok, true);
    assert.equal(({}).polluted, undefined);
    assert.equal(report.applied, 1);
  });
});
