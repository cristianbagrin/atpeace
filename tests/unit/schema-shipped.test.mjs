// The schema that actually ships: cross-site settings (src/shared/schema/*) and whatever the
// YouTube catalog (src/sites/youtube/schema/*, Phase 2b) registers.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadAtPeace, installFakeBrowser, uninstallFakeBrowser, CORE_SCRIPTS, SCHEMA_SCRIPTS, YOUTUBE_SCRIPTS } from './_load.mjs';

let AP;
let S;

before(async () => {
  installFakeBrowser();
  // page.js registers the YouTube page types so `page:` typos in the catalog are caught.
  AP = await loadAtPeace([...CORE_SCRIPTS, ...SCHEMA_SCRIPTS, YOUTUBE_SCRIPTS[0], YOUTUBE_SCRIPTS[1]]);
  S = AP.schema;
});
after(() => uninstallFakeBrowser());

describe('shipped registry', () => {
  test('validateRegistry() is clean', (t) => {
    const problems = S.validateRegistry();
    const youtube = S.all().filter((d) => S.siteOf(d.id) === 'youtube');
    t.diagnostic(`${S.all().length} settings registered (${youtube.length} YouTube), ${S.sections().length} sections`);
    assert.deepEqual(problems, []);
  });

  test('the compiled YouTube stylesheet parses as CSS: no parse errors, one top-level rule per compiled rule', async (t) => {
    // css-tree ships with web-ext's dependency tree (not a declared dependency), so skip if it is gone.
    let csstree;
    try {
      csstree = await import('css-tree');
    } catch {
      return t.skip('css-tree is not installed');
    }
    const lib = csstree.default ?? csstree;
    const compiled = S.compileRules('youtube');
    const errors = [];
    const ast = lib.parse(S.compileCss('youtube'), { onParseError: (e) => errors.push(`${e.message} @ ${e.line}:${e.column}`) });
    t.diagnostic(`${compiled.length} compiled rules`);
    assert.deepEqual(errors, []);
    assert.equal(ast.children.toArray().length, compiled.length);
  });

  test('every default is valid for its own definition and survives a round trip through validateValue', () => {
    for (const def of S.all()) assert.deepEqual(S.validateValue(def, def.default), def.default, def.id);
  });

  test('General comes first; YouTube sections sit in 100-899; Pause, Focus, Advanced come after', () => {
    const sections = S.sections();
    assert.equal(sections[0].id, 'general');
    for (const s of sections.filter((x) => x.site === 'youtube')) assert.ok(s.order >= 100 && s.order <= 899, `${s.id} order ${s.order}`);
    assert.deepEqual(sections.filter((x) => x.site === null).map((x) => [x.id, x.order]), [
      ['general', 10],
      ['pause', 900],
      ['focus', 910],
      ['advanced', 990],
    ]);
    const lastYt = Math.max(0, ...sections.filter((x) => x.site === 'youtube').map((x) => x.order));
    assert.ok(lastYt < 900);
  });

  test('presets only ever touch settings that are meant to be preset: all cross-site settings but pause.enabled opt out', () => {
    const optedIn = S.all().filter((d) => S.siteOf(d.id) === null && d.preset !== false).map((d) => d.id);
    assert.deepEqual(optedIn, ['pause.enabled']);
  });

  test('the settings lock is the only setting kept out of export/import', () => {
    assert.deepEqual(S.all().filter((d) => d.portable === false).map((d) => d.id), ['advanced.lock']);
  });
});

describe('general', () => {
  test('master switch and theme', () => {
    const enabled = S.get('general.enabled');
    assert.equal(enabled.type, 'toggle');
    assert.equal(enabled.default, true);
    assert.equal(enabled.quick, true);
    const theme = S.get('general.theme');
    assert.equal(theme.default, 'light');
    assert.deepEqual(theme.options.map((o) => o.value), ['light', 'dark', 'system']);
    assert.equal(S.siteOf('general.enabled'), null);
  });
});

describe('pause', () => {
  test('defaults per PLAN §8.3', () => {
    const d = S.defaults();
    assert.equal(d['pause.enabled'], false);
    assert.deepEqual(d['pause.sites'], [{ siteKey: 'youtube', domain: 'youtube.com', enabled: true }]);
    assert.equal(d['pause.breathSeconds'], 6);
    assert.equal(d['pause.sessionMinutes'], '15');
    for (const id of ['pause.escalate', 'pause.escalateStep', 'pause.askIntention', 'pause.showCount', 'pause.expiryOverlay']) assert.equal(id in d, false, `${id} was removed`);
  });

  test('ranges and options', () => {
    const v = (id, x) => S.validateValue(S.get(id), x);
    assert.equal(v('pause.breathSeconds', 1), 3);
    assert.equal(v('pause.breathSeconds', 99), 30);
    assert.equal(v('pause.breathSeconds', 12.4), 12);
    assert.deepEqual(S.get('pause.sessionMinutes').options.map((o) => o.value), ['5', '10', '15', '30', '60']);
    assert.equal(v('pause.sessionMinutes', 30), '30');
    assert.equal(v('pause.sessionMinutes', '20'), '15');
  });

  test('pause.sites keeps valid sites, lower-cases, drops junk, de-duplicates by siteKey, defaults enabled to true', () => {
    const sites = S.get('pause.sites');
    const out = S.validateValue(sites, [
      { siteKey: 'youtube', domain: 'YouTube.com', enabled: false },
      { siteKey: 'youtube', domain: 'm.youtube.com', enabled: true },
      { siteKey: 'reddit.com', domain: 'reddit.com' },
      { siteKey: 'bad key', domain: 'x.com' },
      { siteKey: 'x', domain: 'not a host' },
      { siteKey: 'x', domain: 'localhost' },
      { siteKey: 'x', domain: 'https://x.com/path' },
      { siteKey: 5, domain: 'x.com' },
      'youtube.com',
      null,
    ]);
    assert.deepEqual(out, [
      { siteKey: 'youtube', domain: 'youtube.com', enabled: false },
      { siteKey: 'reddit.com', domain: 'reddit.com', enabled: true },
    ]);
  });
});

