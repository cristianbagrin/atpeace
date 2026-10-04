// Options page and popup in REAL Firefox (headless, Selenium + geckodriver). Firefox is the product
// (Zen), so this proves what the Chromium specs (tests/e2e/options.spec.mjs, popup.spec.mjs) can
// only suggest: native controls styled with appearance:none, <dialog>, storage and messages with
// the real background. Prerequisite: bash tests/firefox/setup.sh.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { By, Key } from 'selenium-webdriver';
import { launchFirefox, extUrl, ROOT } from './_harness.mjs';

const SHOTS = join(ROOT, 'tests', 'e2e', 'artifacts', 'ui');
const OPTIONS = extUrl('src/pages/options/options.html');
const POPUP = extUrl('src/pages/popup/popup.html');

let ff;
let driver;

before(async () => {
  mkdirSync(SHOTS, { recursive: true });
  ff = await launchFirefox();
  driver = ff.driver;
  await driver.manage().window().setRect({ width: 1280, height: 900 });
});

after(async () => {
  await ff?.close();
});

// --- helpers -----------------------------------------------------------------------------------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Polls `fn` until it returns something truthy. */
async function until(what, fn, timeout = 10_000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (err) {
      last = err;
    }
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${what}${last instanceof Error ? `: ${last.message}` : ''}`);
}

const css = (selector) => driver.findElement(By.css(selector));
const run = (fn, ...args) => driver.executeScript(fn, ...args);
const settings = async () => (await ff.getStorage('settings')).settings ?? {};

async function shot(name) {
  writeFileSync(join(SHOTS, `firefox-${name}.png`), await driver.takeScreenshot(), 'base64');
}

async function open(url) {
  // The page we are leaving may still be reading storage after the last change; navigating away in
  // the middle makes Firefox log "Promise resolved after context unloaded": harmless, but noise here.
  await sleep(500);
  const before = (await ff.ourScriptErrors()).length;
  await driver.get(url);
  await until('the page to be ready', () => run(() => document.body.dataset.ready === 'true' || document.querySelector('#content:not([aria-busy])') !== null));
  await sleep(200);
  return before;
}

const newErrors = async (since) => (await ff.ourScriptErrors()).slice(since);

// --- options -----------------------------------------------------------------------------------

test('options: builds from the registry in Firefox, one working row per setting, no script errors', async () => {
  await ff.setStorage({ settings: {} });
  const since = await open(OPTIONS);
  const result = await run(() => {
    const AP = globalThis.AtPeace;
    const ids = AP.schema.all().map((d) => d.id);
    document.getElementById('show-advanced').click();
    return {
      ids: ids.length,
      rows: document.querySelectorAll('.row[data-id]').length,
      // a custom editor may start as just an "Add" button
      noControl: ids.filter((id) => !document.querySelector(`.row[data-id="${id}"] :is(input, select, textarea, button)`)),
      toc: [...document.querySelectorAll('#toc a')].length,
      h1: document.querySelector('h1').textContent,
    };
  });
  assert.ok(result.ids >= 100);
  assert.equal(result.rows, result.ids);
  assert.deepEqual(result.noControl, []);
  assert.ok(result.toc >= 10);
  assert.equal(result.h1, 'At Peace');
  await run(() => document.getElementById('show-advanced').click()); // back to the default view
  await shot('options-top-light');
  assert.deepEqual(await newErrors(since), []);
});

test('options: a toggle, a select, a number and a word list save to storage; a bad value is explained, not saved', async () => {
  await ff.setStorage({ settings: {} });
  const since = await open(OPTIONS);
  const ids = await run(() => {
    const AP = globalThis.AtPeace;
    return {
      toggle: AP.schema.byTag('shorts').find((d) => d.type === 'toggle' && !d.requires).id,
      list: AP.schema.all().find((d) => d.id.startsWith('yt.filters.') && d.type === 'list' && !d.options).id,
    };
  });

  // toggle: click the label, anywhere on the row works
  await css(`.row[data-id="${ids.toggle}"] .row-label`).click();
  await until('the toggle to be stored', async () => (await settings())[ids.toggle] === true);
  await until('"Saved"', () => run(() => document.querySelector('.saved').classList.contains('is-visible')));

  // select: Appearance → dark restyles the page at once
  await run(() => {
    const select = document.querySelector('.row[data-id="general.theme"] select');
    select.value = 'dark';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await until('dark theme', async () => (await settings())['general.theme'] === 'dark' && (await run(() => document.documentElement.dataset.theme)) === 'dark');
  assert.equal(await run(() => getComputedStyle(document.body).backgroundColor), 'rgb(20, 22, 43)');
  await shot('options-top-dark');

  // number: out of range is explained and not stored; a good number is stored
  await css('.row[data-id="pause.enabled"] .row-label').click();
  await until('pause.enabled', async () => (await settings())['pause.enabled'] === true);
  const number = css('.row[data-id="pause.breathSeconds"] input[type="number"]');
  await number.clear();
  await number.sendKeys('2');
  await css('h1').click(); // leave the field
  await until('the range message', () => run(() => /from 3 to 30/.test(document.querySelector('.row[data-id="pause.breathSeconds"] .row-error')?.textContent ?? '')));
  await sleep(600);
  assert.equal((await settings())['pause.breathSeconds'], undefined);
  await number.clear();
  await number.sendKeys('11');
  await css('h1').click();
  await until('breath seconds stored', async () => (await settings())['pause.breathSeconds'] === 11);

  // word list with a broken regex line, then a good one
  const area = css(`.row[data-id="${ids.list}"] textarea`);
  await area.sendKeys('spoiler', Key.ENTER, '/(/');
  await until('the regex error', () => run((id) => /Line 2: Not a valid regular expression/.test(document.querySelector(`.row[data-id="${id}"] .field-error`)?.textContent ?? ''), ids.list));
  await sleep(900);
  assert.equal((await settings())[ids.list], undefined);
  await area.clear();
  await area.sendKeys('spoiler', Key.ENTER, '/colou?r/i');
  await css('h1').click();
  await until('the word list stored', async () => JSON.stringify((await settings())[ids.list]) === '["spoiler","/colou?r/i"]');
  await shot('options-filters-dark');
  assert.deepEqual(await newErrors(since), []);
});

test('options: search, "/" and Escape, bulk chip', async () => {
  await ff.setStorage({ settings: {} });
  const since = await open(OPTIONS);
  const total = await run(() => [...document.querySelectorAll('.row')].filter((r) => r.offsetParent !== null).length);

  await css('body').sendKeys('/');
  assert.equal(await run(() => document.activeElement.id), 'search');
  await css('#search').sendKeys('shorts');
  await until('results', () => run(() => !document.getElementById('results-note').hidden));
  const matches = await run(() => [...document.querySelectorAll('.row')].filter((r) => r.offsetParent !== null).length);
  assert.ok(matches >= 3 && matches < total, `${matches} of ${total}`);
  assert.match(await css('#results-note').getText(), /settings? match “shorts”/);
  await shot('options-search-light');
  await css('#search').sendKeys(Key.ESCAPE);
  await until('search cleared', () => run(() => document.getElementById('search').value === '' && document.getElementById('results-note').hidden));

  const targets = await run(() => globalThis.AtPeace.schema.bulkTargets('shorts'));
  await css('.chip[aria-pressed]').click(); // the first chip is Shorts
  await until('every Shorts setting stored', async () => {
    const s = await settings();
    return Object.entries(targets).every(([id, v]) => s[id] === v);
  });
  assert.equal(await css('.chip').getAttribute('data-state'), 'all');
  assert.deepEqual(await newErrors(since), []);
});

test('options: presets dialog applies a preset; backup reset and import round-trip', async () => {
  await ff.setStorage({ settings: {}, customPresets: [] });
  const since = await open(OPTIONS);
  const expected = await run(() => globalThis.AtPeace.presets.valuesFor('focused'));

  const presetsButton = await driver.findElement(By.xpath('//header[@id="topbar"]//button[contains(., "Presets")]'));
  await presetsButton.click();
  await until('the dialog', () => run(() => document.querySelector('dialog[open]') !== null));
  await shot('options-presets-light');
  await driver.findElement(By.xpath('//dialog[@open]//li[contains(@class,"preset")][.//p[starts-with(normalize-space(), "Focused")]]//button[normalize-space()="Apply"]')).click();
  await until('the confirmation', () => run(() => /Apply Focused\?/.test(document.querySelector('dialog[open]')?.textContent ?? '')));
  await css('dialog[open] button[value="confirm"]').click();
  await until('the preset values stored', async () => {
    const s = await settings();
    return Object.entries(expected).every(([id, v]) => JSON.stringify(s[id]) === JSON.stringify(v));
  });

  // Save it as a custom preset, then reset and import the exported settings back.
  const before = await settings();
  const exported = await run(() => globalThis.AtPeace.settings.exportAll());
  await run(() => document.getElementById('sec-backup').scrollIntoView());
  await driver.findElement(By.xpath('//section[@id="sec-backup"]//button[normalize-space()="Reset…"]')).click();
  await until('the reset dialog', () => run(() => document.querySelector('dialog[open]') !== null));
  await css('dialog[open] button[value="confirm"]').click();
  await until('settings reset', async () => Object.keys(await settings()).length === 0);
  await shot('options-backup-light');

  const file = join(SHOTS, 'firefox-backup.json');
  writeFileSync(file, JSON.stringify(exported));
  await run(() => document.querySelector('.backup input[type="file"]').classList.remove('visually-hidden'));
  await css('.backup input[type="file"]').sendKeys(file);
  await until('the import dialog', () => run(() => /replaces your current settings/.test(document.querySelector('dialog[open]')?.textContent ?? '')));
  await css('dialog[open] button[value="confirm"]').click();
  await until('settings restored', async () => JSON.stringify(await settings()) === JSON.stringify(before));
  assert.match(await css('.report-head').getText(), /^Imported \d+ settings?\.$/);
  assert.deepEqual(await newErrors(since), []);
});

test('options: deep link to an advanced setting reveals and highlights it', async () => {
  await ff.setStorage({ settings: {} });
  const id = await (async () => {
    await open(OPTIONS);
    return run(() => globalThis.AtPeace.schema.all().find((d) => d.advanced).id);
  })();
  const since = await open(`${OPTIONS}#setting=${id}`);
  await until('the row to be highlighted', () => run((key) => document.querySelector(`.row[data-id="${key}"]`)?.classList.contains('is-target'), id));
  assert.equal(await run((key) => document.querySelector(`.row[data-id="${key}"]`).offsetParent !== null, id), true);
  assert.equal(await css('#show-advanced').isSelected(), true);
  assert.deepEqual(await newErrors(since), []);
  await run(() => localStorage.removeItem('at-peace-show-advanced'));
});

