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
import { fixturesAvailable, startFixtureServer } from '../e2e/_yt-fixture.mjs';
import { until } from '../helpers/wait.mjs';

const SHOTS = join(ROOT, 'tests', 'e2e', 'artifacts', 'round1', '7a');
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
  await until(() => run(() => document.body.dataset.ready === 'true' || document.querySelector('#content:not([aria-busy])') !== null), { what: 'the page to be ready', retryErrors: true });
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
  await until(async () => (await settings())[ids.toggle] === true, { what: 'the toggle to be stored', retryErrors: true });
  await until(() => run(() => document.querySelector('.saved').classList.contains('is-visible')), { what: '"Saved"', retryErrors: true });

  // select: Appearance → dark restyles the page at once
  await run(() => {
    const select = document.querySelector('.row[data-id="general.theme"] select');
    select.value = 'dark';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await until(async () => (await settings())['general.theme'] === 'dark' && (await run(() => document.documentElement.dataset.theme)) === 'dark', { what: 'dark theme', retryErrors: true });
  assert.equal(await run(() => getComputedStyle(document.body).backgroundColor), 'rgb(14, 16, 51)');
  await shot('options-top-dark');

  // number: out of range is explained and not stored; a good number is stored
  await css('.row[data-id="pause.enabled"] .row-label').click();
  await until(async () => (await settings())['pause.enabled'] === true, { what: 'pause.enabled', retryErrors: true });
  const number = css('.row[data-id="pause.breathSeconds"] input[type="number"]');
  await number.clear();
  await number.sendKeys('2');
  await css('h1').click(); // leave the field
  await until(() => run(() => /from 3 to 30/.test(document.querySelector('.row[data-id="pause.breathSeconds"] .row-error')?.textContent ?? '')), { what: 'the range message', retryErrors: true });
  await sleep(600);
  assert.equal((await settings())['pause.breathSeconds'], undefined);
  await number.clear();
  await number.sendKeys('11');
  await css('h1').click();
  await until(async () => (await settings())['pause.breathSeconds'] === 11, { what: 'breath seconds stored', retryErrors: true });

  // word list with a broken regex line, then a good one
  const area = css(`.row[data-id="${ids.list}"] textarea`);
  await area.sendKeys('spoiler', Key.ENTER, '/(/');
  await until(() => run((id) => /Line 2: Not a valid regular expression/.test(document.querySelector(`.row[data-id="${id}"] .field-error`)?.textContent ?? ''), ids.list), { what: 'the regex error', retryErrors: true });
  await sleep(900);
  assert.equal((await settings())[ids.list], undefined);
  await area.clear();
  await area.sendKeys('spoiler', Key.ENTER, '/colou?r/i');
  await css('h1').click();
  await until(async () => JSON.stringify((await settings())[ids.list]) === '["spoiler","/colou?r/i"]', { what: 'the word list stored', retryErrors: true });
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
  await until(() => run(() => !document.getElementById('results-note').hidden), { what: 'results', retryErrors: true });
  const matches = await run(() => [...document.querySelectorAll('.row')].filter((r) => r.offsetParent !== null).length);
  assert.ok(matches >= 3 && matches < total, `${matches} of ${total}`);
  assert.match(await css('#results-note').getText(), /^\d+ matches?$/);
  await shot('options-search-light');
  await css('#search').sendKeys(Key.ESCAPE);
  await until(() => run(() => document.getElementById('search').value === '' && document.getElementById('results-note').hidden), { what: 'search cleared', retryErrors: true });

  const targets = await run(() => globalThis.AtPeace.schema.bulkTargets('shorts'));
  await css('.chip[aria-pressed]').click(); // the first chip is Shorts
  await until(async () => {
    const s = await settings();
    return Object.entries(targets).every(([id, v]) => s[id] === v);
  }, { what: 'every Shorts setting stored', retryErrors: true });
  assert.equal(await css('.chip').getAttribute('data-state'), 'all');
  assert.deepEqual(await newErrors(since), []);
});

