// The pure parts of the two options editors written in Phase 3c (pause-sites.js, schedules.js).
// The DOM parts are exercised in the browser (tests/e2e/mindful-options.spec.mjs).
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadAtPeace, installFakeBrowser, uninstallFakeBrowser, CORE_SCRIPTS, SCHEMA_SCRIPTS } from './_load.mjs';

let AP;
let sites;
let schedules;

beforeEach(async () => {
  installFakeBrowser();
  AP = await loadAtPeace([
    ...CORE_SCRIPTS,
    ...SCHEMA_SCRIPTS,
    'src/pages/options/renderers/registry.js',
    'src/pages/options/renderers/pause-sites.js',
    'src/pages/options/renderers/schedules.js',
  ]);
  sites = AP.optionsRenderers['pause.sites'];
  schedules = AP.optionsRenderers['focus.schedules'];
});
afterEach(() => uninstallFakeBrowser());

describe('both editors are registered for the right settings', () => {
  test('ids exist in the schema and the registry finds the renderers', () => {
    for (const id of ['pause.sites', 'focus.schedules']) {
      const def = AP.schema.get(id);
      assert.ok(def, id);
      assert.equal(AP.optionsRendererFor(def), AP.optionsRenderers[id]);
      assert.equal(typeof AP.optionsRenderers[id].render, 'function');
      assert.equal(typeof AP.optionsRenderers[id].update, 'function');
    }
  });
});

describe('parseSiteInput', () => {
  const none = [];

  test('accepts addresses in the ways people type them and keeps the bare domain', () => {
    for (const [typed, domain] of [
      ['reddit.com', 'reddit.com'],
      ['  Reddit.COM  ', 'reddit.com'],
      ['www.reddit.com', 'reddit.com'],
      ['https://www.reddit.com/r/calm?x=1#y', 'reddit.com'],
      ['http://old.reddit.com', 'old.reddit.com'],
      ['news.example.co.uk/path', 'news.example.co.uk'],
      ['reddit.com.', 'reddit.com'],
      ['music.youtube.com', 'music.youtube.com'],
      ['a-b.example.org', 'a-b.example.org'],
    ]) {
      assert.deepEqual(sites.parseSiteInput(typed, none), { ok: true, domain }, typed);
    }
  });

  test('refuses what cannot work, with a sentence that says why', () => {
    for (const typed of ['', '   ', 'localhost', '127.0.0.1', '192.168.1.1', 'single', 'bad_host.com', 'a..b.com', '-x.com', 'exa mple.com', 'http://', 'https://[::1]/', 'ex@mple.com:80']) {
      const res = sites.parseSiteInput(typed, none);
      assert.equal(res.ok, false, `"${typed}" should be refused`);
      assert.ok(res.message.length > 10, typed);
    }
  });

  test('YouTube is built in, whatever form it is typed in; duplicates are refused', () => {
    for (const typed of ['youtube.com', 'www.youtube.com', 'https://m.youtube.com/watch?v=x', 'YOUTUBE.com']) {
      assert.match(sites.parseSiteInput(typed, none).message, /YouTube is built in/, typed);
    }
    const existing = [{ siteKey: 'reddit.com', domain: 'reddit.com' }];
    assert.match(sites.parseSiteInput('www.reddit.com', existing).message, /already in the list/);
  });

  test('whatever it accepts, the schema accepts too', () => {
    const def = AP.schema.get('pause.sites');
    const res = sites.parseSiteInput('https://www.Example-Site.org/x', none);
    assert.equal(res.ok, true);
    const entry = { siteKey: res.domain, domain: res.domain, enabled: true };
    assert.deepEqual(AP.schema.validateValue(def, [...def.default, entry]), [...def.default, entry]);
  });
});

describe('schedules: problemWith agrees with what the schema keeps', () => {
  const def = () => AP.schema.get('focus.schedules');
  const ok = () => schedules.newSchedule(0);

  test('a new schedule is valid and survives the schema untouched', () => {
    const s = ok();
    assert.equal(schedules.problemWith(s), null);
    assert.deepEqual(AP.schema.validateValue(def(), [s]), [s]);
  });

  test('every problem the editor reports is one the schema would silently drop', () => {
    const cases = [
      [{ days: [] }, /at least one day/],
      [{ start: '', end: '10:00' }, /start and an end/],
      [{ start: '25:00' }, /start and an end/],
      [{ end: '09:00' }, /cannot be the same/],
      [{ siteKeys: [] }, /at least one site/],
    ];
    for (const [patch, message] of cases) {
      const s = { ...ok(), ...patch };
      assert.match(schedules.problemWith(s), message, JSON.stringify(patch));
      if (!('siteKeys' in patch)) assert.deepEqual(AP.schema.validateValue(def(), [s]), [], `schema keeps ${JSON.stringify(patch)}`);
    }
  });

  test('overnight and preset schedules are fine', () => {
    assert.equal(schedules.problemWith({ ...ok(), start: '22:00', end: '06:00' }), null);
    assert.equal(schedules.problemWith({ ...ok(), action: 'preset:focused', siteKeys: [] }), null, 'siteKeys only matter for blocks');
    assert.equal(AP.schema.validateValue(def(), [{ ...ok(), start: '22:00', end: '06:00' }]).length, 1);
  });

  test('ids of new schedules are unique and schema-safe', () => {
    const ids = new Set(Array.from({ length: 50 }, (_, i) => schedules.newSchedule(i).id));
    assert.equal(ids.size, 50);
    for (const id of ids) assert.match(id, /^[A-Za-z0-9_-]{1,40}$/);
  });

  test('summary reads naturally, including past midnight and every day', () => {
    assert.equal(schedules.summary({ days: [1, 2, 3, 4, 5], start: '09:00', end: '17:30' }), '09:00 to 17:30, Mon, Tue, Wed, Thu, Fri');
    assert.equal(schedules.summary({ days: [0, 1, 2, 3, 4, 5, 6], start: '22:00', end: '06:00' }), '22:00 to 06:00 the next morning, every day');
  });
});
