// Phase 7b in REAL Firefox (headless, Selenium + geckodriver), on offline snapshots served by a local http server
// (tests/e2e/_yt-fixture.mjs; no traffic to Google). Firefox is the product (Zen): the selectors of this phase use
// `:has(+ …)`, `:nth-last-child(1 of …)` and attribute gates, and this is where they are proved.
//   1. card metadata: only the number goes (item 7), in every layout of tests/e2e/_card-variants.mjs
//   2. search box: previous searches go, live suggestions stay (item 8)
//   3. channel Home rows by type, the Join button and more tabs (item 10)
//   4. thumbnail picture: the frame is asked for, and put back when it cannot load (item 6)
// Prerequisite: bash tests/firefox/setup.sh. Skipped without the snapshots.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launchFirefox, ROOT, NAVIGATION_NOISE } from './_harness.mjs';
import { fixturesAvailable, startFixtureServer } from '../e2e/_yt-fixture.mjs';
import { buildVariantsInPage, partsVisibleInPage } from '../e2e/_card-variants.mjs';
import { buildSearchDropdownInPage, visibleDropdownRowsInPage, attachShelfDataInPage, homeRowsInPage, addHeaderButtonInPage, headerButtonsInPage, thumbnailReportInPage } from '../e2e/_7b-pages.mjs';
import { until } from '../helpers/wait.mjs';

const SHOTS = join(ROOT, 'tests', 'e2e', 'artifacts', 'round1', '7b');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const VIEWS = 'yt.general.hideViewCounts';
const DATES = 'yt.general.hideUploadDates';

const HAVE = fixturesAvailable(['channel-home', 'home']);
const HAVE_CHANNELS = fixturesAvailable(['channel-home-ltt', 'channel-home-lofigirl']);