test('options: the Presets section applies, saves, updates, renames and deletes (with undo); backup reset and import round-trip', async () => {
  await ff.setStorage({ settings: {}, customPresets: [] });
  const since = await open(OPTIONS);
  const expected = await run(() => globalThis.AtPeace.presets.valuesFor('focused'));
  const presetRow = (name) => `//section[@id="sec-presets"]//div[contains(concat(" ", normalize-space(@class), " "), " preset ")][.//p[starts-with(normalize-space(), "${name}")]]`;

  await run(() => document.getElementById('sec-presets').scrollIntoView());
  await shot('options-presets-light');
  // Nothing set is "Untouched": moving to Focused loses nothing, so there is no question.
  await driver.findElement(By.xpath(`${presetRow('Focused')}//button[normalize-space()="Apply"]`)).click();
  await until(async () => {
    const s = await settings();
    return Object.entries(expected).every(([id, v]) => JSON.stringify(s[id]) === JSON.stringify(v));
  }, { what: 'the preset values stored', retryErrors: true });
  await until(() => run(() => document.querySelector('#sec-presets .preset.is-current .preset-name')?.textContent.startsWith('Focused')), { what: 'Focused marked in use', retryErrors: true });

  // New preset from the current settings: an inline field.
  await driver.findElement(By.xpath('//section[@id="sec-presets"]//button[normalize-space()="New preset from current settings"]')).click();
  await css('#sec-presets .preset-form input[type="text"]').sendKeys('Evening', Key.ENTER);
  await until(async () => ((await ff.getStorage('customPresets')).customPresets ?? []).length === 1, { what: 'the preset saved', retryErrors: true });
  const [saved] = (await ff.getStorage('customPresets')).customPresets;
  assert.equal(saved.name, 'Evening');

  // Change a setting, update the preset from it, rename it, delete it and undo.
  await ff.setStorage({ settings: { ...(await settings()), 'yt.general.grayscale': true } });
  await until(() => run(() => !document.querySelector('#sec-presets .preset.is-current')), { what: 'no preset in use after a change', retryErrors: true });
  await driver.findElement(By.xpath(`${presetRow('Evening')}//button[normalize-space()="Update from current"]`)).click();
  await until(async () => (await ff.getStorage('customPresets')).customPresets[0].values['yt.general.grayscale'] === true, { what: 'the preset updated', retryErrors: true });
  await driver.findElement(By.xpath(`${presetRow('Evening')}//button[normalize-space()="Rename"]`)).click();
  const renameField = css('#sec-presets .preset-form input[type="text"]');
  await renameField.clear();
  await renameField.sendKeys('Wind-down', Key.ENTER);
  await until(async () => (await ff.getStorage('customPresets')).customPresets[0].name === 'Wind-down', { what: 'the preset renamed', retryErrors: true });
  await driver.findElement(By.xpath(`${presetRow('Wind-down')}//button[normalize-space()="Delete"]`)).click();
  await until(async () => ((await ff.getStorage('customPresets')).customPresets ?? []).length === 0, { what: 'the preset deleted', retryErrors: true });
  await shot('options-presets-undo-light');
  await driver.findElement(By.xpath('//section[@id="sec-presets"]//div[contains(@class,"undo")]//button[normalize-space()="Undo"]')).click();
  await until(async () => (await ff.getStorage('customPresets')).customPresets?.[0]?.id === saved.id, { what: 'the preset back with its id', retryErrors: true });

  // Reset and import the exported settings back.
  const before = await settings();
  const exported = await run(() => globalThis.AtPeace.settings.exportAll());
  await run(() => document.getElementById('sec-backup').scrollIntoView());
  await driver.findElement(By.xpath('//section[@id="sec-backup"]//button[normalize-space()="Reset…"]')).click();
  await until(() => run(() => document.querySelector('dialog[open]') !== null), { what: 'the reset dialog', retryErrors: true });
  await css('dialog[open] button[value="confirm"]').click();
  await until(async () => Object.keys(await settings()).length === 0, { what: 'settings reset', retryErrors: true });
  await shot('options-backup-light');

  const file = join(SHOTS, 'firefox-backup.json');
  writeFileSync(file, JSON.stringify(exported));
  await run(() => document.querySelector('.backup input[type="file"]').classList.remove('visually-hidden'));
  await css('.backup input[type="file"]').sendKeys(file);
  await until(() => run(() => /Replaces your settings/.test(document.querySelector('dialog[open]')?.textContent ?? '')), { what: 'the import dialog', retryErrors: true });
  await css('dialog[open] button[value="confirm"]').click();
  await until(async () => JSON.stringify(await settings()) === JSON.stringify(before), { what: 'settings restored', retryErrors: true });
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
  await until(() => run((key) => document.querySelector(`.row[data-id="${key}"]`)?.classList.contains('is-target'), id), { what: 'the row to be highlighted', retryErrors: true });
  assert.equal(await run((key) => document.querySelector(`.row[data-id="${key}"]`).offsetParent !== null, id), true);
  assert.equal(await css('#show-advanced').isSelected(), true);
  assert.deepEqual(await newErrors(since), []);
  await run(() => localStorage.removeItem('at-peace-show-advanced'));
});

