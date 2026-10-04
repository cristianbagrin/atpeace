// Pure helpers behind the popup and options pages (src/pages/common/logic.js).
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadAtPeace, installFakeBrowser, uninstallFakeBrowser, CORE_SCRIPTS, SCHEMA_SCRIPTS } from './_load.mjs';
import { defineFixtureCatalog } from './_fixtures.mjs';

let AP;
let ui;

beforeEach(async () => {
  installFakeBrowser();
  const schema = SCHEMA_SCRIPTS.filter((f) => !f.startsWith('src/sites/youtube/schema/'));
  AP = await loadAtPeace([...CORE_SCRIPTS, ...schema]);
  defineFixtureCatalog(AP);
  // logic.js attaches to the same namespace: load it on top without resetting it.
  await import(new URL(`../../src/pages/common/logic.js?t=${Math.random()}`, import.meta.url).href);
  ui = AP.ui;
});

afterEach(() => uninstallFakeBrowser());

describe('time', () => {
  test('formatDuration is calm and rounded to the minute', () => {
    assert.equal(ui.formatDuration(0), '0 min');
    assert.equal(ui.formatDuration(12), '<1 min');
    assert.equal(ui.formatDuration(45), '1 min');
    assert.equal(ui.formatDuration(60 * 42), '42 min');
    assert.equal(ui.formatDuration(3600), '1 h');
    assert.equal(ui.formatDuration(3600 + 5 * 60), '1 h 05 min');
    assert.equal(ui.formatDuration(3599), '1 h');
    assert.equal(ui.formatDuration(-5), '0 min');
    assert.equal(ui.formatDuration(NaN), '0 min');
  });

  test('formatClock rounds up so a running clock never shows 00:00 early', () => {
    assert.equal(ui.formatClock(0), '00:00');
    assert.equal(ui.formatClock(0.2), '00:01');
    assert.equal(ui.formatClock(61), '01:01');
    assert.equal(ui.formatClock(25 * 60), '25:00');
    assert.equal(ui.formatClock(3600 + 62), '1:01:02');
    assert.equal(ui.formatClock(-3), '00:00');
  });
});

describe('bulk chips', () => {
  const none = () => AP.schema.defaults();

  test('state is none / partly / all against the tag targets', () => {
    const targets = AP.schema.bulkTargets('shorts');
    const ids = Object.keys(targets);
    assert.ok(ids.length >= 3);
    assert.equal(ui.bulkState('shorts', none()).state, 'none');

    const some = { ...none(), [ids[0]]: targets[ids[0]] };
    assert.deepEqual(ui.bulkState('shorts', some), { state: 'partly', on: 1, total: ids.length });

    const all = { ...none(), ...targets };
    assert.deepEqual(ui.bulkState('shorts', all), { state: 'all', on: ids.length, total: ids.length });
  });

  test('a select counts as on only at its bulk ("most hidden") value', () => {
    const values = { ...none(), ...AP.schema.bulkTargets('shorts'), 'yt.shorts.mode': 'watch' };
    assert.equal(ui.bulkState('shorts', values).state, 'partly');
  });

  test('a tag nothing carries is "empty"', () => {
    assert.equal(ui.bulkState('player', none()).state, 'empty');
  });

  test('the patch turns everything on, or everything off when all is on already', () => {
    const on = ui.bulkPatch('shorts', none());
    assert.deepEqual(on, AP.schema.bulkTargets('shorts'));
    const off = ui.bulkPatch('shorts', { ...none(), ...on });
    assert.equal(off['yt.guide.hideShorts'], false);
    assert.equal(off['yt.shorts.mode'], 'allow'); // the select's default
    assert.deepEqual(Object.keys(off).sort(), Object.keys(on).sort());
  });
});

