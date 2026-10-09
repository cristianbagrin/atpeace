// The pure helpers behind the Dial re-skin (src/pages/common/logic.js): the sixty-tick dial and its
// amber arc, how much of a block is left, and the counts beside each section of the options navigation.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadAtPeace, installFakeBrowser, uninstallFakeBrowser, CORE_SCRIPTS, SCHEMA_SCRIPTS } from './_load.mjs';

let AP;
let ui;

beforeEach(async () => {
  installFakeBrowser();
  AP = await loadAtPeace([...CORE_SCRIPTS, ...SCHEMA_SCRIPTS]);
  await import(new URL(`../../src/pages/common/logic.js?t=${Math.random()}`, import.meta.url).href);
  ui = AP.ui;
});

afterEach(() => uninstallFakeBrowser());

describe('the dial', () => {
  test('sixty ticks, every fifth one longer', () => {
    const d = ui.dialTicksPath();
    const ticks = d.match(/M[\d.]+ [\d.]+L[\d.]+ [\d.]+/g);
    assert.equal(ticks.length, 60);
    const length = (t) => {
      const [x1, y1, x2, y2] = t.match(/[\d.]+/g).map(Number);
      return Math.hypot(x2 - x1, y2 - y1);
    };
    const lengths = ticks.map(length);
    ticks.forEach((_, i) => assert.ok(Math.abs(lengths[i] - (i % 5 === 0 ? 14 : 7)) < 0.2, `tick ${i} is ${lengths[i]} long`));
    assert.match(ticks[0], /^M160\.0 20\.0L160\.0 6\.0$/, 'the first tick is at twelve o\'clock, pointing outwards');
  });

  test('the amber arc runs clockwise from twelve o\'clock and takes the large-arc flag past half', () => {
    assert.equal(ui.dialArcPath(0), '');
    assert.equal(ui.dialArcPath(0.001), '');
    assert.equal(ui.dialArcPath(NaN), '');
    assert.match(ui.dialArcPath(0.25), /^M160 36 A124 124 0 0 1 284\.0 160\.0$/); // a quarter turn ends at three o'clock
    assert.match(ui.dialArcPath(0.75), /^M160 36 A124 124 0 1 1 36\.0 160\.0$/); // three quarters ends at nine o'clock
  });

  test('a full block is clamped so the arc never collapses into a point', () => {
    const full = ui.dialArcPath(1);
    assert.match(full, /^M160 36 A124 124 0 1 1 /);
    assert.equal(full, ui.dialArcPath(5));
  });
});

describe('blockFraction', () => {
  test('is what is left of the block as first seen, never above one', () => {
    assert.equal(ui.blockFraction(25 * 60_000, 25 * 60_000), 1);
    assert.equal(ui.blockFraction(25 * 60_000, 5 * 60_000), 0.2);
    assert.equal(ui.blockFraction(10 * 60_000, 15 * 60_000), 1, 'a block that was extended counts as full');
    assert.equal(ui.blockFraction(0, 1000), 0);
    assert.equal(ui.blockFraction(1000, 0), 0);
    assert.equal(ui.blockFraction(1000, -5), 0);
  });
});

describe('navCounts (the numbers beside the options navigation)', () => {
  const youtube = () => AP.schema.sections().filter((s) => s.site === 'youtube');

  test('every YouTube section reports how many of its settings are doing something', () => {
    const counts = ui.navCounts(AP.settings.merge({}));
    for (const s of youtube()) assert.deepEqual([counts[s.id].on, counts[s.id].text], [0, '0'], s.id);
  });

  test('a toggle counts when it is on, a select when it differs from its default', () => {
    const toggle = AP.schema.bySection('yt.comments').find((d) => d.type === 'toggle');
    const select = AP.schema.bySection('yt.general').find((d) => d.type === 'select');
    const none = ui.navCounts(AP.settings.merge({}));
    const some = ui.navCounts(AP.settings.merge({ [toggle.id]: true, [select.id]: select.options.at(-1).value }));
    assert.equal(some['yt.comments'].on, none['yt.comments'].on + 1);
    assert.equal(some['yt.general'].on, none['yt.general'].on + 1);
    assert.equal(some['yt.comments'].text, String(some['yt.comments'].on));
    // a select left at its default does not count
    assert.equal(ui.navCounts(AP.settings.merge({ [select.id]: select.default }))['yt.general'].on, none['yt.general'].on);
  });

  test('the total is the number of counted settings (numbers, free text and "applies to" checkboxes only tune, they are not counted)', () => {
    const counts = ui.navCounts(AP.settings.merge({}));
    for (const s of youtube()) {
      const counted = AP.schema.bySection(s.id).filter((d) => d.type === 'toggle' || d.type === 'select' || ui.isStringList(d));
      assert.equal(counts[s.id].total, counted.length, s.id);
    }
  });

  test('Mindful Pause says "On" while it is switched on and nothing otherwise; other sections have no count', () => {
    assert.equal(ui.navCounts(AP.settings.merge({ 'pause.enabled': true })).pause.text, 'On');
    assert.equal(ui.navCounts(AP.settings.merge({ 'pause.enabled': false })).pause.text, '');
    const counts = ui.navCounts(AP.settings.merge({}));
    for (const id of ['general', 'focus', 'advanced']) assert.equal(counts[id], undefined, id);
  });

  test('missing values count as nothing', () => {
    assert.doesNotThrow(() => ui.navCounts(undefined));
    assert.equal(ui.navCounts({})['yt.comments'].on, 0);
  });
});
