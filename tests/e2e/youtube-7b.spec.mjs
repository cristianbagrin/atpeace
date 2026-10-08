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
import { deflateSync } from 'node:zlib';
import { buildSearchDropdownInPage, visibleDropdownRowsInPage, attachShelfDataInPage, homeRowsInPage, addHeaderButtonInPage, headerButtonsInPage, thumbnailReportInPage } from './_7b-pages.mjs';

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
  await page.bringToFront(); // a background tab gets no animation frames
  previous = Object.entries(settings).filter(([, v]) => v === true).map(([id]) => id);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.getAttribute('data-fixture-ready') === '1' && document.documentElement.hasAttribute('data-at-peace'), null, { timeout: 15_000 });
  await sleep(250);
}

let previous = [];
/** Changes the settings of the open page and waits until the engine's tokens say so. */
async function apply(settings) {
  await setStorage({ settings });
  await page.bringToFront();
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

// ---------------------------------------------------------------------------------------------
// Thumbnail picture (item 6)
// ---------------------------------------------------------------------------------------------


/** A solid-colour PNG (16:9), so a frame in a screenshot is visibly a different picture from the grey stand-in. */
function solidPng(r, g, b, w = 32, h = 18) {
  const crc = (buf) => {
    let c;
    let x = 0xffffffff;
    for (const byte of buf) {
      c = (x ^ byte) & 0xff;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      x = (x >>> 8) ^ c;
    }
    return (x ^ 0xffffffff) >>> 0;
  };
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc(body), body.length + 4);
    return out;
  };
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const FRAME = { start: 'mq1', middle: 'mq2', end: 'mq3' };
const frameUrl = (id, mode) => `https://i.ytimg.com/vi/${id}/${FRAME[mode]}.jpg`;
const THUMB = 'yt.general.thumbnailFrame';

const SURFACES = [
  ['channel Videos tab (lockups)', '/@MrBeast/videos', 'channel-videos'],
  ['search results (legacy ytd-video-renderer) and Shorts shelves', '/results?search_query=lofi', 'search-lofi'],
  ['watch sidebar (lockups)', '/watch?v=n61ULEU7CO0', 'watch-chapters'],
  ['watch page with a queue panel', '/watch?v=n61ULEU7CO0&list=PLx&fixture=watch-playlist', 'watch-playlist'],
  ['channel Shorts tab', '/@MrBeast/shorts?fixture=channel-shorts', 'channel-shorts'],
  ['hashtag page (legacy grid cards)', '/hashtag/cooking', 'hashtag'],
  ['playlist page', '/playlist?list=PLx', 'playlist'],
];

