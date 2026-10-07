// Phase 7b (Chromium, offline snapshots): search history (item 8), channel-page sections (item 10) and
// thumbnail pictures (item 6). Card metadata (item 7) has its own file: card-metrics.spec.mjs.
// www.youtube.com is served from the research snapshots (tests/e2e/_yt-fixture.mjs; no traffic to Google).
// Screenshots go to tests/e2e/artifacts/round1/7b/.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { launch, close, getContext, setStorage, trackErrors, ARTIFACTS } from './harness.mjs';
import { fixturesAvailable, installYouTubeFixtures } from './_yt-fixture.mjs';
import { readFileSync } from 'node:fs';
import { buildSearchDropdownInPage, visibleDropdownRowsInPage, attachShelfDataInPage, homeRowsInPage, addHeaderButtonInPage, headerButtonsInPage } from './_7b-pages.mjs';

const SHELVES = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'fixtures', 'youtube', 'channel-shelves.json'), 'utf8'));

const SHOTS = join(ARTIFACTS, 'round1', '7b');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let page;

async function start() {
  await launch();
  await mkdir(SHOTS, { recursive: true });
  await installYouTubeFixtures(getContext());
  page = trackErrors(await getContext().newPage());
  await page.setViewportSize({ width: 1440, height: 900 });
}

/** Stores the settings, opens the page, and waits for the engine and the snapshot. */
async function open(url, settings = {}) {
  await setStorage({ settings });
  previous = Object.entries(settings).filter(([, v]) => v === true).map(([id]) => id);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.getAttribute('data-fixture-ready') === '1' && document.documentElement.hasAttribute('data-at-peace'), null, { timeout: 15_000 });
  await sleep(250);
}

let previous = [];
/** Changes the settings of the open page and waits until the engine's tokens say so. */
async function apply(settings) {
  await setStorage({ settings });
  const want = Object.entries(settings).map(([id, v]) => (v === true ? id : typeof v === 'string' ? `${id}=${v}` : null)).filter(Boolean);
  const drop = previous.filter((t) => !want.includes(t));
  await page.waitForFunction(({ want, drop }) => {
    const tokens = (document.documentElement.getAttribute('data-at-peace') ?? '').split(' ');
    return want.every((t) => tokens.includes(t)) && drop.every((t) => !tokens.includes(t));
  }, { want, drop }, { timeout: 10_000 });
  previous = want;
  await sleep(200);
}

const ourErrors = () => page.errors.filter((e) => e.includes('[At Peace]') || e.includes('chrome-extension://'));

describe('search history (item 8)', { skip: fixturesAvailable(['home']) ? false : 'snapshots are not on this machine' }, () => {
  before(start);
  after(async () => close());

  test('previous searches go, live suggestions stay; the setting is live', async () => {
    await open('https://www.youtube.com/');
    const kinds = await page.evaluate(buildSearchDropdownInPage);
    assert.deepEqual(await page.evaluate(visibleDropdownRowsInPage), [...kinds.history.map((q) => `history:${q}`), ...kinds.live.map((q) => `live:${q}`)]);
    await page.screenshot({ path: join(SHOTS, 'search-history-before.png'), clip: { x: 0, y: 0, width: 1440, height: 420 } });

    await apply({ 'yt.masthead.hideSearchHistory': true });
    assert.deepEqual(await page.evaluate(visibleDropdownRowsInPage), kinds.live.map((q) => `live:${q}`));
    await page.screenshot({ path: join(SHOTS, 'search-history-after.png'), clip: { x: 0, y: 0, width: 1440, height: 420 } });

    await apply({});
    assert.equal((await page.evaluate(visibleDropdownRowsInPage)).length, 6, 'back when switched off');
    assert.deepEqual(ourErrors(), []);
  });

  test('with "hide search suggestions" the whole dropdown is gone, history setting or not', async () => {
    await apply({ 'yt.masthead.hideSearchSuggestions': true });
    assert.deepEqual(await page.evaluate(visibleDropdownRowsInPage), []);
    await apply({});
  });
});

// ---------------------------------------------------------------------------------------------
// Channel pages (item 10)
// ---------------------------------------------------------------------------------------------

const ROW_SETTINGS = {
  'yt.channel.hideRowShorts': 'shorts',
  'yt.channel.hideRowPosts': 'posts',
  'yt.channel.hideRowMembers': 'members',
  'yt.channel.hideRowLive': 'live',
  'yt.channel.hideRowPopular': 'popular',
  'yt.channel.hideRowPlaylists': 'playlists',
  'yt.channel.hideRowChannels': 'channels',
};

const haveChannels = fixturesAvailable(['channel-home-ltt', 'channel-home-lofigirl']);