describe('rows', () => {
  test('requires: a row is usable only while the setting it names is on, down the chain', () => {
    const values = AP.schema.defaults();
    const pause = AP.schema.get('pause.enabled');
    assert.equal(ui.requiresState(AP.schema.get('pause.breathSeconds'), values).enabled, false);
    assert.equal(ui.requiresState(AP.schema.get('pause.breathSeconds'), values).needs.id, pause.id);

    values['pause.enabled'] = true;
    assert.equal(ui.requiresState(AP.schema.get('pause.breathSeconds'), values).enabled, true);

    // pause.escalateStep -> pause.escalate -> pause.enabled
    const step = AP.schema.get('pause.escalateStep');
    assert.equal(ui.requiresState(step, values).enabled, false);
    assert.equal(ui.requiresState(step, values).needs.id, 'pause.escalate');
    values['pause.escalate'] = true;
    assert.equal(ui.requiresState(step, values).enabled, true);
    values['pause.enabled'] = false; // the root is off again: still not usable, and the hint names the root
    const blocked = ui.requiresState(step, values);
    assert.equal(blocked.enabled, false);
    assert.equal(blocked.needs.id, 'pause.enabled');

    assert.deepEqual(ui.requiresState(AP.schema.get('pause.enabled'), values), { enabled: true, needs: null });
  });

  test('requiresHint speaks plainly for toggles, selects and numbers', () => {
    assert.match(ui.requiresHint({ type: 'toggle', label: 'Pause before opening' }), /Turn on “Pause before opening”/);
    assert.match(ui.requiresHint({ type: 'select', label: 'When I open YouTube' }), /change “When I open YouTube”/);
    assert.match(ui.requiresHint({ type: 'number', label: 'Daily limit' }), /“Daily limit” is set/);
    assert.equal(ui.requiresHint(null), '');
  });

  test('quickSettings: quick ones in section order, never the master switch', () => {
    AP.schema.define('yt.fixture', [
      { id: 'yt.fixture.quickB', label: 'B', type: 'toggle', default: false, quick: true, feature: 'x' },
      { id: 'yt.fixture.quickA', label: 'A', type: 'toggle', default: false, quick: true, feature: 'x' },
    ]);
    const ids = ui.quickSettings().map((d) => d.id);
    assert.ok(!ids.includes('general.enabled'));
    // the YouTube section (order 200) comes before Mindful Pause (900); within a section, registration order
    assert.deepEqual(ids, ['yt.fixture.quickB', 'yt.fixture.quickA', 'pause.enabled']);
  });

  test('isStringList tells word lists from object lists and multi-selects', () => {
    assert.equal(ui.isStringList({ type: 'list' }), true);
    assert.equal(ui.isStringList({ type: 'list', item: () => null }), false);
    assert.equal(ui.isStringList({ type: 'list', options: [] }), false);
    assert.equal(ui.isStringList({ type: 'toggle' }), false);
  });
});

describe('search', () => {
  const def = (extra) => ({ id: 'yt.x.y', label: 'Hide Shorts', description: 'Removes the Shorts shelf from the home page.', group: 'Shelves', tags: ['shorts'], ...extra });

  test('every word has to match, anywhere in label, description, group, tags, id or section', () => {
    const section = { title: 'Home' };
    assert.equal(ui.matchesQuery(def(), section, 'shorts'), true);
    assert.equal(ui.matchesQuery(def(), section, 'shelf home'), true);
    assert.equal(ui.matchesQuery(def(), section, 'shelves'), true); // group name
    assert.equal(ui.matchesQuery(def({ tags: ['ads'], label: 'Hide ads', description: '' }), section, 'ads'), true);
    assert.equal(ui.matchesQuery(def(), section, 'yt.x.y'), true); // id
    assert.equal(ui.matchesQuery(def(), section, 'home'), true); // section title
    assert.equal(ui.matchesQuery(def(), section, 'shorts comments'), false);
    assert.equal(ui.matchesQuery(def(), section, 'zebra'), false);
  });

  test('case and accents do not matter; an empty query matches everything', () => {
    assert.equal(ui.matchesQuery(def({ label: 'Épisodes récents' }), undefined, 'EPISODES recents'), true);
    assert.equal(ui.matchesQuery(def(), undefined, '   '), true);
    assert.equal(ui.matchesQuery(def(), undefined, ''), true);
    assert.deepEqual(ui.queryTokens('  Hide   SHORTS '), ['hide', 'shorts']);
  });

  test('works on the real registry', () => {
    const hits = AP.schema.all().filter((d) => ui.matchesQuery(d, AP.schema.sections().find((s) => s.id === d.section), 'pause'));
    assert.ok(hits.some((d) => d.id === 'pause.enabled'));
    assert.ok(hits.length < AP.schema.all().length);
  });
});

describe('word lists', () => {
  test('plain lines are trimmed, blanks skipped, repeats dropped', () => {
    const { items, errors } = ui.parseLines('  spoiler \n\nleak\r\nspoiler\n');
    assert.deepEqual(items, ['spoiler', 'leak']);
    assert.deepEqual(errors, []);
  });

  test('regex lines must compile; the error carries the line number', () => {
    const { items, errors } = ui.parseLines('fine\n/colou?r/i\n/(/\n/ok/\nnot/a/regex', { regex: true });
    assert.equal(items.length, 5);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].line, 3);
    assert.match(errors[0].message, /^Not a valid regular expression/);
  });

  test('unknown flags are an error, text with slashes inside is not a regex', () => {
    assert.match(ui.checkWordLine('/abc/zz'), /Not a valid regular expression/);
    assert.equal(ui.checkWordLine('a/b/c'), null);
    assert.equal(ui.checkWordLine('/colou?r/gi'), null);
    assert.equal(ui.checkWordLine('/'), null);
    assert.match(ui.checkWordLine('x'.repeat(501)), /Too long/);
  });

  test('without regex mode, slash lines pass through untouched', () => {
    assert.deepEqual(ui.parseLines('/(/', { regex: false }), { items: ['/(/'], errors: [] });
  });
});