// --- popup -------------------------------------------------------------------------------------

test('popup: renders quickly in Firefox with every quick setting, master switch and chips', async () => {
  await ff.setStorage({ settings: {}, stats: {} });
  const since = await open(POPUP);
  const info = await run(() => {
    const AP = globalThis.AtPeace;
    const quick = AP.ui.quickSettings().map((d) => d.id);
    return {
      quick,
      present: quick.filter((id) => document.querySelector(`.row[data-id="${id}"]`)),
      chips: [...document.querySelectorAll('.chip')].map((c) => c.textContent.trim()),
      render: performance.getEntriesByName('ap-popup-render')[0]?.duration,
      master: document.querySelector('#master input.switch')?.checked,
    };
  });
  assert.deepEqual(info.present, info.quick);
  assert.deepEqual(info.chips, ['Shorts', 'Recommendations', 'Comments']);
  assert.equal(info.master, true);
  assert.ok(info.render < 100, `popup.js took ${info.render} ms`);
  await shot('popup-light');
  assert.deepEqual(await newErrors(since), []);
});

test('popup: a quick toggle and the master switch change storage; keyboard focus is visible', async () => {
  await ff.setStorage({ settings: {} });
  const since = await open(POPUP);
  const id = await run(() => globalThis.AtPeace.ui.quickSettings().find((d) => d.type === 'toggle' && d.id.startsWith('yt.')).id);
  await css(`.row[data-id="${id}"] .row-label`).click();
  await until('the quick toggle stored', async () => (await settings())[id] === true);

  await css('#master input.switch').click();
  await until('master off', async () => (await settings())['general.enabled'] === false);
  assert.equal(await css('.master-state').getText(), 'Off');
  await css('#master input.switch').click();
  await until('master on', async () => (await settings())['general.enabled'] === true);

  // A fresh popup, Tab from the top: first the master switch, with a visible focus ring.
  await open(POPUP);
  await css('body').sendKeys(Key.TAB);
  const first = await run(() => {
    const el = document.activeElement;
    const cs = getComputedStyle(el);
    return { label: el.getAttribute('aria-label'), ring: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2 };
  });
  assert.equal(first.label, 'Turn At Peace on');
  assert.equal(first.ring, true);
  assert.deepEqual(await newErrors(since), []);
});

test('popup: Focus with the real background: start, count down, end early', async () => {
  await ff.setStorage({ settings: { 'focus.unlockFriction': 'none' } });
  const since = await open(POPUP);
  await driver.findElement(By.xpath('//div[contains(@class,"focus-buttons")]//button[normalize-space()="25 min"]')).click();
  await until('the countdown', () => run(() => /^2[45]:\d\d$/.test(document.querySelector('[data-role="clock"]')?.textContent ?? '')));
  const state = (await ff.getStorage('state')).state;
  assert.ok(state.block && state.block.until - Date.now() > 24 * 60_000);
  await shot('popup-focus-light');
  await driver.findElement(By.xpath('//button[normalize-space()="End early"]')).click();
  await until('idle again', () => run(() => document.querySelector('.focus-buttons') !== null));
  assert.equal((await ff.getStorage('state')).state.block, null);
  assert.deepEqual(await newErrors(since), []);
});

test('popup: dark theme in Firefox', async () => {
  await ff.setStorage({ settings: { 'general.theme': 'dark' } });
  await open(POPUP);
  assert.equal(await run(() => document.documentElement.dataset.theme), 'dark');
  await shot('popup-dark');
  await ff.setStorage({ settings: {} });
});