describe('focus', () => {
  test('defaults per PLAN §8.4', () => {
    const d = S.defaults();
    assert.equal(d['focus.unlockFriction'], 'wait');
    assert.equal(d['focus.strict'], false);
    assert.equal(d['focus.dailyMinutes'], 0);
    assert.equal(d['focus.limitGrace'], 1);
    assert.deepEqual(d['focus.schedules'], []);
    assert.deepEqual(S.get('focus.unlockFriction').options.map((o) => o.value), ['none', 'wait', 'phrase']);
  });

  test('ranges', () => {
    const v = (id, x) => S.validateValue(S.get(id), x);
    assert.equal(v('focus.dailyMinutes', -5), 0);
    assert.equal(v('focus.dailyMinutes', 9999), 600);
    assert.equal(v('focus.limitGrace', 9), 5);
    assert.equal(v('focus.limitGrace', 2), 2);
  });

  test('schedules: valid ones are normalized, impossible ones are dropped (never repaired)', () => {
    const def = S.get('focus.schedules');
    const good = { id: 's1', name: ' Work ', days: [5, 1, 1, 3, 9, -1, 'x'], start: '09:00', end: '17:30', action: 'block', siteKeys: ['youtube', 'youtube', 'bad key'], enabled: false };
    const out = S.validateValue(def, [
      good,
      { id: 's2', days: [0], start: '22:00', end: '06:00', action: 'preset:deep-work' }, // overnight
      { id: 's3', days: [], start: '09:00', end: '10:00', action: 'block' },
      { id: 's4', days: [1], start: '9:00', end: '10:00', action: 'block' },
      { id: 's5', days: [1], start: '09:00', end: '09:00', action: 'block' },
      { id: 's6', days: [1], start: '09:00', end: '10:00', action: 'explode' },
      { id: 's7', days: [1], start: '24:00', end: '10:00', action: 'block' },
      { days: [1], start: '09:00', end: '10:00', action: 'block' },
      { id: 's1', days: [2], start: '09:00', end: '10:00', action: 'block' }, // duplicate id
      'nope',
    ]);
    assert.deepEqual(out, [
      { id: 's1', name: 'Work', days: [1, 3, 5], start: '09:00', end: '17:30', action: 'block', siteKeys: ['youtube'], enabled: false },
      { id: 's2', name: '', days: [0], start: '22:00', end: '06:00', action: 'preset:deep-work', siteKeys: ['youtube'], enabled: true },
    ]);
  });
});

describe('advanced', () => {
  test('defaults', () => {
    const d = S.defaults();
    assert.deepEqual(d['advanced.customRules'], []);
    assert.equal('advanced.customCss' in d, false, 'custom CSS was removed');
    assert.equal(d['advanced.debug'], false);
    assert.deepEqual(d['advanced.lock'], { mode: 'none' });
  });

  test('customRules: unsafe selectors and malformed items are dropped, fields normalized', () => {
    const def = S.get('advanced.customRules');
    const out = S.validateValue(def, [
      { id: 'r1', selector: ' ytd-masthead #logo ', page: 'home', note: 'logo', createdAt: 5, extra: 'x' },
      { id: 'r2', selector: 'a, b', page: null },
      { id: 'r3', selector: 'a { color: red }' },
      { id: 'r4', selector: '' },
      { id: 'bad id', selector: 'a' },
      { selector: 'a' },
      { id: 'r5', selector: 'a', page: 'Not A Page', note: 'x'.repeat(300), createdAt: 'yesterday', site: 'youtube' },
      { id: 'r1', selector: 'dup' },
      7,
    ]);
    assert.deepEqual(out, [
      { id: 'r1', selector: 'ytd-masthead #logo', page: 'home', note: 'logo', createdAt: 5 },
      { id: 'r2', selector: 'a, b', page: null, note: '', createdAt: 0 },
      { id: 'r5', selector: 'a', page: null, note: 'x'.repeat(200), createdAt: 0, site: 'youtube' },
    ]);
  });

  test('lock: mode is forced to a known value, a few flat primitive fields survive, the rest goes', () => {
    const def = S.get('advanced.lock');
    assert.deepEqual(S.validateValue(def, { mode: 'password', salt: 'abc', hash: 'def', iterations: 1000, nested: { a: 1 }, 'bad key': 1, list: [1] }), {
      mode: 'password',
      salt: 'abc',
      hash: 'def',
      iterations: 1000,
    });
    assert.deepEqual(S.validateValue(def, { mode: 'root' }), { mode: 'none' });
    assert.deepEqual(S.validateValue(def, 'password'), { mode: 'none' });
    assert.deepEqual(S.validateValue(def, { mode: 'friction', hash: 'x'.repeat(513) }), { mode: 'friction' });
  });
});