describe('numbers', () => {
  test('numberCheck accepts numbers in range and explains the rest', () => {
    const def = { min: 3, max: 30 };
    assert.deepEqual(ui.numberCheck(def, '6'), { ok: true, value: 6 });
    assert.deepEqual(ui.numberCheck(def, ' 30 '), { ok: true, value: 30 });
    assert.deepEqual(ui.numberCheck(def, 3), { ok: true, value: 3 });
    assert.equal(ui.numberCheck(def, '2').ok, false);
    assert.match(ui.numberCheck(def, '31').message, /from 3 to 30/);
    assert.equal(ui.numberCheck(def, '').ok, false);
    assert.equal(ui.numberCheck(def, 'abc').ok, false);
    assert.match(ui.numberCheck(def, 'abc').message, /Enter a number/);
    assert.match(ui.numberCheck({ min: 1 }, '0').message, /1 or more/);
    assert.match(ui.numberCheck({ max: 9 }, '10').message, /9 or less/);
    assert.deepEqual(ui.numberCheck({}, '-4'), { ok: true, value: -4 });
  });
});

describe('presets', () => {
  test('matchingPresetId finds the preset whose values equal what is set', async () => {
    const presets = AP.presets.builtIn();
    const defaults = AP.schema.defaults();
    assert.equal(ui.matchingPresetId(defaults, presets), 'untouched');

    const gentle = AP.presets.valuesFor('gentle');
    assert.equal(ui.matchingPresetId({ ...defaults, ...gentle }, presets), 'gentle');
    assert.equal(ui.matchingPresetId({ ...defaults, ...gentle, 'yt.comments.hideAll': true }, presets), null);
    // settings a preset never touches (theme, pause details) do not break the match
    assert.equal(ui.matchingPresetId({ ...defaults, ...gentle, 'general.theme': 'dark', 'pause.breathSeconds': 12 }, presets), 'gentle');
  });
});

describe('your week', () => {
  const NOW = new Date(2026, 9, 4, 15, 30).getTime(); // Sunday 4 Oct 2026, local

  test('seven days ending today, missing days are zeros, totals add up', () => {
    const stats = {
      '2026-10-04': { youtube: { activeSec: 600, opens: 3, turnedBack: 1, continued: 2, blockedHits: 0 } },
      '2026-10-02': { youtube: { activeSec: 1800, opens: 5, turnedBack: 2, continued: 3, blockedHits: 0 }, 'reddit.com': { activeSec: 99, opens: 9, turnedBack: 9, continued: 0, blockedHits: 0 } },
      '2026-09-27': { youtube: { activeSec: 9999, opens: 9, turnedBack: 9, continued: 0, blockedHits: 0 } }, // 7 days back: outside
    };
    const week = ui.weekStats(stats, 'youtube', NOW);
    assert.equal(week.days.length, 7);
    assert.deepEqual(week.days.map((d) => d.day), ['2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04']);
    assert.equal(week.days.at(-1).label, 'Today');
    assert.equal(week.days.at(-1).isToday, true);
    assert.equal(week.days[0].label, 'Mon');
    assert.deepEqual(week.totals, { activeSec: 2400, opens: 8, turnedBack: 3 });
    assert.equal(week.maxActiveSec, 1800);
    assert.equal(week.hasData, true);
    assert.equal(week.days[3].activeSec, 0);
  });

  test('no data at all is reported as such', () => {
    for (const stats of [undefined, null, {}, 'junk', { '2026-10-04': { youtube: { activeSec: 0, opens: 0 } } }]) {
      const week = ui.weekStats(stats, 'youtube', NOW);
      assert.equal(week.hasData, false);
      assert.equal(week.days.length, 7);
      assert.equal(week.maxActiveSec, 0);
    }
  });

  test('garbage counters are treated as zero, other sites are ignored', () => {
    const week = ui.weekStats({ '2026-10-04': { youtube: { activeSec: -5, opens: 'x', turnedBack: 2 } } }, 'youtube', NOW);
    assert.equal(week.days.at(-1).activeSec, 0);
    assert.equal(week.days.at(-1).opens, 0);
    assert.equal(week.totals.turnedBack, 2);
  });

  test('a daylight-saving change cannot repeat or skip a day', () => {
    const now = new Date(2026, 2, 30, 12).getTime(); // the day after the EU spring change
    const days = ui.weekStats({}, 'youtube', now).days.map((d) => d.day);
    assert.equal(new Set(days).size, 7);
  });

  test('statusFromStorage builds a GET_STATUS-shaped answer', () => {
    const state = AP.state.normalizeState({
      block: { until: NOW + 60_000, reason: 'focus', siteKeys: ['youtube'] },
      sessions: { youtube: NOW + 1000, 'old.com': NOW - 1000 },
      scheduleOverride: 'focused',
    });
    const stats = AP.state.normalizeStats({ '2026-10-04': { youtube: { activeSec: 60, opens: 1 } } });
    const status = ui.statusFromStorage(state, stats, NOW);
    assert.equal(status.ok, true);
    assert.equal(status.block.reason, 'focus');
    assert.deepEqual(Object.keys(status.sessions), ['youtube']);
    assert.equal(status.today.youtube.activeSec, 60);
    assert.equal(status.scheduleOverride, 'focused');
    // an expired block is no block
    const expired = ui.statusFromStorage(AP.state.normalizeState({ block: { until: NOW - 1, reason: 'focus', siteKeys: [] } }), {}, NOW);
    assert.equal(expired.block, null);
  });
});