describe('channel pages: rows by type, the Join button, more tabs (item 10)', { skip: haveChannels ? false : 'channel-home-ltt / channel-home-lofigirl snapshots are not on this machine' }, () => {
  before(start);
  after(async () => close());

  /** Opens a channel Home snapshot with the live-captured row data attached; every toggle must hide exactly its type. */
  async function rowsTest(channel, snapshot, types) {
    await open(`https://www.youtube.com/@${channel}/featured?fixture=${snapshot}`);
    const n = await page.evaluate(attachShelfDataInPage, SHELVES[channel].shelves);
    assert.equal(n, SHELVES[channel].shelves.length, 'every row of the snapshot got its data');
    await apply({ 'yt.channel.hideRowPosts': true }); // any tag-needing setting wakes the bridge
    await page.waitForFunction(() => document.querySelector('[data-at-peace-shelf]'), null, { timeout: 10_000 });
    const rows = await page.evaluate(homeRowsInPage);
    assert.deepEqual(rows.map((r) => r[1]), SHELVES[channel].shelves.map((r, i) => (r.tag === 'ytd-channel-video-player-renderer' ? null : types[i])), `${channel}: tags`);

    for (const [id, type] of Object.entries(ROW_SETTINGS)) {
      await apply({ [id]: true });
      const now = await page.evaluate(homeRowsInPage);
      const want = rows.map((r) => r[1] !== type);
      if (!rows.some((r) => r[1] === type)) continue; // this channel has no such row
      assert.deepEqual(now.map((r) => r[2]), want, `${channel}: ${id} hides the ${type} rows and nothing else`);
    }
    await apply({ 'yt.channel.hideHomeShelves': true });
    assert.deepEqual((await page.evaluate(homeRowsInPage)).map((r) => r[2]), rows.map(() => false), 'hide all rows still hides every row');
    await apply({});
    assert.deepEqual((await page.evaluate(homeRowsInPage)).map((r) => r[2]), rows.map(() => true), 'all back');
    await page.waitForFunction(() => !document.querySelector('[data-at-peace-shelf]'), null, { timeout: 10_000 });
  }

  test('Linus Tech Tips: the members-only row, Shorts, Posts, Playlists, popular and featured channels each go on their own', async () => {
    await rowsTest('LinusTechTips', 'channel-home-ltt', ['x', 'videos', 'series', 'popular', 'channels', 'series', 'series', 'members', 'playlists', 'shorts', 'posts', 'x'].map((t) => (t === 'x' ? null : t)));
    await apply({ 'yt.channel.hideRowMembers': true, 'yt.channel.hideRowPosts': true });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: join(SHOTS, 'channel-rows-ltt-members-posts-hidden.png'), fullPage: true });
    assert.deepEqual(ourErrors(), []);
  });

  test('Lofi Girl: the live (radio) row goes on its own', async () => {
    await rowsTest('LofiGirl', 'channel-home-lofigirl', [null, 'live', 'series', 'series', 'series', 'channels']);
  });

  test('the Join button: the wrapper of the button tagged "join" goes, Subscribe and the others stay', async () => {
    await open('https://www.youtube.com/@LinusTechTips/featured?fixture=channel-home-ltt');
    const count = await page.evaluate(addHeaderButtonInPage, { data: { accessibilityId: 'eml.header_join_button', title: 'Join', onTap: { innertubeCommand: { commandMetadata: {}, modalEndpoint: {} } } }, label: 'Join' });
    assert.equal(count, 2);
    await apply({ 'yt.channel.hideJoinButton': true });
    await page.waitForFunction(() => document.querySelectorAll('[data-at-peace-channel-action]').length >= 2, null, { timeout: 10_000 });
    assert.deepEqual(await page.evaluate(headerButtonsInPage), [['subscribe', true], ['join', false]]);
    await page.screenshot({ path: join(SHOTS, 'channel-header-join-hidden.png'), clip: { x: 0, y: 56, width: 1440, height: 420 } });
    await apply({});
    await page.waitForFunction(() => !document.querySelector('[data-at-peace-channel-action]'), null, { timeout: 10_000 });
    assert.deepEqual((await page.evaluate(headerButtonsInPage)).map((b) => b[1]), [true, true]);
    assert.deepEqual(ourErrors(), []);
  });

  test('tabs: Shows (and Live, Podcasts) are tagged from the page data and hidden one by one; the others stay', async () => {
    await open('https://www.youtube.com/@LinusTechTips/featured?fixture=channel-home-ltt');
    await page.evaluate((tabs) => {
      const browse = document.querySelector('ytd-browse[page-subtype="channels"]');
      browse.data = { contents: { twoColumnBrowseResultsRenderer: { tabs: tabs.map((t) => (t.expandable ? { expandableTabRenderer: { title: t.title, endpoint: { commandMetadata: { webCommandMetadata: { url: t.url } } } } } : { tabRenderer: { title: t.title, endpoint: { commandMetadata: { webCommandMetadata: { url: t.url } } } } })) } } };
    }, SHELVES.LinusTechTips.tabs);
    const shown = () => page.evaluate(() => [...document.querySelectorAll('yt-tab-shape[role="tab"]')].map((t) => [t.getAttribute('data-at-peace-tab'), getComputedStyle(t).display !== 'none']));
    await apply({ 'yt.channel.hideShowsTab': true });
    await page.waitForFunction(() => document.querySelectorAll('yt-tab-shape[data-at-peace-tab]').length >= 8, null, { timeout: 10_000 });
    assert.deepEqual(await shown(), [['home', true], ['videos', true], ['shorts', true], ['streams', true], ['shows', false], ['podcasts', true], ['playlists', true], ['posts', true]]);
    await apply({ 'yt.channel.hideShowsTab': true, 'yt.channel.hideLiveTab': true, 'yt.channel.hidePodcastsTab': true });
    assert.deepEqual((await shown()).map(([, v]) => v), [true, true, true, false, false, false, true, true]);
    await apply({});
  });
});