describe('7b on offline snapshots', { skip: HAVE ? false : 'research snapshots are absent (tests/e2e/artifacts/research is local only)' }, () => {
  let ff;
  let server;
  let driver;
  const run = (fn, arg) => driver.executeScript(fn, arg ?? null);

  before(async () => {
    server = await startFixtureServer();
    ff = await launchFirefox({
      prefs: {
        // i.ytimg.com (the pictures) resolves to this machine too: nothing reaches Google, and a frame that cannot
        // load is exactly the "no frame" case the thumbnail feature must survive.
        'network.dns.localDomains': 'www.youtube.com, i.ytimg.com',
        'network.proxy.no_proxies_on': 'localhost, 127.0.0.1, www.youtube.com, i.ytimg.com',
        'network.stricttransportsecurity.preloadlist': false,
      },
    });
    driver = ff.driver;
    await driver.manage().window().setRect({ width: 1440, height: 900 });
    await mkdir(SHOTS, { recursive: true });
  });
  after(async () => {
    await ff?.close();
    await server?.close();
  });

  const configure = async (settings) => {
    await ff.setStorage({ settings });
    await sleep(300);
  };
  async function open(path) {
    await driver.get(`${server.origin}${path}`);
    await until(() => run(() => document.documentElement.hasAttribute('data-at-peace') && document.documentElement.hasAttribute('data-at-peace-page')), 'the engine', 20_000);
    await until(() => run(() => document.documentElement.getAttribute('data-fixture-ready') === '1'), 'the snapshot', 20_000);
  }
  const ourErrors = async () => [...(await ff.ourScriptErrors()), ...ff.pageErrorsSince(0).filter((e) => e.includes('moz-extension://') || e.includes('[At Peace]'))].filter((e) => !NAVIGATION_NOISE.test(e));
  const shot = async (name) => writeFile(join(SHOTS, `ff-${name}.png`), await driver.takeScreenshot(), 'base64');

  describe('card metadata: only the number goes', () => {
    // The same table as tests/e2e/card-metrics.spec.mjs (Chromium); kept in step by hand, it is short.
    const ALL = ['channel', 'tick', 'play', 'views', 'sep-1', 'date'];
    const EXPECT = {
      'two-rows': { none: ALL, views: ['channel', 'tick', 'date'], dates: ['channel', 'tick', 'play', 'views'], both: ['channel', 'tick'] },
      'two-rows-plain': { none: ['channel', 'tick', 'views', 'sep-1', 'date'], views: ['channel', 'tick', 'date'], dates: ['channel', 'tick', 'views'], both: ['channel', 'tick'] },
      'one-row': { none: ['channel', 'tick', 'sep-1', 'play', 'views', 'sep-2', 'date'], views: ['channel', 'tick', 'sep-1', 'date'], dates: ['channel', 'tick', 'sep-1', 'play', 'views'], both: ['channel', 'tick'] },
      'one-row-plain': { none: ['channel', 'tick', 'sep-1', 'views', 'sep-2', 'date'], views: ['channel', 'tick', 'sep-1', 'date'], dates: ['channel', 'tick', 'sep-1', 'views'], both: ['channel', 'tick'] },
      'no-channel': { none: ['play', 'views', 'sep-1', 'date'], views: ['date'], dates: ['play', 'views'], both: [] },
      'live-two-rows': { none: ['channel', 'tick', 'views'], views: ['channel', 'tick'], dates: ['channel', 'tick', 'views'], both: ['channel', 'tick'] },
      'live-one-row': { none: ['channel', 'tick', 'sep-1', 'views'], views: ['channel', 'tick'], dates: ['channel', 'tick', 'sep-1', 'views'], both: ['channel', 'tick'] },
      playlist: { none: ALL, views: ALL, dates: ALL, both: ALL },
    };
    let names;

    before(async () => {
      await configure({});
      await open('/@MrBeast/featured?fixture=channel-home');
      names = await run(buildVariantsInPage);
    });

    for (const [mode, settings] of [['none', {}], ['views', { [VIEWS]: true }], ['dates', { [DATES]: true }], ['both', { [VIEWS]: true, [DATES]: true }]]) {
      test(`${mode}: what stays in every layout`, async () => {
        assert.deepEqual(names, Object.keys(EXPECT));
        await configure(settings);
        const want = Object.keys(settings);
        await until(
          () => run((ids) => { const tokens = (document.documentElement.getAttribute('data-at-peace') ?? '').split(' '); return ids.every((id) => tokens.includes(id)) && (ids.length > 0 || !tokens.includes('yt.general.hideViewCounts')); }, want),
          'the settings to reach the page',
          10_000,
        );
        await sleep(150);
        for (const name of names) assert.deepEqual(await run(partsVisibleInPage, name), EXPECT[name][mode], `${name}, ${mode}`);
        await shot(`card-metrics-${mode}`);
      });
    }

    test('no errors from the extension', async () => {
      assert.deepEqual(await ourErrors(), []);
    });
  });
  describe('search box (item 8)', () => {
    test('previous searches go, live suggestions stay; the setting is live', async () => {
      await configure({});
      await open('/');
      const kinds = await run(buildSearchDropdownInPage);
      const all = [...kinds.history.map((q) => `history:${q}`), ...kinds.live.map((q) => `live:${q}`)];
      assert.deepEqual(await run(visibleDropdownRowsInPage), all);
      await configure({ 'yt.masthead.hideSearchHistory': true });
      await until(async () => (await run(visibleDropdownRowsInPage)).length === 3, 'history rows hidden', 10_000);
      assert.deepEqual(await run(visibleDropdownRowsInPage), kinds.live.map((q) => `live:${q}`));
      await shot('search-history-hidden');
      await configure({});
      await until(async () => (await run(visibleDropdownRowsInPage)).length === 6, 'rows back', 10_000);
      assert.deepEqual(await ourErrors(), []);
    });
  });

  describe('channel pages (item 10)', { skip: HAVE_CHANNELS ? false : 'channel-home-ltt / channel-home-lofigirl snapshots are absent' }, () => {
    let SHELVES;
    before(async () => {
      SHELVES = JSON.parse(await readFile(join(ROOT, 'tests', 'fixtures', 'youtube', 'channel-shelves.json'), 'utf8'));
    });
    const ROW_SETTINGS = {
      'yt.channel.hideRowShorts': 'shorts',
      'yt.channel.hideRowPosts': 'posts',
      'yt.channel.hideRowMembers': 'members',
      'yt.channel.hideRowLive': 'live',
      'yt.channel.hideRowPopular': 'popular',
      'yt.channel.hideRowPlaylists': 'playlists',
      'yt.channel.hideRowChannels': 'channels',
    };

    async function rowsTest(channel, snapshot, types) {
      await configure({});
      await open(`/@${channel}/featured?fixture=${snapshot}`);
      assert.equal(await run(attachShelfDataInPage, SHELVES[channel].shelves), SHELVES[channel].shelves.length);
      await configure({ 'yt.channel.hideRowPosts': true });
      await until(() => run(() => Boolean(document.querySelector('[data-at-peace-shelf]'))), 'the bridge tags the rows', 15_000);
      const rows = await run(homeRowsInPage);
      assert.deepEqual(rows.map((r) => r[1]), SHELVES[channel].shelves.map((r, i) => (r.tag === 'ytd-channel-video-player-renderer' ? null : types[i])), `${channel}: tags`);
      for (const [id, type] of Object.entries(ROW_SETTINGS)) {
        if (!rows.some((r) => r[1] === type)) continue;
        await configure({ [id]: true });
        await until(async () => (await run(homeRowsInPage)).map((r) => r[2]).join() === rows.map((r) => r[1] !== type).join(), `${id} hides the ${type} rows and nothing else`, 10_000);
      }
      await configure({ 'yt.channel.hideHomeShelves': true });
      await until(async () => (await run(homeRowsInPage)).every((r) => r[2] === false), 'all rows hidden', 10_000);
      await configure({});
      await until(async () => (await run(homeRowsInPage)).every((r) => r[2] === true), 'rows back', 10_000);
    }

    test('Linus Tech Tips: members-only, Shorts, Posts, Playlists, popular and featured channels each go on their own', async () => {
      await rowsTest('LinusTechTips', 'channel-home-ltt', [null, 'videos', 'series', 'popular', 'channels', 'series', 'series', 'members', 'playlists', 'shorts', 'posts', null]);
      await configure({ 'yt.channel.hideRowMembers': true, 'yt.channel.hideRowPosts': true });
      await sleep(400);
      await shot('channel-rows-ltt');
      assert.deepEqual(await ourErrors(), []);
    });

    test('Lofi Girl: the live (radio) row goes on its own', async () => {
      await rowsTest('LofiGirl', 'channel-home-lofigirl', [null, 'live', 'series', 'series', 'series', 'channels']);
    });

    test('the Join button goes, Subscribe stays; Shows and Courses tabs hide one by one', async () => {
      await configure({});
      await open('/@LinusTechTips/featured?fixture=channel-home-ltt');
      assert.equal(await run(addHeaderButtonInPage, { data: { accessibilityId: 'eml.header_join_button', onTap: { innertubeCommand: { commandMetadata: {}, modalEndpoint: {} } } }, label: 'Join' }), 2);
      await run((tabs) => {
        const browse = document.querySelector('ytd-browse[page-subtype="channels"]');
        browse.data = { contents: { twoColumnBrowseResultsRenderer: { tabs: tabs.map((t) => (t.expandable ? { expandableTabRenderer: { title: t.title, endpoint: { commandMetadata: { webCommandMetadata: { url: t.url } } } } } : { tabRenderer: { title: t.title, endpoint: { commandMetadata: { webCommandMetadata: { url: t.url } } } } })) } } };
      }, SHELVES.LinusTechTips.tabs);
      await configure({ 'yt.channel.hideJoinButton': true, 'yt.channel.hideShowsTab': true });
      await until(async () => JSON.stringify(await run(headerButtonsInPage)) === JSON.stringify([['subscribe', true], ['join', false]]), 'Join hidden, Subscribe shown', 15_000);
      const shown = () => run(() => [...document.querySelectorAll('yt-tab-shape[role="tab"]')].map((t) => [t.getAttribute('data-at-peace-tab'), getComputedStyle(t).display !== 'none']));
      await until(async () => (await shown()).some(([name, visible]) => name === 'shows' && !visible), 'Shows tab hidden', 15_000);
      assert.deepEqual((await shown()).map(([, v]) => v), [true, true, true, true, false, true, true, true]);
      assert.deepEqual(await ourErrors(), []);
    });
  });
  describe('thumbnail picture (item 6)', () => {
    test('every card picture is pointed at YouTube\'s frame of its video; where the frame cannot load the original comes back, once; Original leaves nothing behind', async () => {
      await configure({});
      await open('/@MrBeast/videos');
      const before = await run(thumbnailReportInPage);
      assert.ok(before.length >= 10);
      // A page-side log of every src this page sees, to catch the frame URLs even though they fail at once here.
      await run(() => {
        window.__srcLog = [];
        new MutationObserver((records) => {
          for (const r of records) if (r.target.localName === 'img') window.__srcLog.push(r.target.getAttribute('src'));
        }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['src'] });
      });
      await configure({ 'yt.general.thumbnailFrame': 'middle' });
      await until(
        () => run((n) => document.querySelectorAll('img[data-at-peace-thumb="failed"]').length >= n, before.filter((x) => x.id).length),
        'every frame refused here and the originals put back',
        20_000,
      );
      const log = await run(() => window.__srcLog);
      for (const { id } of before.filter((x) => x.id)) assert.ok(log.includes(`https://i.ytimg.com/vi/${id}/mq2.jpg`), `${id}: the frame was asked for`);
      assert.ok(log.every((u) => u === null || u.startsWith('data:') || /^https:\/\/i\.ytimg\.com\/vi\/[\w-]{11}\/mq2\.jpg$/.test(u)), 'and nothing else');
      const now = await run(thumbnailReportInPage);
      assert.deepEqual(now.map((x) => x.src), before.map((x) => x.src), 'the originals are back');
      assert.equal(await run(() => document.querySelectorAll('img[data-at-peace-thumb="mq2"]').length), 0);
      assert.equal(await run(() => [...document.querySelectorAll('yt-thumbnail-view-model img')].some((i) => getComputedStyle(i).opacity !== '1')), false, 'all visible');
      await configure({});
      await until(() => run(() => !document.querySelector('img[data-at-peace-thumb]') && !document.getElementById('at-peace-thumb-style')), 'nothing left behind', 10_000);
      assert.deepEqual((await run(thumbnailReportInPage)).map((x) => x.src), before.map((x) => x.src));
      assert.deepEqual(await ourErrors(), []);
    });

    test('the same on a search page (legacy cards, Shorts shelves) and a watch page sidebar', async () => {
      for (const path of ['/results?search_query=lofi', '/watch?v=n61ULEU7CO0']) {
        await configure({});
        await open(path);
        const before = await run(thumbnailReportInPage);
        await configure({ 'yt.general.thumbnailFrame': 'end' });
        await until(() => run((n) => document.querySelectorAll('img[data-at-peace-thumb]').length >= n, before.length), `${path}: every picture handled`, 20_000);
        const now = await run(thumbnailReportInPage);
        assert.deepEqual(now.map((x) => x.src), before.map((x) => x.src), `${path}: originals back (frames cannot load here)`);
        await configure({});
      }
      assert.deepEqual(await ourErrors(), []);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// Live youtube.com in Firefox (logged out): the bridge reads the real data of a channel's Home tab.
// Google may answer with its captcha: the test then skips (it says nothing about At Peace).
// ---------------------------------------------------------------------------------------------

describe('7b on live youtube.com', () => {
  let ff;
  before(async () => {
    ff = await launchFirefox();
    await ff.driver.manage().window().setRect({ width: 1440, height: 900 });
    await mkdir(SHOTS, { recursive: true });
  });
  after(async () => ff?.close());

  test('a channel Home tab: rows are typed from YouTube\'s own data and hidden one by one; tabs and header too', async (t) => {
    const { driver } = ff;
    const run = (fn, arg) => driver.executeScript(fn, arg ?? null);
    await ff.setStorage({ settings: { 'yt.channel.hideRowMembers': true, 'yt.channel.hideRowPosts': true, 'yt.channel.hideShowsTab': true } });
    await driver.get('https://www.youtube.com/@LinusTechTips/featured');
    if ((await driver.getCurrentUrl()).includes('/sorry/')) return t.skip('Google served its captcha page');
    await until(() => run(() => document.documentElement.hasAttribute('data-at-peace')), 'the engine', 20_000);
    // Rows below the fold are drawn as the page is scrolled.
    for (let i = 1; i <= 12; i += 1) {
      await run((y) => window.scrollTo(0, y), i * 900);
      await sleep(600);
    }
    await run(() => window.scrollTo(0, 0));
    const rows = () => run(() => [...document.querySelectorAll('ytd-browse[page-subtype="channels"]:not([hidden]) ytd-item-section-renderer')].map((s) => [s.querySelector(':scope > #contents > *')?.getAttribute('data-at-peace-shelf') ?? null, getComputedStyle(s).display === 'none']));
    await until(async () => (await rows()).some(([type]) => type === 'members'), 'the members-only row is tagged', 15_000);
    const now = await rows();
    assert.ok(now.length >= 8, `${now.length} rows drawn`);
    for (const [type, hidden] of now) assert.equal(hidden, type === 'members' || type === 'posts', `${type}: hidden=${hidden}`);
    const tabs = await run(() => [...document.querySelectorAll('yt-tab-shape[role="tab"]')].map((tab) => [tab.getAttribute('data-at-peace-tab'), getComputedStyle(tab).display === 'none']));
    assert.deepEqual(tabs.filter(([, hidden]) => hidden).map(([name]) => name), ['shows']);
    assert.ok(tabs.some(([name]) => name === 'videos'), 'the other tabs are tagged and shown');
    await run(() => window.scrollTo(0, 700));
    await writeFile(join(SHOTS, 'ff-live-channel-rows.png'), await driver.takeScreenshot(), 'base64');
    await ff.setStorage({ settings: {} });
  });
});