// --- popup -------------------------------------------------------------------------------------

const row = (id) => `.row[data-id="${id}"]`;
const sectionsShown = () => run(() => [...document.querySelectorAll('.grp')].filter((g) => !g.hidden).map((g) => g.dataset.section));

test('popup: renders quickly in Firefox with the master switch, three tabs, groups and the footer', async () => {
  await ff.setStorage({ settings: {}, stats: {} });
  await run(() => localStorage.clear());
  const since = await open(POPUP);
  const info = await run(() => ({
    tabs: [...document.querySelectorAll('[role="tab"]')].map((t) => t.textContent.trim()),
    selected: document.querySelector('[role="tab"][aria-selected="true"]')?.textContent.trim(),
    chips: document.querySelectorAll('.chip').length,
    render: performance.getEntriesByName('ap-popup-render')[0]?.duration,
    master: document.querySelector('#master input.switch')?.checked,
    footer: [...document.querySelectorAll('#foot button, #foot select')].map((el) => (el.localName === 'select' ? el.id : el.textContent.trim())),
    tall: document.documentElement.getBoundingClientRect().height,
    wide: document.documentElement.getBoundingClientRect().width,
  }));
  assert.deepEqual(info.tabs, ['This page', 'All', 'Focus']);
  assert.equal(info.selected, 'All', 'the tab itself is not a YouTube page');
  assert.equal(info.chips, 0);
  assert.equal(info.master, true);
  assert.ok(info.render < 100, `popup.js took ${info.render} ms`);
  assert.deepEqual(info.footer, ['preset-select', 'Hide an element', 'Settings']);
  assert.ok(info.tall <= 600, `${info.tall} px tall`);
  assert.equal(info.wide, 380);
  await shot('popup-all-light');
  await driver.findElement(By.xpath('//button[@role="tab"][normalize-space()="This page"]')).click();
  assert.equal(await css('.view-note').getText(), 'Open YouTube to see its settings.');
  await shot('popup-this-page-off-youtube-light');
  assert.deepEqual(await newErrors(since), []);
});

