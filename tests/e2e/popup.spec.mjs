// Popup E2E in Chromium: three tabs (This page · All · Focus), every setting from the popup, the
// YouTube tab following live, "Edit" rows that open the settings page at the row, presets (save, apply,
// update), focus blocks against the real background, Mac shortcuts in the tooltips, degraded states,
// keyboard-only use, and light + dark screenshots (tests/e2e/artifacts/round1/7a/).
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, close, getContext, extUrl, trackErrors, setStorage, getStorage, evalInExtension, ARTIFACTS } from './harness.mjs';
import { fixturesAvailable, installYouTubeFixtures } from './_yt-fixture.mjs';
import { pageUntil, until } from '../helpers/wait.mjs';

const SHOTS = join(ARTIFACTS, 'round1', '7a');
const POPUP = 'src/pages/popup/popup.html';
const FRICTION_PHRASE = 'I am choosing to end my focus session';
const HAVE_FIXTURES = fixturesAvailable(['home', 'search-lofi', 'watch-chapters']);

before(async () => {
  mkdirSync(SHOTS, { recursive: true });
  await launch();
});

after(async () => {
  await close();
});

beforeEach(async () => {
  await evalInExtension(() => {
    localStorage.clear(); // the popup's own memory (last tab, open groups, "Show advanced") is shared by every test
    return chrome.storage.local.clear();
  });
  // Let the background settle after the wipe before the next test starts writing.
  await new Promise((resolve) => setTimeout(resolve, 150));
});

/**
 * Opens the popup as a tab (380 px wide, like the real one). Options:
 *   stubs      message type → the response the page gets instead of the background's ({ reject: 'text' } throws)
 *   activeUrl  the address of "the active tab" (chrome.tabs.query is answered with it); without it the popup's own tab is active
 *   os         what runtime.getPlatformInfo() says
 *   commands   what commands.getAll() says ({ name: shortcut })
 *   urlTabs    what tabs.query({ url }) answers (Firefox shows an extension its own tabs' addresses; Chromium hides them)
 * Every message the popup sends is collected in `window.__sent`; every tab the popup asks for is in `window.__tabs`.
 */
async function openPopup({ seed, stubs = {}, init, clock = false, activeUrl, os, commands, urlTabs, height = 800 } = {}) {
  if (seed) await setStorage(seed);
  const page = trackErrors(await getContext().newPage());
  await page.setViewportSize({ width: 380, height });
  if (clock) await page.clock.install();
  await page.addInitScript(
    (config) => {
      window.__sent = [];
      window.__tabs = [];
      const real = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = async (message) => {
        window.__sent.push(message);
        const stub = config.stubs[message.type];
        if (stub === undefined) return real(message);
        if (stub.reject) throw new Error(stub.reject);
        return stub;
      };
      if (config.activeUrl) {
        const query = chrome.tabs.query.bind(chrome.tabs);
        chrome.tabs.query = async (q) => (q?.active && q?.currentWindow ? [{ id: 4242, url: config.activeUrl, active: true }] : query(q));
      }
      if (config.urlTabs) {
        const query = chrome.tabs.query.bind(chrome.tabs);
        chrome.tabs.query = async (q) => (q?.url ? config.urlTabs : query(q));
      }
      if (config.os) chrome.runtime.getPlatformInfo = async () => ({ os: config.os, arch: 'x86-64' });
      if (config.commands) chrome.commands.getAll = async () => Object.entries(config.commands).map(([name, shortcut]) => ({ name, shortcut, description: name }));
    },
    { stubs, activeUrl, os, commands, urlTabs },
  );
  if (init) await page.addInitScript(init);
  await page.goto(extUrl(POPUP));
  await page.waitForSelector('#content:not([aria-busy])');
  return page;
}

/**
 * Clicks a control whose handler closes the page (the popup's footer buttons call window.close()). Playwright's
 * click() still has bookkeeping to do after the click lands, and when the page is already gone it rejects with
 * "Target page, context or browser has been closed": the very thing the click was meant to cause, and a race
 * that only shows when the machine is busy. Anything else still fails the test.
 */
async function clickThatClosesThePage(locator) {
  try {
    await locator.click();
  } catch (err) {
    if (!/(target|page|context|browser).*closed/i.test(String(err?.message))) throw err;
  }
}