describe('thumbnail picture (item 6)', { skip: fixturesAvailable(SURFACES.map((x) => x[2])) ? false : 'some research snapshots are not on this machine' }, () => {
  let requested;
  before(async () => {
    await start();
    requested = [];
    // YouTube's frames come from a local stand-in (no traffic to Google), a different colour per frame.
    const colours = { mq1: [38, 166, 154], mq2: [239, 108, 0], mq3: [123, 31, 162] };
    await getContext().route(/^https:\/\/i\.ytimg\.com\/vi\/[\w-]{11}\/mq[123]\.jpg/, (route) => route.fulfill({ status: 200, contentType: 'image/png', body: solidPng(...colours[/(mq[123])\.jpg/.exec(route.request().url())[1]]) }));
    getContext().on('request', (r) => {
      if (r.url().startsWith('https://i.ytimg.com/')) requested.push(r.url());
    });
  });
  after(async () => close());

  for (const [label, url, snapshot] of SURFACES) {
    test(`${label}: Early, Middle and Late swap every card picture for YouTube's frame of that video, and Original puts the same pictures back`, async () => {
      await open(`https://www.youtube.com${url}`);
      await sleep(300);
      const before = await page.evaluate(thumbnailReportInPage);
      assert.ok(before.length >= 10, `${snapshot}: ${before.length} pictures`);
      const eligible = before.filter((x) => x.id);
      assert.ok(eligible.length >= 10, `${snapshot}: ${eligible.length} pictures with a video link`);
      for (const mode of ['middle', 'start', 'end']) {
        await apply({ [THUMB]: mode });
        await page.waitForFunction((m) => document.querySelectorAll(`img[data-at-peace-thumb="${m}"]`).length > 5, FRAME[mode], { timeout: 10_000 });
        await sleep(200);
        const now = await page.evaluate(thumbnailReportInPage);
        assert.equal(now.length, before.length);
        for (let i = 0; i < now.length; i++) {
          if (before[i].id) {
            assert.equal(now[i].src, frameUrl(before[i].id, mode), `${snapshot} #${i}: ${mode}`);
            assert.equal(now[i].mark, FRAME[mode]);
            assert.equal(now[i].orig, before[i].src ?? '', 'the original is kept');
            assert.equal(now[i].opacity, '1', 'and visible');
          } else {
            assert.equal(now[i].src, before[i].src, `${snapshot} #${i}: no single video, untouched`);
          }
        }
        if (mode === 'middle') {
          await page.evaluate(() => document.querySelector('img[data-at-peace-thumb]')?.scrollIntoView({ block: 'center' }));
          await sleep(300);
          await page.screenshot({ path: join(SHOTS, `thumbs-${snapshot}-middle.png`) });
        }
      }
      await apply({});
      await page.waitForFunction(() => !document.querySelector('img[data-at-peace-thumb]'), null, { timeout: 10_000 });
      const back = await page.evaluate(thumbnailReportInPage);
      assert.deepEqual(back.map((x) => x.src), before.map((x) => x.src), `${snapshot}: Original puts every picture back`);
      assert.equal(await page.evaluate(() => document.getElementById('at-peace-thumb-style')), null, 'and the style is gone');
      assert.ok(requested.every((u) => /^https:\/\/i\.ytimg\.com\/vi\/[\w-]{11}\/mq[123]\.jpg$/.test(u)), 'only YouTube\'s own frame URLs were requested');
    });
  }

  test('pictures that are not one video\'s stay: a playlist card, a Mix stack, an avatar, a card without a link', async () => {
    await open('https://www.youtube.com/@MrBeast/videos');
    await page.evaluate(() => {
      const grid = document.querySelector('ytd-rich-item-renderer').parentElement;
      const make = (name, html) => {
        const el = document.createElement('div');
        el.id = name;
        el.innerHTML = html;
        grid.append(el);
      };
      make('plist', '<yt-lockup-view-model><a href="/playlist?list=PLabcdefghijk"><yt-thumbnail-view-model><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></yt-thumbnail-view-model></a></yt-lockup-view-model>');
      make('mix', '<yt-lockup-view-model><a href="/watch?v=abcdefghijk&list=RDabcdefghijk"><yt-collection-thumbnail-view-model><yt-thumbnail-view-model><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></yt-thumbnail-view-model></yt-collection-thumbnail-view-model></a></yt-lockup-view-model>');
      make('radio', '<ytd-radio-renderer><a href="/watch?v=abcdefghijk&list=RDabcdefghijk"><ytd-thumbnail><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></ytd-thumbnail></a></ytd-radio-renderer>');
      make('channel', '<yt-lockup-view-model><a href="/@MrBeast"><yt-thumbnail-view-model><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></yt-thumbnail-view-model></a></yt-lockup-view-model>');
    });
    await apply({ [THUMB]: 'middle' });
    await page.waitForFunction(() => document.querySelectorAll('img[data-at-peace-thumb="mq2"]').length > 5, null, { timeout: 10_000 });
    await sleep(300);
    const info = await page.evaluate(() => ['plist', 'mix', 'radio', 'channel'].map((id) => { const img = document.querySelector(`#${id} img`); return [id, img.getAttribute('src'), img.getAttribute('data-at-peace-thumb'), getComputedStyle(img).opacity]; }));
    for (const [id, src, mark, opacity] of info) {
      assert.match(src, /^data:image\/gif/, `${id}: untouched`);
      assert.equal(mark, 'skip', `${id}: left alone on purpose`);
      assert.equal(opacity, '1', `${id}: and visible`);
    }
    await apply({});
  });

  test('YouTube changes the picture later (lazy src, a refresh, a card reused for another video): the frame follows, the new original is kept', async () => {
    await open('https://www.youtube.com/@MrBeast/videos');
    await apply({ [THUMB]: 'end' });
    await page.waitForFunction(() => [...document.querySelectorAll('yt-thumbnail-view-model img')].every((i) => i.getAttribute('data-at-peace-thumb')), null, { timeout: 10_000 });
    const out = await page.evaluate(async () => {
      const wait = (ms) => new Promise((r) => setTimeout(r, ms));
      const lock = document.querySelector('yt-lockup-view-model');
      const link = lock.querySelector('a[href*="/watch?v="]');
      const img = lock.querySelector('yt-thumbnail-view-model img');
      const idOf = () => new URL(link.getAttribute('href'), location.origin).searchParams.get('v');
      const res = {};
      // 1. YouTube sets src again (same video): the frame comes back, the original is the new one.
      img.setAttribute('src', 'https://i.ytimg.com/vi/' + idOf() + '/hq720.jpg');
      await wait(300);
      res.again = [img.getAttribute('src').endsWith('/mq3.jpg'), img.getAttribute('data-at-peace-thumb-src')];
      // 2. The card is reused for another video: new link, new src.
      link.setAttribute('href', '/watch?v=AAAAAAAAAAA');
      img.setAttribute('src', 'https://i.ytimg.com/vi/AAAAAAAAAAA/hq720.jpg');
      await wait(300);
      res.reused = [img.getAttribute('src'), img.getAttribute('data-at-peace-thumb-id'), img.getAttribute('data-at-peace-thumb-src')];
      // 3. A picture with no src yet (lazy loading) gets its frame at once; YouTube's src arriving later is the original.
      const lazy = document.createElement('div');
      lazy.innerHTML = '<ytd-video-renderer><ytd-thumbnail><a href="/watch?v=BBBBBBBBBBB"><img></a></ytd-thumbnail></ytd-video-renderer>';
      document.querySelector('ytd-rich-item-renderer').parentElement.append(lazy);
      await wait(300);
      const lazyImg = lazy.querySelector('img');
      res.lazyBefore = lazyImg.getAttribute('src');
      lazyImg.setAttribute('src', 'https://i.ytimg.com/vi/BBBBBBBBBBB/hq720.jpg');
      await wait(300);
      res.lazyAfter = [lazyImg.getAttribute('src'), lazyImg.getAttribute('data-at-peace-thumb-src')];
      return res;
    });
    assert.equal(out.again[0], true, `the frame is back after YouTube set src again: ${JSON.stringify(out)}`);
    assert.match(out.again[1], /\/hq720\.jpg$/, 'and the new picture is the original now');
    assert.deepEqual(out.reused.slice(0, 2), ['https://i.ytimg.com/vi/AAAAAAAAAAA/mq3.jpg', 'AAAAAAAAAAA']);
    assert.equal(out.reused[2], 'https://i.ytimg.com/vi/AAAAAAAAAAA/hq720.jpg');
    assert.equal(out.lazyBefore, 'https://i.ytimg.com/vi/BBBBBBBBBBB/mq3.jpg');
    assert.deepEqual(out.lazyAfter, ['https://i.ytimg.com/vi/BBBBBBBBBBB/mq3.jpg', 'https://i.ytimg.com/vi/BBBBBBBBBBB/hq720.jpg']);
    await apply({});
    assert.equal(await page.evaluate(() => document.querySelectorAll('img[data-at-peace-thumb]').length), 0);
  });

  test('a frame that does not load (a new video, a live stream) puts the original back, once, and is not asked for again', async () => {
    await open('https://www.youtube.com/@MrBeast/videos');
    const before = await page.evaluate(thumbnailReportInPage);
    const missing = before[0].id;
    await getContext().route(`https://i.ytimg.com/vi/${missing}/mq2.jpg`, (route) => route.fulfill({ status: 404, contentType: 'text/html', body: 'Not found' }));
    requested.length = 0;
    await apply({ [THUMB]: 'middle' });
    await page.waitForFunction((id) => document.querySelector('img[data-at-peace-thumb="failed"]')?.getAttribute('data-at-peace-thumb-id') === id, missing, { timeout: 10_000 });
    await sleep(500);
    const now = await page.evaluate(thumbnailReportInPage);
    assert.equal(now[0].src, before[0].src, 'the original is back');
    assert.equal(now[0].mark, 'failed');
    assert.equal(now[1].src, frameUrl(before[1].id, 'middle'), 'the others are frames');
    assert.equal(requested.filter((u) => u.includes(`/${missing}/mq2.jpg`)).length, 1, 'asked once');
    // another frame is tried (and loads: only mq2 is missing)
    await apply({ [THUMB]: 'end' });
    await page.waitForFunction(() => document.querySelectorAll('img[data-at-peace-thumb="mq3"]').length > 5, null, { timeout: 10_000 });
    assert.equal((await page.evaluate(thumbnailReportInPage))[0].src, frameUrl(missing, 'end'));
    await apply({});
    await getContext().unroute(`https://i.ytimg.com/vi/${missing}/mq2.jpg`);
  });

  test('no flash: a card added later is transparent until its frame is set, never shows the original; the fail-safe shows a picture nobody handles', async () => {
    await open('https://www.youtube.com/@MrBeast/videos');
    await apply({ [THUMB]: 'middle' });
    await page.waitForFunction(() => document.querySelectorAll('img[data-at-peace-thumb="mq2"]').length > 5, null, { timeout: 10_000 });
    const out = await page.evaluate(async () => {
      const samples = [];
      const grid = document.querySelector('ytd-rich-item-renderer').parentElement;
      const wrap = document.createElement('div');
      wrap.innerHTML = '<ytd-rich-item-renderer><yt-lockup-view-model><a href="/watch?v=CCCCCCCCCCC"><yt-thumbnail-view-model><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></yt-thumbnail-view-model></a></yt-lockup-view-model></ytd-rich-item-renderer>';
      grid.prepend(wrap);
      const img = wrap.querySelector('img');
      for (let i = 0; i < 20; i++) {
        samples.push([img.getAttribute('src').startsWith('data:') ? 'original' : 'frame', getComputedStyle(img).opacity]);
        await new Promise((r) => requestAnimationFrame(r));
      }
      // A card nobody can handle (no link yet): transparent first, shown by the fail-safe.
      const orphan = document.createElement('div');
      orphan.innerHTML = '<ytd-video-renderer><ytd-thumbnail><img src="data:image/gif;base64,R0lGODlhAQABAAAAACw="></ytd-thumbnail></ytd-video-renderer>';
      grid.prepend(orphan);
      const oimg = orphan.querySelector('img');
      await new Promise((r) => setTimeout(r, 300));
      const early = getComputedStyle(oimg).opacity;
      await new Promise((r) => setTimeout(r, 1500));
      return { samples, early, late: getComputedStyle(oimg).opacity, orphanSrc: oimg.getAttribute('src').slice(0, 10) };
    });
    assert.ok(out.samples.length === 20);
    assert.equal(out.samples.some(([src, opacity]) => src === 'original' && opacity !== '0'), false, `the original was never visible: ${JSON.stringify(out.samples.slice(0, 5))}`);
    assert.equal(out.samples.at(-1)[0], 'frame');
    assert.equal(out.early, '0', 'an unhandled picture waits, transparent');
    assert.equal(out.late, '1', 'and the fail-safe shows it');
    assert.equal(out.orphanSrc, 'data:image');
    await apply({});
    assert.deepEqual(ourErrors(), []);
  });

  test('the blur and grayscale options keep working on the frames', async () => {
    await open('https://www.youtube.com/@MrBeast/videos');
    await apply({ [THUMB]: 'middle', 'yt.general.thumbnails': 'blur' });
    await page.waitForFunction(() => document.querySelectorAll('img[data-at-peace-thumb="mq2"]').length > 5, null, { timeout: 10_000 });
    assert.match(await page.evaluate(() => getComputedStyle(document.querySelector('yt-thumbnail-view-model img[data-at-peace-thumb="mq2"]')).filter), /^blur\(14px\)/);
    await apply({});
  });
});