describe('import report', () => {
  const base = { ok: true, applied: 12, dropped: [], invalid: [], presets: { added: 0, replaced: 0, dropped: [] }, fromVersion: 1, newerThanThisVersion: false };

  test('a clean import is a single calm line', () => {
    assert.deepEqual(ui.formatImportReport(base), { tone: 'ok', headline: 'Imported 12 settings.', lines: [] });
    assert.equal(ui.formatImportReport({ ...base, applied: 1 }).headline, 'Imported 1 setting.');
  });

  test('presets added and replaced are mentioned, and do not make it a warning', () => {
    const r = ui.formatImportReport({ ...base, presets: { added: 2, replaced: 1, dropped: [] } });
    assert.equal(r.tone, 'ok');
    assert.deepEqual(r.lines, ['Presets: 2 added, 1 replaced.']);
  });

  test('skipped and kept settings are grouped by reason and trimmed to a preview', () => {
    const r = ui.formatImportReport({
      ...base,
      dropped: [
        { key: 'a.one', reason: 'unknown setting' },
        { key: 'a.two', reason: 'unknown setting' },
        { key: 'a.three', reason: 'unknown setting' },
        { key: 'a.four', reason: 'unknown setting' },
        { key: 'a.five', reason: 'unknown setting' },
        { key: 'advanced.lock', reason: 'cannot be imported' },
      ],
      invalid: [{ key: 'pause.breathSeconds', reason: 'value not allowed for this setting' }],
      presets: { added: 0, replaced: 0, dropped: ['Odd one'] },
      newerThanThisVersion: true,
    });
    assert.equal(r.tone, 'warn');
    assert.equal(r.headline, 'Imported 12 settings.');
    assert.ok(r.lines.includes('5 settings skipped (unknown setting): a.one, a.two, a.three, a.four and 1 more.'));
    assert.ok(r.lines.includes('1 setting skipped (cannot be imported): advanced.lock.'));
    assert.ok(r.lines.includes('1 setting kept as before (value not allowed for this setting): pause.breathSeconds.'));
    assert.ok(r.lines.includes('1 preset skipped: Odd one.'));
    assert.ok(r.lines.some((l) => /newer version/.test(l)));
  });

  test('failures say why in plain words', () => {
    for (const [error, pattern] of [
      ['invalid-json', /not valid JSON/],
      ['too-large', /too large/],
      ['not-an-export', /not an At Peace backup/],
      ['something-else', /could not be read/],
    ]) {
      const r = ui.formatImportReport({ ...base, ok: false, error });
      assert.equal(r.tone, 'error');
      assert.equal(r.headline, 'Nothing was imported.');
      assert.match(r.lines[0], pattern);
    }
    assert.equal(ui.formatImportReport(null).tone, 'error');
  });

  test('works on a report from the real importAll()', async () => {
    const report = await AP.settings.importAll({ app: 'at-peace', schemaVersion: 1, settings: { 'general.enabled': false, 'nope.nothing': 1, 'pause.breathSeconds': 'x' } });
    const r = ui.formatImportReport(report);
    assert.equal(r.tone, 'warn');
    assert.equal(r.headline, 'Imported 1 setting.');
    assert.equal(r.lines.length, 2);
  });
});

describe('ending a focus block', () => {
  test('the phrase matches ignoring case, punctuation and spacing', () => {
    assert.equal(ui.phraseMatches('I am choosing to end my focus session'), true);
    assert.equal(ui.phraseMatches('  i AM choosing   to end my focus session. '), true);
    assert.equal(ui.phraseMatches('I am choosing to end my focus'), false);
    assert.equal(ui.phraseMatches(''), false);
    assert.equal(ui.phraseMatches('...'), false);
  });
});