const settings = async () => (await getStorage('settings')).settings ?? {};
const row = (page, id) => page.locator(`.row[data-id="${id}"]`);
const group = (page, section) => page.locator(`.grp[data-section="${section}"]`);
const openGroup = async (page, section) => {
  const head = group(page, section).locator('.grp-head');
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click();
};
const tab = (page, name) => page.getByRole('tab', { name, exact: true });
const sections = (page) => page.locator('.grp').evaluateAll((els) => els.filter((e) => !e.hidden).map((e) => e.dataset.section));
const sent = (page, type) => page.evaluate((t) => window.__sent.filter((m) => m.type === t), type);
const customPresets = async () => (await getStorage('customPresets')).customPresets ?? [];
const todayKey = () => {
  const day = new Date();
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`;
};

async function endBlocks() {
  await evalInExtension(() => chrome.storage.local.remove('state'));
}

// ---------------------------------------------------------------------------------------------
// The shell
// ---------------------------------------------------------------------------------------------

test('renders fast: well under 100 ms of script time, no console errors', async () => {
  const page = await openPopup();
  const times = await page.evaluate(() => ({
    render: performance.getEntriesByName('ap-popup-render')[0].duration,
    ready: performance.getEntriesByName('ap-popup-ready')[0].startTime,
  }));
  assert.ok(times.render < 100, `popup.js took ${times.render} ms`);
  // From navigation start (parsing 30 small scripts included) the first full render is still quick.
  assert.ok(times.ready < 600, `ready after ${times.ready} ms`);
  assert.equal(await page.locator('h1').textContent(), 'At Peace');
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('the shell: the master switch, the tabs This page · All · Focus, and a footer with the preset menu, "Hide an element" and "Settings"', async () => {
  const page = await openPopup();
  assert.equal(await page.locator('#master input.switch').getAttribute('aria-label'), 'Turn At Peace on');
  assert.equal(await page.locator('#master input.switch').isChecked(), true);
  assert.deepEqual(await page.getByRole('tab').allTextContents(), ['This page', 'All', 'Focus']);
  assert.equal(await page.getByRole('tablist').getAttribute('aria-label'), 'Settings');
  assert.equal(await page.locator('.chip, .chips').count(), 0, 'the bulk Shorts / Recommendations / Comments control is gone');
  assert.equal(await page.locator('#preset-select').inputValue(), 'untouched');
  assert.equal(await page.getByRole('button', { name: 'Hide an element' }).count(), 1);
  assert.equal(await page.getByRole('button', { name: 'Settings', exact: true }).count(), 1);
  assert.equal(await page.getByRole('button', { name: 'All settings' }).count(), 0);
  assert.equal(await page.locator('#foot').evaluate((el) => getComputedStyle(el).position !== 'fixed' && el.getBoundingClientRect().bottom <= window.innerHeight), true);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('off YouTube: "This page" says so in one line and shows All below it; All is the first tab', async () => {
  const page = await openPopup(); // the popup's own tab is the active one: not YouTube
  assert.equal(await tab(page, 'All').getAttribute('aria-selected'), 'true', 'off YouTube the first tab is All');
  await tab(page, 'This page').click();
  assert.equal(await page.locator('.view-note').textContent(), 'Open YouTube to see its settings.');
  assert.ok((await sections(page)).includes('yt.general'), 'the All content is below the line');
  assert.equal(await page.locator('input[type="search"]').count(), 1);
  assert.deepEqual(page.errors, []);
  await page.close();
});

// ---------------------------------------------------------------------------------------------
// This page
// ---------------------------------------------------------------------------------------------

const PAGES = [
  ['a watch page', 'https://www.youtube.com/watch?v=abc123', ['yt.watch', 'yt.player', 'yt.comments', 'yt.general']],
  ['the home page', 'https://www.youtube.com/', ['yt.home', 'yt.general', 'yt.masthead', 'yt.guide']],
  ['search results', 'https://www.youtube.com/results?search_query=lofi', ['yt.search', 'yt.general', 'yt.masthead']],
  ['a Short', 'https://www.youtube.com/shorts/xyz', ['yt.shorts', 'yt.comments']],
  ['a channel', 'https://www.youtube.com/@someone/videos', ['yt.channel', 'yt.general']],
  ['the subscriptions feed', 'https://www.youtube.com/feed/subscriptions', ['yt.subs', 'yt.general']],
  ['a playlist', 'https://www.youtube.com/playlist?list=PL1', ['yt.general', 'yt.masthead', 'yt.guide']],
];

for (const [name, activeUrl, expected] of PAGES) {
  test(`This page on ${name}: ${expected.join(', ')}; the first group is open`, async () => {
    const page = await openPopup({ activeUrl });
    assert.equal(await tab(page, 'This page').getAttribute('aria-selected'), 'true', 'on YouTube the first tab is This page');
    assert.deepEqual(await sections(page), expected);
    assert.equal(await page.locator('.view-note').count(), 0);
    assert.equal(await page.locator('input[type="search"]').count(), 0, 'no search here: it is on All');
    assert.equal(await group(page, expected[0]).locator('.grp-head').getAttribute('aria-expanded'), 'true');
    for (const other of expected.slice(1)) assert.equal(await group(page, other).locator('.grp-head').getAttribute('aria-expanded'), 'false', other);
    assert.ok((await group(page, expected[0]).locator('.row').count()) >= 3);
    assert.deepEqual(page.errors, []);
    await page.close();
  });
}

test('the last tab is remembered per kind of page', async () => {
  const watch = await openPopup({ activeUrl: 'https://www.youtube.com/watch?v=abc' });
  await tab(watch, 'Focus').click();
  await watch.close();

  const again = await openPopup({ activeUrl: 'https://www.youtube.com/watch?v=def' });
  assert.equal(await tab(again, 'Focus').getAttribute('aria-selected'), 'true', 'another watch page: Focus again');
  await again.close();

  const home = await openPopup({ activeUrl: 'https://www.youtube.com/' });
  assert.equal(await tab(home, 'This page').getAttribute('aria-selected'), 'true', 'the home page has its own memory');
  await tab(home, 'All').click();
  await home.close();

  const homeAgain = await openPopup({ activeUrl: 'https://www.youtube.com/' });
  assert.equal(await tab(homeAgain, 'All').getAttribute('aria-selected'), 'true');
  await homeAgain.close();
  const watchAgain = await openPopup({ activeUrl: 'https://www.youtube.com/watch?v=ghi' });
  assert.equal(await tab(watchAgain, 'Focus').getAttribute('aria-selected'), 'true', 'unchanged by the home page');
  await watchAgain.close();
});

test('which groups were open is remembered too', async () => {
  const page = await openPopup({ activeUrl: 'https://www.youtube.com/watch?v=abc' });
  await openGroup(page, 'yt.player');
  await group(page, 'yt.watch').locator('.grp-head').click();
  await page.close();
  const again = await openPopup({ activeUrl: 'https://www.youtube.com/watch?v=abc' });
  assert.equal(await group(again, 'yt.player').locator('.grp-head').getAttribute('aria-expanded'), 'true');
  assert.equal(await group(again, 'yt.watch').locator('.grp-head').getAttribute('aria-expanded'), 'false');
  await again.close();
});

// ---------------------------------------------------------------------------------------------
// All
// ---------------------------------------------------------------------------------------------

test('All: every YouTube section is a group, the first open; the header says how many are hidden; General and Filters are there', async () => {
  const page = await openPopup();
  const registry = await page.evaluate(() => globalThis.AtPeace.schema.sections({ site: 'youtube' }).filter((s) => s.site === 'youtube').map((s) => s.id));
  assert.deepEqual((await sections(page)).slice(0, -1), registry);
  assert.equal((await sections(page)).at(-1), 'general');
  assert.ok(registry.includes('yt.filters'));
  const heads = page.locator('.grp-head');
  assert.equal(await heads.first().getAttribute('aria-expanded'), 'true');
  assert.equal(await heads.nth(1).getAttribute('aria-expanded'), 'false');
  assert.equal(await group(page, 'yt.general').locator('.grp-count').textContent(), '0 hidden');

  // What is set shows in the header count.
  await setStorage({ settings: { 'yt.general.grayscale': true, 'yt.general.hideAds': true, 'yt.comments.hideAll': true } });
  await page.waitForFunction(() => document.querySelector('.grp[data-section="yt.general"] .grp-count').textContent === '2 hidden');
  assert.equal(await group(page, 'yt.comments').locator('.grp-count').textContent(), '1 hidden');
  assert.equal(await group(page, 'general').locator('.grp-count').textContent(), '', 'General has no count');
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('All: rows are the settings of the section: a switch for a toggle, a select for a choice, a number for a number, "Edit" for the rest', async () => {
  const page = await openPopup();
  for (const section of ['yt.home', 'yt.filters', 'general']) await openGroup(page, section);
  const kinds = await page.evaluate(() => {
    const AP = globalThis.AtPeace;
    return AP.schema.all().filter((d) => document.querySelector(`.row[data-id="${d.id}"]`)).map((d) => ({ id: d.id, type: d.type, advanced: Boolean(d.advanced), hidden: document.querySelector(`.row[data-id="${d.id}"]`).hidden }));
  });
  assert.ok(kinds.length >= 12);
  for (const { id, type, advanced, hidden } of kinds) {
    if (advanced) assert.equal(hidden, true, `${id} is advanced: hidden until "Show advanced"`);
    const el = row(page, id);
    if (type === 'toggle') assert.equal(await el.locator('input.switch').count(), 1, id);
    else if (type === 'select') assert.equal(await el.locator('select').count(), 1, id);
    else if (type === 'number') assert.equal(await el.locator('input[type="number"]').count(), 1, id);
    else assert.equal(await el.getByRole('button', { name: /^Edit / }).count(), 1, `${id} (${type}) is an Edit row`);
  }
  // the ones the brief names
  for (const id of ['yt.filters.keywords', 'yt.filters.channels', 'advanced.customRules', 'advanced.lock']) assert.equal(await row(page, id).getByRole('button', { name: /^Edit / }).count(), 1, id);
  assert.equal(await row(page, 'backup').getByRole('button', { name: 'Edit Backup & reset' }).count(), 1);
  assert.equal(await row(page, 'general.theme').locator('select').count(), 1);
  assert.equal(await row(page, 'general.enabled').count(), 0, 'the master switch is in the header, not repeated');
  await page.close();
});

test('All: a toggle and a select save to storage; the master switch dims the settings', async () => {
  const page = await openPopup();
  await row(page, 'yt.general.grayscale').locator('.row-label').click();
  await pageUntil(page, async () => (await chrome.storage.local.get('settings')).settings?.['yt.general.grayscale'] === true);
  assert.equal(await row(page, 'yt.general.grayscale').locator('input.switch').isChecked(), true);

  await openGroup(page, 'yt.home');
  const value = await page.evaluate(() => globalThis.AtPeace.schema.get('yt.home.feedMode').options.at(1).value);
  await row(page, 'yt.home.feedMode').locator('select').selectOption(value);
  await pageUntil(page, async (v) => (await chrome.storage.local.get('settings')).settings?.['yt.home.feedMode'] === v, value);

  await page.locator('#master input.switch').click();
  await pageUntil(page, async () => (await chrome.storage.local.get('settings')).settings?.['general.enabled'] === false);
  assert.equal(await page.locator('.master-state').textContent(), 'Off');
  assert.equal(await page.evaluate(() => document.body.dataset.master), 'off');
  await page.locator('#master input.switch').click();
  await pageUntil(page, async () => (await chrome.storage.local.get('settings')).settings?.['general.enabled'] === true);
  assert.equal(await page.locator('.master-state').textContent(), 'On');
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('All: a setting that waits for another is greyed out until it is on (the home redirect… and the breath on Focus)', async () => {
  const page = await openPopup();
  await tab(page, 'Focus').click();
  const breath = row(page, 'pause.breathSeconds');
  assert.equal(await breath.locator('input').isDisabled(), true, 'the breath waits for the pause switch');
  assert.equal(await breath.evaluate((el) => el.classList.contains('is-disabled')), true);
  await row(page, 'pause.enabled').locator('.row-label').click();
  await pageUntil(page, async () => (await chrome.storage.local.get('settings')).settings?.['pause.enabled'] === true);
  assert.equal(await breath.locator('input').isDisabled(), false);
  await page.close();
});

test('All: search narrows the groups by label, opens what matches, Esc clears it', async () => {
  const page = await openPopup();
  const search = page.locator('input[type="search"]');
  await search.fill('comments');
  await page.waitForFunction(() => document.querySelectorAll('.grp:not([hidden])').length <= 3);
  const shown = await sections(page);
  assert.ok(shown.includes('yt.comments'), 'a section title finds its settings');
  assert.ok(shown.length < 6);
  assert.equal(await group(page, 'yt.comments').locator('.grp-head').getAttribute('aria-expanded'), 'true', 'matches are shown open');
  const hits = await page.evaluate(() => [...document.querySelectorAll('.row')].filter((r) => !r.hidden && r.offsetParent !== null).map((r) => r.textContent.toLowerCase()));
  assert.ok(hits.length >= 2);

  await search.fill('zzzzqq');
  assert.deepEqual(await sections(page), []);
  assert.match(await page.locator('.empty').textContent(), /Nothing matches “zzzzqq”/);

  await search.fill('view counts');
  assert.ok((await sections(page)).includes('yt.general'));
  assert.equal(await row(page, 'yt.general.hideViewCounts').isVisible(), true);

  await search.press('Escape');
  assert.equal(await search.inputValue(), '');
  assert.equal(await page.locator('.empty').isHidden(), true);
  assert.ok((await sections(page)).length >= 10, 'every group is back');
  assert.equal(await group(page, 'yt.comments').locator('.grp-head').getAttribute('aria-expanded'), 'false', 'folded again as it was');
  assert.equal(page.isClosed(), false);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('All: "Show advanced" at the bottom reveals advanced settings (the same flag as the settings page) and a search finds them anyway', async () => {
  const page = await openPopup();
  const advanced = await page.evaluate(() => globalThis.AtPeace.schema.all().filter((d) => d.advanced && d.section.startsWith('yt.')).map((d) => ({ id: d.id, section: d.section, label: d.label })));
  assert.ok(advanced.length > 0);
  const { id, section, label } = advanced[0];
  await openGroup(page, section);
  assert.equal(await row(page, id).isHidden(), true);
  const toggle = page.locator('.advanced-row input.switch');
  assert.equal(await toggle.isChecked(), false);
  await toggle.check();
  assert.equal(await row(page, id).isVisible(), true);
  assert.equal(await page.evaluate(() => localStorage.getItem('at-peace-show-advanced')), '1', 'the settings page reads the same flag');
  await toggle.uncheck();
  assert.equal(await row(page, id).isHidden(), true);
  await page.locator('input[type="search"]').fill(label);
  assert.equal(await row(page, id).isVisible(), true, 'a search finds it without the switch');
  await page.close();
});

test('settings changed elsewhere (the options page, a preset) update the open popup', async () => {
  const page = await openPopup();
  await setStorage({ settings: { 'yt.general.grayscale': true } });
  await page.waitForFunction(() => document.querySelector('.row[data-id="yt.general.grayscale"] input.switch').checked);
  await setStorage({ settings: { 'general.enabled': false } });
  await page.waitForFunction(() => document.body.dataset.master === 'off');
  await page.close();
});

// ---------------------------------------------------------------------------------------------
// Live on a YouTube tab
// ---------------------------------------------------------------------------------------------

test('toggling a setting in the popup changes the YouTube tab at once, without a reload; the master switch empties its tokens', { skip: !HAVE_FIXTURES && 'research snapshots are absent' }, async () => {
  await installYouTubeFixtures(getContext());
  const yt = trackErrors(await getContext().newPage());
  await yt.goto('https://www.youtube.com/watch?v=abc', { waitUntil: 'domcontentloaded' });
  await yt.waitForFunction(() => document.documentElement.getAttribute('data-at-peace-loaded') === '1', null, { timeout: 20_000 });
  const tokens = () => yt.evaluate(() => (document.documentElement.getAttribute('data-at-peace') ?? '').split(' ').filter(Boolean));
  const navigations = [];
  yt.on('framenavigated', (frame) => frame === yt.mainFrame() && navigations.push(frame.url()));

  const popup = await openPopup({ activeUrl: yt.url() });
  assert.equal(await tab(popup, 'This page').getAttribute('aria-selected'), 'true');
  assert.deepEqual((await sections(popup))[0], 'yt.watch', 'the watch page: its own settings first');
  const related = row(popup, 'yt.watch.hideRelated');
  assert.ok(!(await tokens()).includes('yt.watch.hideRelated'));

  await related.locator('.row-label').click();
  await yt.waitForFunction(() => document.documentElement.getAttribute('data-at-peace')?.split(' ').includes('yt.watch.hideRelated'), null, { timeout: 10_000 });
  assert.equal((await settings())['yt.watch.hideRelated'], true);

  // A setting from another group of the tab, then one from All: the same.
  await openGroup(popup, 'yt.general');
  await row(popup, 'yt.general.grayscale').locator('.row-label').click();
  await yt.waitForFunction(() => document.documentElement.getAttribute('data-at-peace')?.split(' ').includes('yt.general.grayscale'), null, { timeout: 10_000 });
  await tab(popup, 'All').click();
  await row(popup, 'yt.general.grayscale').locator('.row-label').click();
  await yt.waitForFunction(() => !document.documentElement.getAttribute('data-at-peace')?.split(' ').includes('yt.general.grayscale'), null, { timeout: 10_000 });

  // Switching At Peace off removes every token (YouTube untouched) ...
  await popup.locator('#master input.switch').click();
  await yt.waitForFunction(() => !document.documentElement.getAttribute('data-at-peace'), null, { timeout: 10_000 });
  assert.deepEqual(await tokens(), []);
  // ... and on again brings them back.
  await popup.locator('#master input.switch').click();
  await yt.waitForFunction(() => document.documentElement.getAttribute('data-at-peace')?.split(' ').includes('yt.watch.hideRelated'), null, { timeout: 10_000 });
  assert.deepEqual(navigations, [], 'the YouTube tab was not reloaded');
  assert.deepEqual(popup.errors, []);
  await popup.close();
  await yt.close();
});

// ---------------------------------------------------------------------------------------------
// "Edit" rows open the settings page at the row
// ---------------------------------------------------------------------------------------------

const optionsTabs = () => getContext().pages().filter((p) => p.url().includes('/src/pages/options/options.html'));

test('Edit opens the settings page at the row and the popup closes', async () => {
  // Chromium hides the address of an extension's own tabs, so a settings tab is made; Firefox reuses an open one
  // (tests/firefox/ui.mjs checks that). Either way the row is where the person lands.
  const page = await openPopup();
  await openGroup(page, 'yt.filters');
  const closed = page.waitForEvent('close', { timeout: 5000 });
  await Promise.all([closed, clickThatClosesThePage(row(page, 'yt.filters.keywords').getByRole('button', { name: 'Edit Words to hide' }))]);
  const options = await until(() => optionsTabs().find((p) => p.url().endsWith('#setting=yt.filters.keywords')), { what: 'a settings tab at the row' });
  await options.waitForSelector('body[data-ready="true"]');
  await options.waitForFunction(() => document.querySelector('.row[data-id="yt.filters.keywords"]')?.classList.contains('is-target'));
  assert.equal(await options.evaluate(() => location.hash), '#setting=yt.filters.keywords');
  await options.close();
});

test('Edit follows a settings tab that is already open (where the browser shows its address): the tab is reused and its #hash changes', async () => {
  const existing = trackErrors(await getContext().newPage());
  await existing.goto(extUrl('src/pages/options/options.html'));
  await existing.waitForSelector('body[data-ready="true"]');
  const tabInfo = await existing.evaluate(async () => {
    const { id, windowId } = await chrome.tabs.getCurrent();
    return { id, windowId, url: location.href };
  });
  const before = optionsTabs().length;
  const page = await openPopup({ urlTabs: [tabInfo] }); // what Firefox answers to tabs.query({ url })
  await openGroup(page, 'yt.filters');
  const closed = page.waitForEvent('close', { timeout: 5000 });
  await Promise.all([closed, clickThatClosesThePage(row(page, 'yt.filters.channels').getByRole('button', { name: 'Edit Channels to hide' }))]);
  await until(() => existing.url().endsWith('#setting=yt.filters.channels'), { what: 'the open settings tab to follow' });
  await existing.waitForFunction(() => document.querySelector('.row[data-id="yt.filters.channels"]')?.classList.contains('is-target'));
  assert.equal(optionsTabs().length, before, 'no second settings tab');
  assert.deepEqual(existing.errors, []);
  await existing.close();
});

test('Edit with no settings tab open creates one at the row; Backup & reset goes to its section', async () => {
  const page = await openPopup({
    init: () => {
      window.__created = [];
      chrome.tabs.query = async () => [];
      chrome.tabs.create = async (props) => {
        window.__created.push(props.url);
        console.log(`test:created ${props.url}`);
      };
      window.close = () => {};
    },
  });
  await openGroup(page, 'general');
  await row(page, 'advanced.lock').getByRole('button', { name: /^Edit / }).click();
  await row(page, 'backup').getByRole('button', { name: 'Edit Backup & reset' }).click();
  const created = await page.evaluate(() => window.__created);
  assert.equal(created.length, 2);
  assert.match(created[0], /^chrome-extension:\/\/[a-z]+\/src\/pages\/options\/options\.html#setting=advanced\.lock$/);
  assert.match(created[1], /#section=backup$/);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('Edit rows of the Focus tab: Pause sites and Schedules', async () => {
  const page = await openPopup({
    init: () => {
      window.__created = [];
      chrome.tabs.query = async () => [];
      chrome.tabs.create = async (props) => void window.__created.push(props.url);
      window.close = () => {};
    },
  });
  await tab(page, 'Focus').click();
  await row(page, 'pause.sites').getByRole('button', { name: 'Edit Pause sites' }).click();
  await row(page, 'focus.schedules').getByRole('button', { name: 'Edit Schedules' }).click();
  const created = await page.evaluate(() => window.__created);
  assert.deepEqual(created.map((u) => u.split('#')[1]), ['setting=pause.sites', 'setting=focus.schedules']);
  await page.close();
});

test('"Settings" in the footer opens the settings page; "Hide an element" asks the background and closes', async () => {
  // The helper tab of the test harness IS an options page, so Chromium would just focus it; watch the call instead.
  const page = await openPopup({
    init: () => {
      chrome.runtime.openOptionsPage = async () => {
        console.log('test:options-opened');
      };
    },
  });
  const logged = page.waitForEvent('console', { predicate: (m) => m.text() === 'test:options-opened', timeout: 5000 });
  const popupClosed = page.waitForEvent('close', { timeout: 5000 }); // the popup gets out of the way afterwards
  await Promise.all([logged, popupClosed, clickThatClosesThePage(page.getByRole('button', { name: 'Settings', exact: true }))]);

  // With a picker that says yes, the popup gets out of the way.
  const picking = await openPopup({ stubs: { START_PICKER: { ok: true } } });
  const closed = picking.waitForEvent('close', { timeout: 5000 });
  await Promise.all([closed, clickThatClosesThePage(picking.getByRole('button', { name: 'Hide an element' }))]);

  // Without a YouTube tab to pick in, it says so instead of silently doing nothing.
  const nothing = await openPopup({ stubs: { START_PICKER: { ok: false, error: 'no-picker' } } });
  await nothing.getByRole('button', { name: 'Hide an element' }).click();
  await nothing.locator('.note[role="status"]').filter({ hasText: 'YouTube page' }).waitFor();
  assert.equal(nothing.isClosed(), false);
  await nothing.close();
});

// ---------------------------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------------------------

test('the preset menu: built-in and saved presets, "Save as new preset…", and the one in use selected', async () => {
  const page = await openPopup({ seed: { customPresets: [{ id: 'preset_mine', name: 'Evening', values: { 'yt.general.grayscale': true }, createdAt: 1 }] } });
  const options = await page.locator('#preset-select option').evaluateAll((os) => os.map((o) => [o.value, o.textContent, o.parentElement.label ?? '']));
  assert.deepEqual(options, [
    ['gentle', 'Gentle', 'Built in'],
    ['focused', 'Focused', 'Built in'],
    ['deep-work', 'Deep work', 'Built in'],
    ['untouched', 'Untouched', 'Built in'],
    ['preset_mine', 'Evening', 'Yours'],
    ['::new', 'Save as new preset…', ''],
  ]);
  assert.equal(await page.locator('#preset-select').inputValue(), 'untouched');
  await setStorage({ settings: { 'yt.general.grayscale': true } });
  await page.waitForFunction(() => document.querySelector('#preset-select').value === 'preset_mine');
  await setStorage({ settings: { 'yt.general.grayscale': true, 'yt.comments.hideAll': true } });
  await page.waitForFunction(() => document.querySelector('#preset-select').value === '');
  assert.equal(await page.locator('#preset-select option[value=""]').textContent(), 'Your own mix');
  await page.close();
});

test('presets: save as new with an inline name field (no browser prompt), apply it, change something and update it', async () => {
  const page = await openPopup({ seed: { settings: { 'yt.general.grayscale': true, 'yt.shorts.mode': 'block' } } });
  let prompts = 0;
  page.on('dialog', (d) => {
    prompts++;
    d.dismiss();
  });
  assert.equal(await page.locator('#preset-select').inputValue(), '', 'a hand-made mix');
  assert.equal(await page.locator('#preset-select option[value="::update"]').count(), 0);

  await page.locator('#preset-select').selectOption('::new');
  const name = page.locator('#sheet input[type="text"]');
  await name.waitFor();
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Preset name');
  await name.press('Escape');
  assert.equal(await page.locator('#sheet').isHidden(), true, 'Escape cancels and the popup stays');
  assert.deepEqual(await customPresets(), []);

  await page.locator('#preset-select').selectOption('::new');
  await name.fill('   ');
  await name.press('Enter');
  assert.deepEqual(await customPresets(), [], 'a blank name saves nothing');
  await name.fill('Evening');
  await name.press('Enter');
  await pageUntil(page, async () => (await chrome.storage.local.get('customPresets')).customPresets?.length === 1);
  const [saved] = await customPresets();
  assert.equal(saved.name, 'Evening');
  assert.deepEqual(saved.values, { 'yt.general.grayscale': true, 'yt.shorts.mode': 'block' });
  assert.equal(await page.locator('#sheet').isHidden(), true);
  await page.waitForFunction((id) => document.querySelector('#preset-select').value === id, saved.id);

  // Change something: the menu offers to update the preset that was saved last.
  await row(page, 'yt.general.hideAds').locator('.row-label').click();
  await page.waitForFunction(() => document.querySelector('#preset-select').value === '');
  assert.equal(await page.locator('#preset-select option[value="::update"]').textContent(), 'Update “Evening”');
  await page.locator('#preset-select').selectOption('::update');
  await pageUntil(page, async () => (await chrome.storage.local.get('customPresets')).customPresets?.[0]?.values?.['yt.general.hideAds'] === true);
  assert.equal((await customPresets())[0].id, saved.id, 'the same preset, new values');
  await page.waitForFunction((id) => document.querySelector('#preset-select').value === id, saved.id);
  assert.equal(await page.locator('#preset-select option[value="::update"]').count(), 0, 'nothing left to update');
  assert.equal(prompts, 0, 'no window.prompt / confirm');
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('presets: choosing one asks only when it would replace a hand-made mix; applying a saved one is remembered for "Update"', async () => {
  const page = await openPopup({ seed: { settings: { 'yt.general.grayscale': true } } });
  const expected = await page.evaluate(() => globalThis.AtPeace.presets.valuesFor('focused'));
  await page.locator('#preset-select').selectOption('focused');
  const sheet = page.locator('#sheet');
  await sheet.waitFor({ state: 'visible' });
  assert.equal((await sheet.textContent()).trim().startsWith('Replace your settings with “Focused”?'), true);
  assert.deepEqual(await settings(), { 'yt.general.grayscale': true }, 'nothing changed yet');
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  assert.equal(await sheet.isHidden(), true);
  assert.equal(await page.locator('#preset-select').inputValue(), '');

  await page.locator('#preset-select').selectOption('focused');
  await sheet.getByRole('button', { name: 'Apply' }).click();
  await pageUntil(page, async (id) => (await chrome.storage.local.get('settings')).settings?.[id] !== undefined, Object.keys(expected)[0]);
  const stored = await settings();
  for (const [id, v] of Object.entries(expected)) assert.deepEqual(stored[id], v, id);
  assert.equal(stored['yt.general.grayscale'], undefined);
  await page.waitForFunction(() => document.querySelector('#preset-select').value === 'focused');

  // Now a preset is in use: moving to another loses nothing, so there is no question.
  await page.locator('#preset-select').selectOption('gentle');
  await page.waitForFunction(() => document.querySelector('#preset-select').value === 'gentle');
  assert.equal(await sheet.isHidden(), true);
  assert.deepEqual(page.errors, []);
  await page.close();
});

// ---------------------------------------------------------------------------------------------
// Focus
// ---------------------------------------------------------------------------------------------

test('Focus: block buttons, Mindful Pause (switch, breath, keep open for), Pause sites, Schedules, Daily limit', async () => {
  const page = await openPopup();
  await tab(page, 'Focus').click();
  assert.equal(await page.locator('h2:text-is("Block YouTube for")').count(), 1);
  assert.deepEqual(await page.locator('.focus-buttons .btn').allTextContents(), ['25 min', '1 h', '4 h', 'Rest of day']);
  assert.deepEqual(await page.locator('.ledger-title').allTextContents(), ['Mindful Pause', 'Limits']);
  assert.deepEqual(await page.locator('.ledger .row-label').allTextContents(), ['Pause before opening', 'Breath length', 'Keep open for', 'Pause sites', 'Schedules', 'Daily limit']);
  assert.equal(await row(page, 'pause.enabled').locator('input.switch').count(), 1);
  assert.equal(await row(page, 'pause.breathSeconds').locator('input[type="number"]').count(), 1);
  assert.equal(await row(page, 'pause.sessionMinutes').locator('select').count(), 1);
  assert.equal(await row(page, 'focus.dailyMinutes').locator('input[type="number"]').count(), 1);

  await row(page, 'pause.enabled').locator('.row-label').click();
  await pageUntil(page, async () => (await chrome.storage.local.get('settings')).settings?.['pause.enabled'] === true);
  await row(page, 'pause.breathSeconds').locator('input').fill('9');
  await row(page, 'pause.breathSeconds').locator('input').press('Tab');
  await pageUntil(page, async () => (await chrome.storage.local.get('settings')).settings?.['pause.breathSeconds'] === 9);
  await row(page, 'pause.sessionMinutes').locator('select').selectOption('30');
  await pageUntil(page, async () => (await chrome.storage.local.get('settings')).settings?.['pause.sessionMinutes'] === '30');
  await row(page, 'focus.dailyMinutes').locator('input').fill('90');
  await row(page, 'focus.dailyMinutes').locator('input').press('Tab');
  await pageUntil(page, async () => (await chrome.storage.local.get('settings')).settings?.['focus.dailyMinutes'] === 90);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('Focus: start a block from the popup, watch the countdown, end it early (no friction)', async () => {
  await setStorage({ settings: { 'focus.unlockFriction': 'none' } });
  const page = await openPopup();
  await tab(page, 'Focus').click();
  await page.getByRole('button', { name: '25 min' }).click();
  await page.waitForSelector('[data-role="clock"]');
  const clock = await page.locator('[data-role="clock"]').textContent();
  assert.match(clock, /^2[45]:\d\d$/); // 25:00 counting down
  assert.match(await page.locator('.count-until').textContent(), /^until \d/);
  const state = (await getStorage('state')).state;
  assert.ok(state.block && state.block.until - Date.now() > 24 * 60_000, 'the background stored the block');
  assert.equal(state.block.reason, 'focus');

  // it counts down
  const first = await page.locator('[data-role="clock"]').textContent();
  await page.waitForFunction((was) => document.querySelector('[data-role="clock"]').textContent !== was, first, { timeout: 5000 });

  await page.getByRole('button', { name: 'End early' }).click();
  await page.waitForSelector('.focus-buttons');
  assert.equal((await getStorage('state')).state.block, null);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('Focus: "Rest of day", "1 h" and "4 h" send the right message', async () => {
  const page = await openPopup({ stubs: { FOCUS_START: { ok: true, block: null } } });
  await tab(page, 'Focus').click();
  await page.getByRole('button', { name: 'Rest of day' }).click();
  await page.getByRole('button', { name: '1 h' }).click();
  await page.getByRole('button', { name: '4 h' }).click();
  const messages = await sent(page, 'FOCUS_START');
  assert.deepEqual(messages.map((m) => m.payload), [{ untilEndOfDay: true }, { minutes: 60 }, { minutes: 240 }]);
  await page.close();
});

test('Focus: ending early with "wait" friction counts 30 seconds before the button works', async () => {
  await setStorage({ settings: { 'focus.unlockFriction': 'wait' } });
  const page = await openPopup({ clock: true });
  await tab(page, 'Focus').click();
  await page.getByRole('button', { name: '25 min' }).click();
  await page.waitForSelector('[data-role="clock"]');
  await page.getByRole('button', { name: 'End early' }).click();

  const end = page.getByRole('button', { name: 'End block' });
  assert.equal(await end.isDisabled(), true);
  assert.match(await page.locator('[data-role="wait-note"]').textContent(), /in (30|29) s/);
  await page.clock.fastForward(12_000);
  assert.equal(await end.isDisabled(), true, 'still waiting after 12 s');
  assert.match(await page.locator('[data-role="wait-note"]').textContent(), /in (1\d|2\d) s/);

  await page.clock.fastForward(19_000);
  await page.waitForFunction(() => !document.querySelector('[data-role="end"]').disabled);
  assert.match(await page.locator('[data-role="wait-note"]').textContent(), /end the block now/);
  await end.click();
  await page.waitForSelector('.focus-buttons');
  assert.equal((await getStorage('state')).state.block, null);
  assert.deepEqual((await sent(page, 'FOCUS_END')).map((m) => m.payload), [{ frictionDone: true }]);
  await page.close();
});

test('Focus: "Keep going" abandons the wait and the block stays', async () => {
  await setStorage({ settings: { 'focus.unlockFriction': 'wait' } });
  const page = await openPopup();
  await tab(page, 'Focus').click();
  await page.getByRole('button', { name: '25 min' }).click();
  await page.getByRole('button', { name: 'End early' }).click();
  await page.getByRole('button', { name: 'Keep going' }).click();
  await page.getByRole('button', { name: 'End early' }).waitFor();
  assert.ok((await getStorage('state')).state.block);
  await endBlocks();
  await page.close();
});

test('Focus: ending early with "phrase" friction needs the sentence, typed', async () => {
  await setStorage({ settings: { 'focus.unlockFriction': 'phrase' } });
  const page = await openPopup();
  await tab(page, 'Focus').click();
  await page.getByRole('button', { name: '1 h' }).click();
  await page.getByRole('button', { name: 'End early' }).click();

  const input = page.getByRole('textbox');
  const end = page.getByRole('button', { name: 'End block' });
  await input.waitFor();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'phrase', 'the field is focused');
  assert.match(await page.locator('.friction .mono').textContent(), new RegExp(FRICTION_PHRASE));
  assert.equal(await end.isDisabled(), true);
  await input.fill('I am choosing to end my focus');
  assert.equal(await end.isDisabled(), true);
  await input.fill('i am choosing to END my focus session.');
  assert.equal(await end.isDisabled(), false);
  await input.press('Enter');
  await page.waitForSelector('.focus-buttons');
  assert.equal((await getStorage('state')).state.block, null);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('Focus: with "No early exit" there is no End button; the background refusing is explained too', async () => {
  await setStorage({ settings: { 'focus.strict': true } });
  const page = await openPopup();
  await tab(page, 'Focus').click();
  await page.getByRole('button', { name: '25 min' }).click();
  await page.waitForSelector('[data-role="clock"]');
  assert.equal(await page.getByRole('button', { name: 'End early' }).count(), 0);
  assert.match(await page.locator('.focus-block').textContent(), /No early exit/);
  await page.close();

  // A popup that still thinks it may end the block (stale settings): the background says "strict".
  const stale = await openPopup({ stubs: { FOCUS_END: { ok: false, error: 'strict' } }, seed: { settings: { 'focus.strict': false, 'focus.unlockFriction': 'none' } } });
  await tab(stale, 'Focus').click();
  await stale.waitForSelector('[data-role="clock"]');
  await stale.getByRole('button', { name: 'End early' }).click();
  await stale.waitForSelector('.note.is-error');
  assert.match(await stale.locator('.note.is-error').textContent(), /cannot be ended early/);
  await endBlocks();
  await stale.close();
});

test('a block that is already running when the popup opens is shown at once', async () => {
  const until = Date.now() + 40 * 60_000;
  await setStorage({ state: { block: { until, reason: 'focus', siteKeys: ['youtube'] } } });
  const page = await openPopup();
  await tab(page, 'Focus').click();
  await page.waitForSelector('[data-role="clock"]');
  assert.match(await page.locator('[data-role="clock"]').textContent(), /^(39|40):\d\d$/);
  await page.close();
});

test('Today: three tiles when there is something to show, nothing without', async () => {
  const page = await openPopup();
  await tab(page, 'Focus').click();
  assert.equal(await page.locator('section[aria-label="Today"]').isVisible(), false);
  assert.equal(await page.locator('.visually-hidden').count(), 0, 'no hidden sentence: the tiles are the text');
  await page.close();

  await setStorage({ stats: { [todayKey()]: { youtube: { activeSec: 25 * 60, opens: 6, turnedBack: 1, continued: 4, blockedHits: 0 } } } });
  const withData = await openPopup();
  await tab(withData, 'Focus').click();
  await withData.waitForSelector('.stats');
  assert.deepEqual(await withData.locator('.stat-value').allTextContents(), ['25m', '6', '1']);
  assert.deepEqual(await withData.locator('.stat-label').allTextContents(), ['on YouTube', 'opens', 'turned back']);
  assert.equal(await withData.getByRole('group', { name: 'Today' }).count(), 1, 'a screen reader reads the tiles');
  await withData.close();
});

test('when the background does not answer, the popup still shows everything it can', async () => {
  const page = await openPopup({
    seed: { stats: { [todayKey()]: { youtube: { activeSec: 600, opens: 2, turnedBack: 0, continued: 2, blockedHits: 0 } } } },
    stubs: { GET_STATUS: { reject: 'Could not establish connection. Receiving end does not exist.' } },
  });
  assert.ok((await page.locator('.row').count()) > 3);
  await tab(page, 'Focus').click();
  await page.waitForSelector('.stats');
  assert.equal(await page.locator('.focus-buttons .btn').count(), 4);
  await page.waitForTimeout(300);
  assert.deepEqual(page.errors, []);
  await page.close();

  // A background that answers with an error object (handler missing) is handled the same way.
  const unknown = await openPopup({ stubs: { GET_STATUS: { ok: false, error: 'unknown' }, FOCUS_START: { ok: false, error: 'unknown' } } });
  await tab(unknown, 'Focus').click();
  await unknown.getByRole('button', { name: '25 min' }).click();
  await unknown.waitForSelector('.note.is-error');
  assert.match(await unknown.locator('.note.is-error').textContent(), /Could not start/);
  assert.equal(await unknown.locator('.focus-buttons .btn').count(), 4);
  assert.deepEqual(unknown.errors, []);
  await unknown.close();
});

test('GET_STATUS from the background adds the daily limit and active schedules', async () => {
  const page = await openPopup({
    stubs: {
      GET_STATUS: {
        ok: true,
        version: '0.1.0',
        block: null,
        sessions: {},
        scheduleOverride: null,
        activeSchedules: [{ id: 's1', name: 'Work hours', action: 'block', endsAt: Date.now() + 3_600_000 }],
        today: { youtube: { activeSec: 2520, opens: 4, turnedBack: 1, continued: 3, blockedHits: 0 } },
        limit: { dailyMinutes: 60, usedSec: 2520, graceLeft: 1 },
      },
    },
  });
  await tab(page, 'Focus').click();
  await page.waitForSelector('.stats');
  assert.equal(await page.locator('.stat-value').first().textContent(), '42m');
  assert.match(await page.locator('.limit-note').textContent(), /42 of 60 min used/);
  assert.match(await page.locator('.focus-block .note').filter({ hasText: 'Work hours' }).textContent(), /“Work hours” until/);
  await page.close();
});

// ---------------------------------------------------------------------------------------------
// Shortcuts, access, size, keyboard
// ---------------------------------------------------------------------------------------------

test('shortcuts in the tooltips: Mac glyphs on a Mac, the assigned keys everywhere', async () => {
  const mac = await openPopup({ os: 'mac', commands: { 'toggle-enabled': 'Alt+Shift+P', 'focus-25': 'Alt+Shift+F', 'open-picker': 'Alt+Shift+H' } });
  await mac.waitForFunction(() => document.querySelector('#foot .btn-quiet')?.title.includes('⌥⇧H'));
  assert.equal(await mac.getByRole('button', { name: 'Hide an element' }).getAttribute('title'), 'Hide an element (⌥⇧H)');
  assert.equal(await mac.locator('#master input.switch').getAttribute('title'), 'Turn At Peace on or off (⌥⇧P)');
  await tab(mac, 'Focus').click();
  await mac.waitForFunction(() => document.querySelector('.focus-buttons .btn')?.title.includes('⌥⇧F'));
  assert.equal(await mac.getByRole('button', { name: '25 min' }).getAttribute('title'), '25 min (⌥⇧F)');
  await mac.close();

  // Elsewhere, and a shortcut the person changed or removed.
  const win = await openPopup({ os: 'win', commands: { 'toggle-enabled': 'Ctrl+Shift+Y', 'focus-25': '', 'open-picker': 'Alt+Shift+H' } });
  await win.waitForFunction(() => document.querySelector('#foot .btn-quiet')?.title.includes('Alt+Shift+H'));
  assert.equal(await win.locator('#master input.switch').getAttribute('title'), 'Turn At Peace on or off (Ctrl+Shift+Y)');
  await tab(win, 'Focus').click();
  assert.equal(await win.getByRole('button', { name: '25 min' }).getAttribute('title'), '25 min', 'no shortcut assigned: nothing to show');
  await win.close();
});

test('the access banner shows when YouTube access is missing', async () => {
  const page = await openPopup({
    init: () => {
      chrome.permissions.contains = async () => false;
    },
  });
  const banner = page.getByRole('region', { name: 'Access to YouTube' });
  await banner.waitFor({ state: 'visible' });
  assert.equal(await banner.getByRole('button', { name: 'Grant access' }).isVisible(), true);
  await page.close();
});

test('size: at most 600 px tall and 380 wide however much is open; the body scrolls, the header, tabs and footer stay', async () => {
  const page = await openPopup({ height: 900 });
  for (const section of await page.evaluate(() => globalThis.AtPeace.schema.sections({ site: 'youtube' }).filter((s) => s.site === 'youtube').map((s) => s.id))) await openGroup(page, section);
  const box = await page.evaluate(() => {
    const rect = (sel) => document.querySelector(sel).getBoundingClientRect();
    return {
      html: document.documentElement.getBoundingClientRect().height,
      width: document.documentElement.getBoundingClientRect().width,
      bodyScroll: document.getElementById('body').scrollHeight,
      bodyClient: document.getElementById('body').clientHeight,
      head: rect('.head').top,
      tabsTop: rect('#tabs').top,
      footBottom: rect('#foot').bottom,
      scrollsPage: document.documentElement.scrollHeight > document.documentElement.clientHeight,
    };
  });
  assert.ok(box.html <= 600, `${box.html} px tall`);
  assert.equal(box.width, 380);
  assert.ok(box.bodyScroll > box.bodyClient + 200, 'the body scrolls inside the popup');
  assert.equal(box.scrollsPage, false, 'the page itself does not');
  assert.ok(box.footBottom <= 600);
  // Scroll the body: the pinned parts do not move.
  const before = await page.evaluate(() => [document.querySelector('#tabs').getBoundingClientRect().top, document.querySelector('#foot').getBoundingClientRect().top]);
  await page.evaluate(() => (document.getElementById('body').scrollTop = 400));
  const after = await page.evaluate(() => [document.querySelector('#tabs').getBoundingClientRect().top, document.querySelector('#foot').getBoundingClientRect().top]);
  assert.deepEqual(after, before);
  assert.deepEqual(page.errors, []);
  await page.close();

  // The Focus tab is shorter than that, and also fits with a block running and the friction steps open.
  await setStorage({ settings: { 'focus.unlockFriction': 'phrase' }, stats: { [todayKey()]: { youtube: { activeSec: 600, opens: 2, turnedBack: 1, continued: 2, blockedHits: 0 } } } });
  const focus = await openPopup({ height: 900 });
  await tab(focus, 'Focus').click();
  assert.ok((await focus.evaluate(() => document.documentElement.getBoundingClientRect().height)) <= 600);
  await focus.getByRole('button', { name: '25 min' }).click();
  await focus.getByRole('button', { name: 'End early' }).click();
  await focus.locator('#phrase').waitFor();
  assert.ok((await focus.evaluate(() => document.documentElement.getBoundingClientRect().height)) <= 600);
  await endBlocks();
  await focus.close();
});

test('keyboard only: the tabs are one stop with arrow keys, a group opens with Enter, Space flips a switch, Escape clears the search', async () => {
  const page = await openPopup({ activeUrl: 'https://www.youtube.com/watch?v=abc' });
  // Tab through the top and the bottom, noting what holds focus.
  const focused = () =>
    page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const label = el.getAttribute('aria-label') || el.labels?.[0]?.textContent || el.textContent;
      return { label: label.trim(), ring: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) >= 2 };
    });
  const seen = [];
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    seen.push(await focused());
  }
  assert.deepEqual(seen.slice(0, 3).map((s) => s.label), ['Turn At Peace on', 'This page', seen[2].label], 'master switch, the selected tab, then the first group');
  assert.equal(seen[2].label.startsWith('Video page'), true);
  for (const s of seen) assert.equal(s.ring, true, `${s.label} shows a focus ring`);

  // Arrow keys move between tabs and select them.
  await tab(page, 'This page').focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await tab(page, 'All').getAttribute('aria-selected'), 'true');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'All');
  await page.keyboard.press('ArrowRight');
  assert.equal(await tab(page, 'Focus').getAttribute('aria-selected'), 'true');
  await page.keyboard.press('ArrowRight');
  assert.equal(await tab(page, 'This page').getAttribute('aria-selected'), 'true', 'wraps round');
  await page.keyboard.press('End');
  assert.equal(await tab(page, 'Focus').getAttribute('aria-selected'), 'true');
  await page.keyboard.press('Home');

  // A group header opens with Enter; Space flips a focused switch.
  await group(page, 'yt.player').locator('.grp-head').focus();
  await page.keyboard.press('Enter');
  assert.equal(await group(page, 'yt.player').locator('.grp-head').getAttribute('aria-expanded'), 'true');
  const toggle = 'yt.watch.hideRelated';
  await row(page, toggle).locator('input.switch').focus();
  await page.keyboard.press('Space');
  await pageUntil(page, async (id) => (await chrome.storage.local.get('settings')).settings?.[id] === true, toggle);

  // The footer is last in the tab order.
  await page.locator('#preset-select').focus();
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Hide an element');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Settings');
  assert.deepEqual(page.errors, []);
  await page.close();
});

// ---------------------------------------------------------------------------------------------
// Screenshots
// ---------------------------------------------------------------------------------------------

test('screenshots: each tab, light and dark (to tests/e2e/artifacts/round1/7a/)', async () => {
  for (const theme of ['light', 'dark']) {
    await evalInExtension(() => chrome.storage.local.clear());
    await setStorage({
      settings: { 'general.theme': theme, 'yt.general.hideAds': true, 'yt.general.grayscale': true, 'yt.shorts.mode': 'block', 'yt.watch.hideRelated': true, 'yt.comments.hideAll': true, 'focus.unlockFriction': 'none', 'pause.enabled': true },
      customPresets: [{ id: 'preset_evening', name: 'Evening', values: { 'yt.general.grayscale': true }, createdAt: 1 }],
      stats: { [todayKey()]: { youtube: { activeSec: 25 * 60, opens: 6, turnedBack: 2, continued: 4, blockedHits: 0 } } },
    });
    const watch = await openPopup({ activeUrl: 'https://www.youtube.com/watch?v=abc' });
    await openGroup(watch, 'yt.player');
    await watch.screenshot({ path: join(SHOTS, `popup-this-page-watch-${theme}.png`) });
    await watch.close();

    const home = await openPopup({ activeUrl: 'https://www.youtube.com/' });
    await home.screenshot({ path: join(SHOTS, `popup-this-page-home-${theme}.png`) });
    await home.close();

    const none = await openPopup();
    await tab(none, 'This page').click();
    await none.screenshot({ path: join(SHOTS, `popup-this-page-off-youtube-${theme}.png`) });
    await tab(none, 'All').click();
    await none.screenshot({ path: join(SHOTS, `popup-all-${theme}.png`) });
    await none.locator('input[type="search"]').fill('hide');
    await none.screenshot({ path: join(SHOTS, `popup-all-search-${theme}.png`) });
    await none.locator('input[type="search"]').press('Escape');
    for (const section of ['yt.home', 'yt.filters', 'general']) await openGroup(none, section);
    await none.locator('.advanced-row').scrollIntoViewIfNeeded();
    await none.screenshot({ path: join(SHOTS, `popup-all-bottom-${theme}.png`) });

    await tab(none, 'Focus').click();
    await none.waitForSelector('.stats');
    await none.screenshot({ path: join(SHOTS, `popup-focus-${theme}.png`) });
    await none.getByRole('button', { name: '25 min' }).click();
    await none.waitForSelector('[data-role="clock"]');
    await none.screenshot({ path: join(SHOTS, `popup-focus-running-${theme}.png`) });
    await none.getByRole('button', { name: 'End early' }).click();
    await none.waitForSelector('.focus-buttons');

    await none.locator('#preset-select').selectOption('::new');
    await none.locator('#sheet input[type="text"]').fill('Quiet evening');
    await none.screenshot({ path: join(SHOTS, `popup-preset-name-${theme}.png`) });
    await none.locator('#sheet input[type="text"]').press('Escape');
    await none.locator('#preset-select').selectOption('focused');
    await none.locator('#sheet').waitFor({ state: 'visible' });
    await none.screenshot({ path: join(SHOTS, `popup-preset-confirm-${theme}.png`) });
    assert.deepEqual(none.errors, []);
    await none.close();
  }
});