test('popup: a toggle, a number and a select from the popup change storage; the master switch too; focus is visible; All search narrows, Esc clears', async () => {
  await ff.setStorage({ settings: {} });
  await run(() => localStorage.clear());
  const since = await open(POPUP);
  await css(`${row('yt.general.grayscale')} .row-label`).click();
  await until(async () => (await settings())['yt.general.grayscale'] === true, { what: 'the toggle stored', retryErrors: true });

  await css('#master input.switch').click();
  await until(async () => (await settings())['general.enabled'] === false, { what: 'master off', retryErrors: true });
  assert.equal(await css('.master-state').getText(), 'Off');
  await css('#master input.switch').click();
  await until(async () => (await settings())['general.enabled'] === true, { what: 'master on', retryErrors: true });

  // search
  await css('input[type="search"]').sendKeys('comments');
  await until(async () => (await sectionsShown()).length <= 3, { what: 'the search to narrow the groups', retryErrors: true });
  assert.ok((await sectionsShown()).includes('yt.comments'));
  await css('input[type="search"]').sendKeys(Key.ESCAPE);
  await until(async () => (await sectionsShown()).length >= 10 && (await css('input[type="search"]').getAttribute('value')) === '', { what: 'the search cleared', retryErrors: true });

  // Focus tab: the breath is a number, "keep open for" a select
  await driver.findElement(By.xpath('//button[@role="tab"][normalize-space()="Focus"]')).click();
  await css(`${row('pause.enabled')} .row-label`).click();
  await until(async () => (await settings())['pause.enabled'] === true, { what: 'pause on', retryErrors: true });
  const breath = css(`${row('pause.breathSeconds')} input`);
  await breath.clear();
  await breath.sendKeys('8');
  await css('h1').click();
  await until(async () => (await settings())['pause.breathSeconds'] === 8, { what: 'breath stored', retryErrors: true });
  await run(() => {
    const select = document.querySelector('.row[data-id="pause.sessionMinutes"] select');
    select.value = '30';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await until(async () => (await settings())['pause.sessionMinutes'] === '30', { what: 'session minutes stored', retryErrors: true });

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

test('popup: presets, in Firefox: save as new with an inline field, apply, update; the confirmation only for a hand-made mix', async () => {
  await ff.setStorage({ settings: { 'yt.general.grayscale': true }, customPresets: [] });
  await run(() => localStorage.clear());
  const since = await open(POPUP);
  const select = async (value) =>
    run((v) => {
      const el = document.getElementById('preset-select');
      el.value = v;
      el.dispatchEvent(new Event('change', { bubbles: true }));
    }, value);

  await select('::new');
  await css('#sheet input[type="text"]').sendKeys('Evening', Key.ENTER);
  await until(async () => ((await ff.getStorage('customPresets')).customPresets ?? []).length === 1, { what: 'the preset saved', retryErrors: true });
  const [saved] = (await ff.getStorage('customPresets')).customPresets;
  assert.deepEqual(saved.values, { 'yt.general.grayscale': true });
  await until(() => run((id) => document.getElementById('preset-select').value === id, saved.id), { what: 'the new preset selected', retryErrors: true });
  await shot('popup-preset-saved-light');

  await css(`${row('yt.general.hideAds')} .row-label`).click();
  await until(() => run(() => document.getElementById('preset-select').value === ''), { what: 'a changed mix', retryErrors: true });
  assert.equal(await run(() => document.querySelector('#preset-select option[value="::update"]')?.textContent), 'Update “Evening”');
  await select('::update');
  await until(async () => (await ff.getStorage('customPresets')).customPresets[0].values['yt.general.hideAds'] === true, { what: 'the preset updated', retryErrors: true });

  // a hand-made mix is replaced only after the question
  await css(`${row('yt.general.hideAds')} .row-label`).click();
  await until(() => run(() => document.getElementById('preset-select').value === ''), { what: 'a changed mix again', retryErrors: true });
  await select('focused');
  await until(() => run(() => !document.getElementById('sheet').hidden), { what: 'the question', retryErrors: true });
  await shot('popup-preset-confirm-light');
  await driver.findElement(By.xpath('//div[@id="sheet"]//button[normalize-space()="Apply"]')).click();
  await until(async () => (await settings())['yt.home.feedMode'] === 'hide', { what: 'Focused applied', retryErrors: true });
  assert.deepEqual(await newErrors(since), []);
});

test('popup: Focus with the real background: start, count down, end early', async () => {
  await ff.setStorage({ settings: { 'focus.unlockFriction': 'none' } });
  await run(() => localStorage.clear());
  const since = await open(POPUP);
  await driver.findElement(By.xpath('//button[@role="tab"][normalize-space()="Focus"]')).click();
  await driver.findElement(By.xpath('//div[contains(@class,"focus-buttons")]//button[normalize-space()="25 min"]')).click();
  await until(() => run(() => /^2[45]:\d\d$/.test(document.querySelector('[data-role="clock"]')?.textContent ?? '')), { what: 'the countdown', retryErrors: true });
  const state = (await ff.getStorage('state')).state;
  assert.ok(state.block && state.block.until - Date.now() > 24 * 60_000);
  await shot('popup-focus-running-light');
  await driver.findElement(By.xpath('//button[normalize-space()="End early"]')).click();
  await until(() => run(() => document.querySelector('.focus-buttons') !== null), { what: 'idle again', retryErrors: true });
  assert.equal((await ff.getStorage('state')).state.block, null);
  await shot('popup-focus-light');
  assert.deepEqual(await newErrors(since), []);
});

test('popup: Edit follows the settings tab that is open (Firefox shows an extension its own tabs), at the row, without a second tab', async () => {
  await ff.setStorage({ settings: {} });
  await run(() => localStorage.clear());
  await open(OPTIONS);
  const optionsHandle = await driver.getWindowHandle();
  await driver.switchTo().newWindow('tab');
  const popupHandle = await driver.getWindowHandle();
  await open(POPUP);
  await css('.grp[data-section="yt.filters"] .grp-head').click();
  const tabsBefore = (await driver.getAllWindowHandles()).length;
  await css(`${row('yt.filters.keywords')} button.edit`).click();
  // The popup would close itself; in a tab it stays, and the settings tab has moved to the row.
  await driver.switchTo().window(optionsHandle);
  await until(() => run(() => location.hash === '#setting=yt.filters.keywords'), { what: 'the settings tab to follow', retryErrors: true });
  await until(() => run(() => document.querySelector('.row[data-id="yt.filters.keywords"]')?.classList.contains('is-target')), { what: 'the row highlighted', retryErrors: true });
  assert.ok((await driver.getAllWindowHandles()).length <= tabsBefore, 'no second settings tab');
  await shot('options-at-row-from-popup');
  // The popup closes itself after "Edit" (it is a tab here, so Firefox lets it).
  assert.equal((await driver.getAllWindowHandles()).includes(popupHandle), false, 'the popup closed itself');
});

test('popup: dark theme in Firefox', async () => {
  await ff.setStorage({ settings: { 'general.theme': 'dark' } });
  await open(POPUP);
  assert.equal(await run(() => document.documentElement.dataset.theme), 'dark');
  await shot('popup-all-dark');
  await driver.findElement(By.xpath('//button[@role="tab"][normalize-space()="Focus"]')).click();
  await shot('popup-focus-dark');
  await ff.setStorage({ settings: {} });
  await run(() => localStorage.clear());
});

// --- popup over a YouTube page (a second browser: www.youtube.com resolves to the local fixture server) ----

const HAVE_FIXTURES = fixturesAvailable(['home', 'watch-chapters']);

test('popup: "This page" follows the YouTube tab in the same window, and a toggle reaches that tab live', { skip: HAVE_FIXTURES ? false : 'research snapshots are absent (tests/e2e/artifacts/research is local only)' }, async () => {
  const server = await startFixtureServer();
  const yt = await launchFirefox({
    prefs: {
      'network.dns.localDomains': 'www.youtube.com',
      'network.proxy.no_proxies_on': 'localhost, 127.0.0.1, www.youtube.com',
      'network.stricttransportsecurity.preloadlist': false, // youtube.com is HSTS-preloaded: keep our local http page http
    },
  });
  try {
    const d = yt.driver;
    const runIn = (fn, ...args) => d.executeScript(fn, ...args);
    await yt.setStorage({ settings: {} });
    // The YouTube tab, the active one of this window.
    await d.get(`${server.origin}/watch?v=abc`);
    await until(() => runIn(() => document.documentElement.hasAttribute('data-at-peace-page')), { what: 'the engine on the YouTube page', retryErrors: true, timeout: 20_000 });
    const ytHandle = await d.getWindowHandle();
    const ytPageTokens = () => runIn(() => (document.documentElement.getAttribute('data-at-peace') ?? '').split(' ').filter(Boolean));

    // The popup page opens as a BACKGROUND tab of this window, made from an extension page in another window, so that
    // the YouTube tab is the active one when the popup asks which page it is on (a real popup opens over the active tab).
    await d.switchTo().newWindow('window');
    await d.get(extUrl('src/pages/options/options.html'));
    await until(() => runIn(() => document.body.dataset.ready === 'true'), { what: 'the helper page', retryErrors: true });
    const before = new Set(await d.getAllWindowHandles());
    const made = await d.executeAsyncScript(async (popupUrl, done) => {
      try {
        const [tab] = await browser.tabs.query({ url: '*://www.youtube.com/*' });
        await browser.tabs.create({ windowId: tab.windowId, url: popupUrl, active: false });
        done({ ok: true });
      } catch (e) {
        done({ error: String(e) });
      }
    }, POPUP);
    assert.deepEqual(made, { ok: true });
    await sleep(1500); // the background tab loads and reads its window's active tab
    const popupHandle = [...(await d.getAllWindowHandles())].find((h) => !before.has(h));
    assert.ok(popupHandle, 'the popup tab exists');
    await d.switchTo().window(popupHandle);
    await until(() => runIn(() => document.querySelector('#content:not([aria-busy])') !== null && document.querySelector('.grp') !== null), { what: 'the popup', retryErrors: true });
    assert.equal(await runIn(() => document.querySelector('[role="tab"][aria-selected="true"]').textContent.trim()), 'This page');
    assert.deepEqual(await runIn(() => [...document.querySelectorAll('.grp')].map((g) => g.dataset.section)), ['yt.watch', 'yt.player', 'yt.comments', 'yt.general']);
    writeFileSync(join(SHOTS, 'firefox-popup-this-page-watch-light.png'), await d.takeScreenshot(), 'base64');

    await d.findElement(By.css('.row[data-id="yt.watch.hideRelated"] .row-label')).click();
    await d.switchTo().window(ytHandle);
    await until(async () => (await ytPageTokens()).includes('yt.watch.hideRelated'), { what: 'the token on the YouTube tab, live', retryErrors: true, timeout: 10_000 });
    await d.switchTo().window(popupHandle);
    await d.findElement(By.css('#master input.switch')).click();
    await d.switchTo().window(ytHandle);
    await until(async () => (await ytPageTokens()).length === 0, { what: 'no tokens with At Peace off', retryErrors: true, timeout: 10_000 });
    assert.deepEqual(await yt.ourScriptErrors(), []);
  } finally {
    await yt.close();
    await server.close();
  }
});
