// Phase 3b E2E (Chromium): the YouTube JS behaviours, the MAIN-world bridge and the redirects.
//
// Two groups, each with its own browser:
//   1. "on offline snapshots": www.youtube.com served from the Phase 1 DOM snapshots
//      (tests/e2e/_yt-fixture.mjs, no traffic to Google). The extension runs exactly as on the real site
//      (the URL matches), so this is where every behaviour is exercised with controlled content: filters
//      against known titles, redirects, bridge tags from `.data` objects shaped like the ones observed live,
//      and a stand-in player (an object with the player API's methods) for autoplay / speed / theater.
//   2. "on live youtube.com" (logged out): the same checks against the real site and its real data objects,
//      paced (Google answers many page loads with a /sorry/ captcha; a captcha skips the rest of the group).
//
// What cannot be exercised in this sandbox (no video playback: googlevideo.com is blocked; no login):
// the effect of autoplay-off / no-auto-start / default speed on a PLAYING video, the end-of-video
// countdown, "Are you still watching?", hover previews that actually load, and the signed-in sidebar
// entries. Their decision logic is unit-tested; the DOM effects below are what is observable.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { launch, close, getContext, setStorage, evalInExtension, trackErrors, extensionDiagnostics, extUrl, ARTIFACTS } from './harness.mjs';
import { fixturesAvailable, installYouTubeFixtures } from './_yt-fixture.mjs';

const SHOTS = join(ARTIFACTS, 'features');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const HOME = 'https://www.youtube.com/';
const SEARCH = 'https://www.youtube.com/results?search_query=lofi';
const WATCH = 'https://www.youtube.com/watch?v=n61ULEU7CO0';
const CHANNEL = 'https://www.youtube.com/@MrBeast/videos';
const SHORT_ID = 'C0STkNVChLI';

let page;
let fixtures = null; // { hits } when the offline group is running

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

async function startBrowser({ offline }) {
  await launch();
  await mkdir(SHOTS, { recursive: true });
  fixtures = offline ? await installYouTubeFixtures(getContext()) : null;
  page = trackErrors(await getContext().newPage());
  await page.setViewportSize({ width: 1440, height: 900 });
}

/** Replaces the stored settings (everything else default) and lets the page and the background react. */
async function configure(settings) {
  await setStorage({ settings });
  await page.bringToFront();
  await sleep(250);
}

const dnrRules = () => evalInExtension(() => chrome.declarativeNetRequest.getDynamicRules());

/** Waits until the background's dynamic rules satisfy `predicate` (it applies them a moment after the storage change). */
async function waitForRules(predicate, what) {
  const end = Date.now() + 8000;
  let last = [];
  while (Date.now() < end) {
    last = await dnrRules();
    if (predicate(last)) return last;
    await sleep(100);
  }
  throw new Error(`timed out waiting for DNR rules: ${what}; have ${JSON.stringify(last.map((r) => r.condition.regexFilter))}`);
}

/** Navigates and waits for the engine's first settings (and, offline, for the snapshot to be built). */
async function open(url) {
  await page.bringToFront();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  if (page.url().includes('/sorry/')) throw Object.assign(new Error('Google served its captcha page (/sorry/)'), { code: 'YT_SORRY' });
  await page.waitForFunction(() => document.documentElement.getAttribute('data-at-peace') !== null, null, { timeout: 15_000 });
  if (fixtures) await page.waitForFunction(() => document.documentElement.getAttribute('data-fixture-ready') === '1', null, { timeout: 15_000 });
}

const waitFor = (fn, arg, timeout = 20_000) => page.waitForFunction(fn, arg ?? null, { timeout, polling: 100 });

const ourErrors = async () => {
  const diagnostics = await extensionDiagnostics();
  return [...diagnostics.runtimeErrors, ...diagnostics.manifestErrors, ...page.errors.filter((e) => e.includes('[At Peace]') || e.includes('chrome-extension://'))];
};

async function shot(name) {
  await page.screenshot({ path: join(SHOTS, `${name}.png`) });
}

/** Skips a live test when Google served its captcha. */
function live(name, fn) {
  test(name, async (t) => {
    try {
      await fn(t);
    } catch (err) {
      if (err?.code === 'YT_SORRY') return t.skip(`${err.message}; try again later`);
      throw err;
    }
  });
}

// ---------------------------------------------------------------------------------------------
// 1. Offline snapshots
// ---------------------------------------------------------------------------------------------

const haveFixtures = fixturesAvailable(['home', 'search-lofi', 'channel-videos', 'watch-chapters']);

describe('on offline snapshots', { skip: haveFixtures ? false : 'tests/e2e/artifacts/research/*.dom.json are not on this machine (npm run … tools/yt-probe.mjs writes them)' }, () => {
  before(async () => startBrowser({ offline: true }));
  after(async () => close());

  describe('home feed', () => {
    test('feedMode "hide" draws a calm placeholder in place of the feed; clicking it puts the cursor in the search box', async () => {
      await configure({ 'yt.home.feedMode': 'hide' });
      await open(HOME);
      await waitFor(() => document.querySelector('[data-at-peace-placeholder="home"]'));
      const info = await page.evaluate(() => {
        const host = document.querySelector('[data-at-peace-placeholder="home"]');
        const rect = host.getBoundingClientRect();
        const primary = document.querySelector('ytd-browse[page-subtype="home"] #primary');
        return { text: host.getAttribute('data-at-peace-text'), rect: rect.toJSON(), parent: host.parentElement.localName, feedHidden: getComputedStyle(primary).display === 'none', openShadow: host.shadowRoot };
      });
      assert.equal(info.text, 'Your home feed is hidden.');
      assert.equal(info.parent, 'ytd-browse');
      assert.equal(info.feedHidden, true, 'the feed column is hidden by the catalog CSS');
      assert.equal(info.openShadow, null, 'the shadow root is closed');
      assert.ok(info.rect.width > 300 && info.rect.height > 200, 'the placeholder has a real box');
      await shot('home-placeholder');
      await page.mouse.click(info.rect.x + 200, info.rect.y + info.rect.height / 2);
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('name')), 'search_query');
      assert.deepEqual(await ourErrors(), []);
    });

    test('switching the mode live adds and removes the placeholder', async () => {
      await configure({ 'yt.home.feedMode': 'show' });
      await waitFor(() => !document.querySelector('[data-at-peace-placeholder]'));
      await configure({ 'yt.home.feedMode': 'hide' });
      await waitFor(() => document.querySelector('[data-at-peace-placeholder]'));
    });

    test('a redirecting mode: DNR sends a full load of / to the target before any request for the feed', async () => {
      await configure({ 'yt.home.feedMode': 'subscriptions' });
      await waitForRules((rules) => rules.some((r) => r.action.redirect?.regexSubstitution === 'https://www.youtube.com/feed/subscriptions'), 'home → subscriptions');
      fixtures.hits.length = 0;
      await page.goto(HOME, { waitUntil: 'domcontentloaded' });
      assert.equal(page.url(), 'https://www.youtube.com/feed/subscriptions');
      assert.ok(!fixtures.hits.includes(HOME), 'the home page itself was never requested');
    });

    test('in-app: a click on the logo goes to the target without visiting the home page, and Back returns to where the click was', async () => {
      await configure({ 'yt.home.feedMode': 'watchLater' });
      await open(SEARCH);
      fixtures.hits.length = 0;
      await page.click('ytd-masthead a#logo');
      await page.waitForURL('https://www.youtube.com/playlist?list=WL');
      assert.ok(!fixtures.hits.includes(HOME), 'no request for /');
      await page.goBack({ waitUntil: 'domcontentloaded' });
      assert.equal(page.url(), SEARCH, 'history has one entry for the click, not two');
    });

    test('in-app: a script navigating to / (Navigation API) is redirected and does not leave the home page in the history', async () => {
      await configure({ 'yt.home.feedMode': 'subscriptions' });
      await open(SEARCH);
      await page.evaluate(() => history.pushState({}, '', '/'));
      await page.waitForURL('https://www.youtube.com/feed/subscriptions');
      await page.goBack({ waitUntil: 'domcontentloaded' });
      assert.equal(page.url(), SEARCH, 'the pushed home entry was replaced, so Back lands on the page before it');
    });

    test('a custom address works, an invalid one falls back to the placeholder and installs no rule', async () => {
      await configure({ 'yt.home.feedMode': 'custom', 'yt.home.redirectUrl': '/feed/history' });
      await waitForRules((rules) => rules.some((r) => r.action.redirect?.regexSubstitution === 'https://www.youtube.com/feed/history'), 'custom');
      await page.goto(HOME, { waitUntil: 'domcontentloaded' });
      assert.equal(page.url(), 'https://www.youtube.com/feed/history');
      await configure({ 'yt.home.feedMode': 'custom', 'yt.home.redirectUrl': '' });
      await waitForRules((rules) => !rules.some((r) => /feed\/history/.test(r.action.redirect?.regexSubstitution ?? '')), 'rule removed');
      await open(HOME);
      await waitFor(() => document.querySelector('[data-at-peace-placeholder="home"]'));
    });
  });

  describe('Shorts', () => {
    test('watch: Short links point at /watch?v=ID, a click opens the normal player, other links are untouched', async () => {
      await configure({ 'yt.shorts.mode': 'watch' });
      await open(SEARCH);
      await waitFor(() => document.querySelectorAll('a[data-at-peace-href]').length > 0);
      const info = await page.evaluate(() => ({
        left: document.querySelectorAll('a[href^="/shorts/"]').length,
        rewritten: [...document.querySelectorAll('a[data-at-peace-href]')].map((a) => [a.getAttribute('data-at-peace-href'), a.getAttribute('href')]),
        plain: document.querySelector('ytd-video-renderer a#video-title').getAttribute('href').slice(0, 7),
      }));
      assert.equal(info.left, 0);
      assert.ok(info.rewritten.length >= 3);
      for (const [orig, now] of info.rewritten) assert.equal(now, `/watch?v=${orig.split('/shorts/')[1].split(/[?&#]/)[0]}`);
      assert.equal(info.plain, '/watch?');
      fixtures.hits.length = 0;
      await page.evaluate(() => document.querySelector('a[data-at-peace-href]').click());
      await page.waitForURL(/\/watch\?v=[\w-]+$/);
      assert.ok(!fixtures.hits.some((u) => u.includes('/shorts/')), 'Shorts were never requested');
    });

    test('switching to allow restores the links', async () => {
      await configure({ 'yt.shorts.mode': 'watch' });
      await open(SEARCH);
      await waitFor(() => document.querySelectorAll('a[data-at-peace-href]').length > 0);
      await configure({ 'yt.shorts.mode': 'allow' });
      await waitFor(() => document.querySelectorAll('a[data-at-peace-href]').length === 0 && document.querySelectorAll('a[href^="/shorts/"]').length > 0);
    });

    test('block: a click goes to the blocked page with the original URL in the hash; the Navigation API path too', async () => {
      await configure({ 'yt.shorts.mode': 'block' });
      await open(SEARCH);
      const href = await page.evaluate(() => document.querySelector('a[href^="/shorts/"]').getAttribute('href'));
      await page.evaluate(() => document.querySelector('a[href^="/shorts/"]').click());
      await page.waitForURL(/blocked\.html\?reason=shorts#/);
      assert.equal(page.url(), `${extUrl('src/pages/blocked/blocked.html')}?reason=shorts#https://www.youtube.com${href}`);
      await open(SEARCH);
      await page.evaluate((id) => history.pushState({}, '', `/shorts/${id}`), SHORT_ID);
      await page.waitForURL(/blocked\.html\?reason=shorts#/);
      assert.equal(page.url(), `${extUrl('src/pages/blocked/blocked.html')}?reason=shorts#https://www.youtube.com/shorts/${SHORT_ID}`);
    });

    test('DNR: a full load of /shorts/ID goes to /watch?v=ID (watch) or the blocked page (block)', async () => {
      await configure({ 'yt.shorts.mode': 'watch' });
      await waitForRules((rules) => rules.some((r) => (r.action.redirect?.regexSubstitution ?? '').endsWith('/watch?v=\\1')), 'shorts watch');
      await page.goto(`https://www.youtube.com/shorts/${SHORT_ID}`, { waitUntil: 'domcontentloaded' });
      assert.equal(page.url(), `https://www.youtube.com/watch?v=${SHORT_ID}`);
      await configure({ 'yt.shorts.mode': 'block' });
      await waitForRules((rules) => rules.some((r) => (r.action.redirect?.regexSubstitution ?? '').includes('reason=shorts')) && !rules.some((r) => (r.action.redirect?.regexSubstitution ?? '').endsWith('watch?v=\\1')), 'shorts block');
      await page.goto(`https://www.youtube.com/shorts/${SHORT_ID}`, { waitUntil: 'domcontentloaded' });
      assert.equal(page.url(), `${extUrl('src/pages/blocked/blocked.html')}?reason=shorts#https://www.youtube.com/shorts/${SHORT_ID}`);
    });
  });

  describe('channel root', () => {
    test('DNR: a full load of /@handle goes to /videos; sub-tabs are left alone', async () => {
      await configure({ 'yt.channel.openVideosTab': true });
      await waitForRules((rules) => rules.some((r) => (r.action.redirect?.regexSubstitution ?? '').endsWith('/videos')), 'channel');
      await page.goto('https://www.youtube.com/@MrBeast', { waitUntil: 'domcontentloaded' });
      assert.equal(page.url(), 'https://www.youtube.com/@MrBeast/videos');
      await page.goto('https://www.youtube.com/@MrBeast/shorts', { waitUntil: 'domcontentloaded' });
      assert.equal(page.url(), 'https://www.youtube.com/@MrBeast/shorts');
    });

    test('in-app: a click on a channel link goes to its Videos tab; Home tab clicks are respected; unrelated pages are not touched', async () => {
      await configure({ 'yt.channel.openVideosTab': true });
      await open(SEARCH);
      const root = await page.evaluate(() => [...document.querySelectorAll('a[href]')].map((a) => a.getAttribute('href')).find((h) => /^\/@[^/]+$/.test(h)));
      assert.ok(root, 'the results page links to a channel root');
      await page.evaluate((h) => document.querySelector(`a[href="${h}"]`).click(), root);
      await page.waitForURL(`https://www.youtube.com${root}/videos`);
      // On the channel page: pressing the Home tab and navigating to the root is allowed ...
      await open(CHANNEL);
      await page.click('yt-tab-shape >> nth=0'); // the Home tab
      await page.evaluate(() => history.pushState({}, '', '/@MrBeast'));
      await sleep(1200);
      assert.equal(new URL(page.url()).pathname, '/@MrBeast', 'the Home tab click is respected');
      // ... but a navigation nobody asked for is redirected.
      await open(CHANNEL);
      await page.evaluate(() => history.pushState({}, '', '/@SomeoneElse'));
      await page.waitForURL('https://www.youtube.com/@SomeoneElse/videos');
    });
  });

  describe('channel trailer', () => {
    test('hideTrailer: a trailer video that plays (or is already playing) is paused; other videos are left alone', async () => {
      await configure({ 'yt.channel.hideTrailer': true });
      await open(CHANNEL);
      // Real, playing <video> elements fed by a canvas stream (no media file needed).
      const start = (inside) =>
        page.evaluate(async (host) => {
          const canvas = document.createElement('canvas');
          canvas.getContext('2d').fillRect(0, 0, 4, 4);
          const video = document.createElement('video');
          video.muted = true;
          video.srcObject = canvas.captureStream(5);
          const browse = document.querySelector('ytd-browse[page-subtype="channels"]');
          const parent = host ? browse.appendChild(document.createElement(host)) : browse.appendChild(document.createElement('div'));
          parent.append(video);
          video.id = host ? 'trailer-video' : 'other-video';
          await video.play().catch(() => {});
          return true;
        }, inside);
      await start('ytd-channel-video-player-renderer');
      await start(null);
      await waitFor(() => document.querySelector('#trailer-video').paused);
      assert.equal(await page.evaluate(() => document.querySelector('#other-video').paused), false, 'a video outside the trailer keeps playing');
      // switched off: a trailer plays freely
      await configure({});
      await page.evaluate(() => document.querySelector('#trailer-video').play());
      await sleep(500);
      assert.equal(await page.evaluate(() => document.querySelector('#trailer-video').paused), false);
    });
  });

  describe('filters', () => {
    const titlesOf = () => page.evaluate(() => [...document.querySelectorAll('ytd-video-renderer')].map((c) => ({ title: c.querySelector('a#video-title')?.getAttribute('title'), channel: c.querySelector('ytd-channel-name a')?.textContent.trim(), marked: c.hasAttribute('data-at-peace-filtered'), hidden: getComputedStyle(c).display === 'none' })));

    test('keywords hide matching search results (case- and diacritic-insensitive); everything else stays', async () => {
      await configure({});
      await open(SEARCH);
      const before = await titlesOf();
      assert.ok(before.length >= 15 && before.every((c) => !c.marked));
      const word = 'HALLOWEEN';
      await configure({ 'yt.filters.keywords': [word] });
      await waitFor(() => document.querySelector('ytd-video-renderer[data-at-peace-filtered]'));
      const after = await titlesOf();
      for (const card of after) {
        const expected = card.title.toLowerCase().includes('halloween');
        assert.equal(card.marked, expected, card.title);
        assert.equal(card.hidden, expected, `${card.title}: hidden iff marked`);
      }
      assert.ok(after.some((c) => c.marked) && after.some((c) => !c.marked));
    });

    test('changing the list un-marks cards that no longer match; an empty list and the master switch clear everything', async () => {
      await configure({ 'yt.filters.keywords': ['halloween'] });
      await waitFor(() => document.querySelector('[data-at-peace-filtered]'));
      await configure({ 'yt.filters.keywords': ['zzzz-never'] });
      await waitFor(() => !document.querySelector('[data-at-peace-filtered]'));
      await configure({ 'yt.filters.keywords': ['halloween'] });
      await waitFor(() => document.querySelector('[data-at-peace-filtered]'));
      await configure({ 'yt.filters.keywords': ['halloween'], 'general.enabled': false });
      await waitFor(() => !document.querySelector('[data-at-peace-filtered]'));
      await configure({ 'yt.filters.keywords': [] });
      await sleep(200);
      assert.equal(await page.evaluate(() => document.querySelectorAll('[data-at-peace-filtered]').length), 0);
    });

    test('/regex/flags lines work; an invalid one is ignored with one warning and breaks nothing', async () => {
      page.errors.length = 0;
      const warnings = [];
      page.on('console', (m) => m.type() === 'warning' && m.text().includes('filter ignored') && warnings.push(m.text()));
      await configure({ 'yt.filters.keywords': ['/^24\\/7/i', '/(unclosed/'] });
      await waitFor(() => document.querySelector('[data-at-peace-filtered]'));
      const marked = (await titlesOf()).filter((c) => c.marked).map((c) => c.title);
      assert.ok(marked.length >= 1 && marked.every((t) => /^24\/7/i.test(t)), JSON.stringify(marked));
      await configure({ 'yt.filters.keywords': ['/^24\\/7/i', '/(unclosed/', 'x'] }); // another change: still one warning
      await sleep(300);
      assert.equal(warnings.length, 1, warnings.join('|'));
      assert.deepEqual(await ourErrors(), []);
    });

    test('channels: by name and by @handle (from the link); applyTo scopes the surface', async () => {
      const channel = (await titlesOf()).find((c) => c.channel).channel;
      await configure({ 'yt.filters.channels': [channel] });
      await waitFor(() => document.querySelector('ytd-video-renderer[data-at-peace-filtered]'));
      const byName = await titlesOf();
      assert.ok(byName.filter((c) => c.channel === channel).every((c) => c.marked));
      const id = await page.evaluate(() => document.querySelector('ytd-video-renderer ytd-channel-name a').getAttribute('href').split('/channel/')[1]);
      await configure({ 'yt.filters.channels': [id] });
      await waitFor(() => document.querySelector('ytd-video-renderer[data-at-peace-filtered]'));
      assert.ok((await titlesOf()).some((c) => c.marked), 'a channel id matches through the channel link');
      // a card whose channel link is a /@handle (as on pages that use handles)
      await page.evaluate(() => {
        const a = document.querySelectorAll('ytd-video-renderer ytd-channel-name a')[1];
        a.setAttribute('href', '/@Some-Handle');
        a.closest('ytd-video-renderer').id = 'handle-card';
      });
      await configure({ 'yt.filters.channels': ['@some-handle'] });
      await waitFor(() => document.querySelector('#handle-card[data-at-peace-filtered]'));
      assert.equal(await page.evaluate(() => document.querySelectorAll('ytd-video-renderer[data-at-peace-filtered]').length), 1, 'only the card with that handle');
      await configure({ 'yt.filters.channels': ['@some-handle'], 'yt.filters.applyTo': ['home'] });
      await waitFor(() => !document.querySelector('[data-at-peace-filtered]'));
      await configure({ 'yt.filters.channels': ['@some-handle'], 'yt.filters.applyTo': ['search'] });
      await waitFor(() => document.querySelector('#handle-card[data-at-peace-filtered]'));
    });

    test('cards that appear later (infinite scroll) and cards whose text arrives late are filtered too', async () => {
      await configure({ 'yt.filters.keywords': ['late-arrival-keyword'] });
      await sleep(300);
      await page.evaluate(() => {
        const list = document.querySelector('ytd-video-renderer').parentElement;
        const card = document.querySelector('ytd-video-renderer').cloneNode(true);
        const title = card.querySelector('a#video-title');
        title.setAttribute('title', '');
        title.querySelector('yt-formatted-string').textContent = '';
        card.id = 'late-card';
        list.append(card);
        // the text arrives after the card was inserted
        setTimeout(() => {
          title.setAttribute('title', 'Something with LATE-arrival-Keyword inside');
          title.querySelector('yt-formatted-string').textContent = 'Something with LATE-arrival-Keyword inside';
        }, 500);
      });
      await waitFor(() => document.querySelector('#late-card[data-at-peace-filtered]'), null, 6000);
    });

    test('watch sidebar and comments (watch snapshot)', async () => {
      await configure({});
      await open(WATCH);
      const sample = await page.evaluate(() => ({
        related: [...document.querySelectorAll('#related yt-lockup-view-model a.ytLockupMetadataViewModelTitle')].map((a) => a.textContent.trim()),
        comment: document.querySelector('ytd-comment-thread-renderer #content-text').textContent.trim(),
      }));
      const word = sample.related.find((t) => t.length > 8).split(/\s+/).find((w) => w.length > 5);
      const commentWord = sample.comment.split(/\s+/).find((w) => w.length > 6);
      await configure({ 'yt.filters.keywords': [word], 'yt.filters.commentKeywords': [commentWord] });
      await waitFor(() => document.querySelector('#related yt-lockup-view-model[data-at-peace-filtered]'));
      const state = await page.evaluate((w) => ({
        cards: [...document.querySelectorAll('#related yt-lockup-view-model')].map((c) => [c.querySelector('a.ytLockupMetadataViewModelTitle').textContent.toLowerCase().includes(w.toLowerCase()), c.hasAttribute('data-at-peace-filtered'), getComputedStyle(c).display === 'none']),
        threads: [...document.querySelectorAll('ytd-comment-thread-renderer')].map((c) => [c.querySelector('#content-text').textContent.toLowerCase().includes(w.toLowerCase()), c.hasAttribute('data-at-peace-filtered')]),
      }), word);
      for (const [match, marked, hidden] of state.cards) {
        assert.equal(marked, match);
        assert.equal(hidden, match);
      }
      assert.ok(state.cards.some(([m]) => m));
      await waitFor((cw) => [...document.querySelectorAll('ytd-comment-thread-renderer')].some((c) => c.hasAttribute('data-at-peace-filtered') && c.querySelector('#content-text').textContent.toLowerCase().includes(cw.toLowerCase())), commentWord);
      // watch is not in applyTo any more: the sidebar is shown again, comments still follow commentKeywords
      await configure({ 'yt.filters.keywords': [word], 'yt.filters.commentKeywords': [commentWord], 'yt.filters.applyTo': ['home'] });
      await waitFor(() => !document.querySelector('#related [data-at-peace-filtered]'));
    });
  });

  describe('calm titles', () => {
    test('shouting words become sentence case, the original is kept, turning it off restores it, new titles are converted', async () => {
      await configure({});
      await open(SEARCH);
      await page.evaluate(() => {
        const t = document.querySelector('ytd-video-renderer a#video-title yt-formatted-string');
        t.textContent = 'I TRIED THE BIGGEST PIZZA IN THE USA';
      });
      await configure({ 'yt.general.calmTitles': 'sentence' });
      await waitFor(() => document.querySelector('ytd-video-renderer a#video-title yt-formatted-string').textContent === 'I tried the biggest pizza in the USA');
      assert.equal(await page.evaluate(() => document.querySelector('ytd-video-renderer a#video-title yt-formatted-string').getAttribute('data-at-peace-original')), 'I TRIED THE BIGGEST PIZZA IN THE USA');
      // a card added later
      await page.evaluate(() => {
        const card = document.querySelector('ytd-video-renderer').cloneNode(true);
        card.id = 'new-card';
        card.querySelector('a#video-title yt-formatted-string').textContent = 'WHY NOBODY TALKS ABOUT THIS';
        document.querySelector('ytd-video-renderer').parentElement.append(card);
      });
      await waitFor(() => document.querySelector('#new-card a#video-title yt-formatted-string').textContent === 'Why nobody talks about this');
      // the originals are kept (the snapshot has a few shouting titles of its own, so look at ours)
      assert.deepEqual(
        await page.evaluate(() => ['ytd-video-renderer a#video-title yt-formatted-string', '#new-card a#video-title yt-formatted-string'].map((sel) => document.querySelector(sel).getAttribute('data-at-peace-original'))),
        ['I TRIED THE BIGGEST PIZZA IN THE USA', 'WHY NOBODY TALKS ABOUT THIS'],
      );
      await configure({});
      await waitFor(() => document.querySelector('ytd-video-renderer a#video-title yt-formatted-string').textContent === 'I TRIED THE BIGGEST PIZZA IN THE USA');
      assert.equal(await page.evaluate(() => document.querySelectorAll('[data-at-peace-original]').length), 0);
    });

    test('the video page title (a different element) is converted too', async () => {
      await open(WATCH);
      await page.evaluate(() => {
        document.querySelector('ytd-watch-metadata h1 yt-formatted-string').textContent = 'THE LONGEST LOFI STREAM EVER';
      });
      await configure({ 'yt.general.calmTitles': 'sentence' });
      await waitFor(() => document.querySelector('ytd-watch-metadata h1 yt-formatted-string').textContent === 'The longest lofi stream ever');
    });
  });

  describe('bridge tags (MAIN world)', () => {
    test('the bridge announces itself; no tag exists while no setting needs one', async () => {
      await configure({});
      await open(HOME);
      assert.equal(await page.evaluate(() => document.documentElement.getAttribute('data-at-peace-bridge')), '1');
      assert.equal(await page.evaluate(() => document.querySelectorAll('[data-at-peace-entry], [data-at-peace-tab], [data-at-peace-action]').length), 0);
    });

    test('guide entries are tagged from `entry.data` (shapes observed live), and untagged again when the setting goes off', async () => {
      await page.evaluate(() => {
        const nav = (url, browseId) => ({ commandMetadata: { webCommandMetadata: { url } }, browseEndpoint: { browseId } });
        const entries = [...document.querySelectorAll('ytd-guide-entry-renderer')];
        const data = [
          { navigationEndpoint: nav('/', 'FEwhat_to_watch'), icon: { iconType: 'TAB_HOME_CAIRO' } },
          { serviceEndpoint: { reelWatchEndpoint: {} }, icon: { iconType: 'TAB_SHORTS_CAIRO' } },
          { navigationEndpoint: nav('/feed/subscriptions', 'FEsubscriptions'), icon: { iconType: 'TAB_SUBSCRIPTIONS_CAIRO' } },
          { navigationEndpoint: nav('/feed/you', 'FElibrary'), icon: { iconType: 'ACCOUNT_CIRCLE_CAIRO' } },
          { navigationEndpoint: nav('/feed/history', 'FEhistory'), icon: { iconType: 'WATCH_HISTORY_CAIRO' } },
          { navigationEndpoint: nav('/playlist?list=WL', 'VLWL'), icon: { iconType: 'WATCH_LATER_CAIRO' } },
        ];
        data.forEach((d, i) => entries[i] && (entries[i].data = d));
        window.__entryCount = Math.min(data.length, entries.length);
      });
      await configure({ 'yt.guide.hideWatchLater': true });
      await waitFor(() => document.querySelectorAll('ytd-guide-entry-renderer[data-at-peace-entry]').length >= 5);
      const tags = await page.evaluate(() => [...document.querySelectorAll('ytd-guide-entry-renderer')].slice(0, 6).map((e) => e.getAttribute('data-at-peace-entry')));
      assert.deepEqual(tags.slice(0, 5), ['home', 'shorts', 'subscriptions', 'you', 'history']);
      await configure({});
      await waitFor(() => document.querySelectorAll('[data-at-peace-entry]').length === 0);
    });

    test('channel tabs are tagged by matching the page data\'s tab list to the DOM titles; a CSS rule that only knows the tag hides the right tab', async () => {
      await open(CHANNEL);
      const dom = await page.evaluate(() => [...document.querySelectorAll('yt-tab-shape')].map((t) => t.getAttribute('tab-title')));
      assert.deepEqual(dom.slice(0, 5), ['Home', 'Videos', 'Shorts', 'Shows', 'Posts']);
      await page.evaluate(() => {
        const url = { Home: 'featured', Videos: 'videos', Shorts: 'shorts', Shows: 'podcasts', Posts: 'posts' };
        const tab = (title, suffix) => ({ tabRenderer: { title, endpoint: { commandMetadata: { webCommandMetadata: { url: `/@MrBeast/${suffix}` } } } } });
        const browse = document.querySelector('ytd-browse[page-subtype="channels"]');
        browse.data = { contents: { twoColumnBrowseResultsRenderer: { tabs: [...Object.entries(url).map(([t, s]) => tab(t, s)), { expandableTabRenderer: { title: 'Search', endpoint: { commandMetadata: { webCommandMetadata: { url: '/@MrBeast/search' } } } } }] } } };
      });
      await configure({ 'yt.channel.hideShortsTab': true });
      await waitFor(() => document.querySelectorAll('yt-tab-shape[data-at-peace-tab]').length >= 5);
      const tags = await page.evaluate(() => [...document.querySelectorAll('yt-tab-shape')].map((t) => [t.getAttribute('tab-title'), t.getAttribute('data-at-peace-tab'), getComputedStyle(t).display === 'none']));
      assert.deepEqual(tags.slice(0, 5).map(([, tag]) => tag), ['home', 'videos', 'shorts', 'podcasts', 'posts']);
      assert.equal(tags[5][1], null, 'the untitled search tab is not tagged');
      assert.deepEqual(tags.slice(0, 5).map(([, , hidden]) => hidden), [false, false, true, false, false], 'only the Shorts tab is hidden');
      await configure({});
      await waitFor(() => document.querySelectorAll('[data-at-peace-tab]').length === 0);
    });

    test('watch action buttons: the button HOSTS are tagged (never a container), from the view-model data', async () => {
      await open(WATCH);
      await page.evaluate(() => {
        // the shapes observed live: yt-button-view-model.componentProps.data, ytd-download-button-renderer.data
        const menu = document.querySelector('ytd-watch-metadata #actions ytd-menu-renderer');
        const [like, share] = menu.querySelectorAll('#top-level-buttons-computed > *');
        const [download, save] = menu.querySelectorAll('#flexible-item-buttons > *');
        like.componentProps = { data: { likeButtonViewModel: {}, dislikeButtonViewModel: {} } };
        share.componentProps = { data: { iconName: 'SHARE', accessibilityId: 'id.video.share.button' } };
        download.data = { targetId: 'watch-download-button' };
        save.componentProps = { data: { iconName: 'PLAYLIST_ADD', title: 'Save' } };
        // an extra host that only the tag can identify: Thanks
        const thanks = document.createElement('yt-button-view-model');
        thanks.id = 'thanks-host';
        thanks.componentProps = { data: { iconName: 'MONEY_HEART' } };
        thanks.textContent = 'Thanks';
        menu.querySelector('#top-level-buttons-computed').append(thanks);
      });
      await configure({ 'yt.watch.hideThanks': true });
      await waitFor(() => document.querySelector('#thanks-host[data-at-peace-action="thanks"]'));
      const info = await page.evaluate(() => ({
        tags: [...document.querySelectorAll('ytd-watch-metadata [data-at-peace-action]')].map((e) => [e.localName + (e.getAttribute('id') ? `#${e.getAttribute('id')}` : ''), e.getAttribute('data-at-peace-action')]),
        thanksHidden: getComputedStyle(document.querySelector('#thanks-host')).display === 'none',
        shareVisible: getComputedStyle(document.querySelector('ytd-watch-metadata #top-level-buttons-computed > yt-button-view-model')).display !== 'none',
      }));
      const byName = Object.fromEntries(info.tags.map(([el, tag]) => [tag, el]));
      assert.equal(byName.like, 'segmented-like-dislike-button-view-model');
      assert.equal(byName.share, 'yt-button-view-model');
      assert.equal(byName.download, 'ytd-download-button-renderer');
      assert.equal(byName.save, 'yt-button-view-model');
      assert.equal(byName.more, 'yt-button-shape#button-shape');
      assert.equal(byName.join, 'div#sponsor-button');
      assert.equal(byName.thanks, 'yt-button-view-model#thanks-host');
      for (const [el] of info.tags) assert.ok(!/^(ytd-menu-renderer|div#(actions|actions-inner|menu|top-level-buttons-computed|flexible-item-buttons))$/.test(el), `a container was tagged: ${el}`);
      assert.equal(info.thanksHidden, true);
      assert.equal(info.shareVisible, true);
    });
  });

  describe('behaviours (stand-in player: an object with the player API\'s methods)', () => {
    /** A page whose `#movie_player` records API calls and whose video + controls behave like the real ones. */
    async function openWatchWithPlayer() {
      await open(WATCH);
      await page.evaluate(() => {
        const player = document.querySelector('#movie_player');
        const video = document.querySelector('ytd-watch-flexy video') ?? player.appendChild(document.createElement('video'));
        video.classList.add('html5-main-video');
        if (!player.contains(video)) player.append(video);
        player.calls = [];
        player.setAutonav = (on) => player.calls.push(['setAutonav', on]);
        player.pauseVideo = () => {
          player.calls.push(['pauseVideo']);
        };
        player.setPlaybackRate = (n) => {
          player.calls.push(['setPlaybackRate', n]);
          video.playbackRate = n;
        };
        player.getPlaybackRate = () => video.playbackRate;
        player.updateLastActiveTime = () => player.calls.push(['updateLastActiveTime']);
        const flexy = document.querySelector('ytd-watch-flexy');
        flexy.removeAttribute('theater');
        const toggle = document.querySelector('.ytp-autonav-toggle');
        const inner = toggle.querySelector('.ytp-autonav-toggle-button');
        inner.setAttribute('aria-checked', 'true');
        toggle.addEventListener('click', () => inner.setAttribute('aria-checked', inner.getAttribute('aria-checked') === 'true' ? 'false' : 'true'));
        document.querySelector('.ytp-size-button').addEventListener('click', () => (flexy.hasAttribute('theater') ? flexy.removeAttribute('theater') : flexy.setAttribute('theater', '')));
      });
    }
    const calls = () => page.evaluate(() => document.querySelector('#movie_player').calls);

    test('autoplay off: the toggle is clicked off once, the player API is told, a toggle that is already off is left alone', async () => {
      await configure({});
      await openWatchWithPlayer();
      await configure({ 'yt.watch.disableAutoplay': true });
      await waitFor(() => document.querySelector('.ytp-autonav-toggle-button').getAttribute('aria-checked') === 'false');
      await waitFor(() => document.querySelector('#movie_player').calls.some(([name]) => name === 'setAutonav'));
      assert.deepEqual((await calls()).filter(([n]) => n === 'setAutonav'), [['setAutonav', false]]);
      await sleep(2200); // the re-checks run; the toggle stays off and is not clicked back on
      assert.equal(await page.evaluate(() => document.querySelector('.ytp-autonav-toggle-button').getAttribute('aria-checked')), 'false');
    });

    test('theater: the size button is pressed once when the layout is not theater, and never again for that video', async () => {
      await configure({});
      await openWatchWithPlayer();
      await configure({ 'yt.watch.autoTheater': true });
      await waitFor(() => document.querySelector('ytd-watch-flexy').hasAttribute('theater'), null, 6000);
      assert.match(await page.evaluate(() => document.cookie), /wide=1/);
      // the user leaves theater: it is not forced back
      await page.evaluate(() => document.querySelector('.ytp-size-button').click());
      await sleep(1800);
      assert.equal(await page.evaluate(() => document.querySelector('ytd-watch-flexy').hasAttribute('theater')), false);
    });

    test('speed: set through the player API when metadata loads; a speed the user chose wins for that video; a new video gets the default again', async () => {
      await configure({});
      await openWatchWithPlayer();
      await configure({ 'yt.watch.defaultSpeed': '1.5' });
      await page.evaluate(() => document.querySelector('ytd-watch-flexy video').dispatchEvent(new Event('loadedmetadata')));
      await waitFor(() => document.querySelector('#movie_player').getPlaybackRate() === 1.5);
      assert.deepEqual((await calls()).filter(([n]) => n === 'setPlaybackRate'), [['setPlaybackRate', 1.5]]);
      // the user presses ">" (a real key press) and the speed changes: the feature steps aside
      await page.keyboard.press('Shift+Period');
      await page.evaluate(() => {
        document.querySelector('ytd-watch-flexy video').playbackRate = 1.75;
      });
      await sleep(300);
      await page.evaluate(() => document.querySelector('ytd-watch-flexy video').dispatchEvent(new Event('playing')));
      await sleep(400);
      assert.equal(await page.evaluate(() => document.querySelector('ytd-watch-flexy video').playbackRate), 1.75, 'the user\'s speed is kept');
      // a new video: the default is applied again
      await page.evaluate(() => {
        history.pushState({}, '', '/watch?v=SECONDvideo1');
        window.dispatchEvent(new CustomEvent('yt-navigate-finish'));
        document.querySelector('ytd-watch-flexy video').dispatchEvent(new Event('loadedmetadata'));
      });
      await waitFor(() => document.querySelector('ytd-watch-flexy video').playbackRate === 1.5);
    });

    test('no auto-start: the first play of each video that the user did not ask for is paused once; a click on the player is respected', async () => {
      await configure({});
      await openWatchWithPlayer();
      // A real playing <video> (canvas stream) that the stand-in player's pauseVideo() really pauses.
      await page.evaluate(() => {
        const player = document.querySelector('#movie_player');
        const old = document.querySelector('ytd-watch-flexy video');
        const video = document.createElement('video');
        video.className = 'html5-main-video';
        video.muted = true;
        const canvas = document.createElement('canvas');
        canvas.getContext('2d').fillRect(0, 0, 4, 4);
        video.srcObject = canvas.captureStream(5);
        old.replaceWith(video);
        player.pauseVideo = () => {
          player.calls.push(['pauseVideo']);
          video.pause();
        };
      });
      await configure({ 'yt.watch.noAutoStart': true });
      await sleep(300);
      await page.evaluate(() => document.querySelector('ytd-watch-flexy video').play());
      await waitFor(() => document.querySelector('ytd-watch-flexy video').paused);
      assert.equal((await calls()).filter(([n]) => n === 'pauseVideo').length, 1);
      // the user presses play on the same video afterwards: not fought (once per video)
      await sleep(1100); // (a start within 0.8 s of our pause that nobody asked for would be paused once more)
      await page.keyboard.press('k');
      await page.evaluate(() => document.querySelector('ytd-watch-flexy video').play());
      await sleep(1200);
      assert.equal(await page.evaluate(() => document.querySelector('ytd-watch-flexy video').paused), false, 'playing again is left alone');
      assert.equal((await calls()).filter(([n]) => n === 'pauseVideo').length, 1, 'once per video: the user is never fought afterwards');
      // a new video, and this time the user clicks in the player after the navigation began
      await page.evaluate(() => {
        document.querySelector('ytd-watch-flexy video').pause();
        window.dispatchEvent(new CustomEvent('yt-navigate-start'));
        history.pushState({}, '', '/watch?v=THIRDvideo123');
      });
      await sleep(150);
      const box = await page.evaluate(() => {
        const r = document.querySelector('ytd-watch-flexy ytd-player').getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      await page.mouse.click(box.x, box.y);
      await page.evaluate(() => document.querySelector('ytd-watch-flexy video').play());
      await sleep(1200);
      assert.equal(await page.evaluate(() => document.querySelector('ytd-watch-flexy video').paused), false, 'a video the user started keeps playing');
      assert.equal((await calls()).filter(([n]) => n === 'pauseVideo').length, 1);
      // and a third video nobody asked for is paused again
      await page.evaluate(() => {
        document.querySelector('ytd-watch-flexy video').pause();
        window.dispatchEvent(new CustomEvent('yt-navigate-start'));
        history.pushState({}, '', '/watch?v=FOURTHvideo12');
        document.querySelector('ytd-watch-flexy video').play();
      });
      await waitFor(() => document.querySelector('ytd-watch-flexy video').paused);
      assert.equal((await calls()).filter(([n]) => n === 'pauseVideo').length, 2);
    });

    test('still watching: the page is kept "active" through the bridge; a confirm dialog right after the user\'s own click is never dismissed', async () => {
      await configure({});
      await openWatchWithPlayer();
      await page.evaluate(() => {
        window._lact = 1;
      });
      await configure({ 'yt.watch.dismissStillWatching': true });
      await waitFor(() => window._lact > 1000 && Date.now() - window._lact < 5000, null, 6000);
      assert.ok((await calls()).some(([n]) => n === 'updateLastActiveTime'));
      // a confirm dialog the user just caused (they clicked a moment ago) is theirs
      await page.mouse.click(300, 300);
      await page.evaluate(() => {
        window.__confirmed = 0;
        const popup = document.querySelector('ytd-popup-container') ?? document.body.appendChild(document.createElement('ytd-popup-container'));
        const dialog = document.createElement('yt-confirm-dialog-renderer');
        const wrap = document.createElement('div');
        wrap.id = 'confirm-button';
        const button = document.createElement('button');
        button.textContent = 'OK';
        button.addEventListener('click', () => window.__confirmed++);
        wrap.append(button);
        dialog.append(wrap);
        popup.append(dialog);
      });
      await sleep(800);
      assert.equal(await page.evaluate(() => window.__confirmed), 0);
    });

    test('layout nudge: a resize event follows each layout-affecting setting change, once at once and once later', async () => {
      await configure({});
      await openWatchWithPlayer();
      await page.evaluate(() => {
        window.__resizes = 0;
        window.addEventListener('resize', () => window.__resizes++);
      });
      await configure({ 'yt.watch.hideRelated': true });
      await waitFor(() => window.__resizes >= 1);
      await waitFor(() => window.__resizes >= 2, null, 3000);
      await sleep(900);
      assert.equal(await page.evaluate(() => window.__resizes), 2, 'two nudges, no storm');
      await configure({ 'yt.watch.hideRelated': false });
      await waitFor(() => window.__resizes >= 4, null, 3000);
    });
  });

  describe('small guards', () => {
    test('hover previews: pointer-enter events on a thumbnail never reach the page while the setting is on; controls over it keep theirs', async () => {
      await configure({});
      await open(SEARCH);
      await page.evaluate(() => {
        window.__enter = 0;
        for (const t of document.querySelectorAll('ytd-thumbnail')) t.addEventListener('mouseover', () => window.__enter++);
      });
      const box = await page.evaluate(() => {
        const r = document.querySelector('ytd-video-renderer ytd-thumbnail').getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      await page.mouse.move(box.x, box.y - 80);
      await page.mouse.move(box.x, box.y);
      assert.ok((await page.evaluate(() => window.__enter)) > 0, 'with the setting off the page sees the hover');
      await configure({ 'yt.general.disableHoverPreview': true });
      await page.evaluate(() => (window.__enter = 0));
      await page.mouse.move(box.x, box.y - 80);
      await page.mouse.move(box.x, box.y);
      assert.equal(await page.evaluate(() => window.__enter), 0, 'the hover trigger is swallowed');
    });

    test('search suggestions: ArrowDown/ArrowUp in the search box never reach YouTube\'s handler while hidden; other keys do', async () => {
      await configure({});
      await open(SEARCH);
      await page.evaluate(() => {
        window.__keys = [];
        document.querySelector('input[name="search_query"]').addEventListener('keydown', (e) => window.__keys.push(e.key));
      });
      await page.focus('input[name="search_query"]');
      await page.keyboard.press('ArrowDown');
      assert.deepEqual(await page.evaluate(() => window.__keys), ['ArrowDown']);
      await configure({ 'yt.masthead.hideSearchSuggestions': true });
      await page.evaluate(() => (window.__keys = []));
      await page.focus('input[name="search_query"]');
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowUp');
      await page.keyboard.press('a');
      assert.deepEqual(await page.evaluate(() => window.__keys), ['a']);
    });

    test('no errors from our code anywhere in this group', async () => {
      assert.deepEqual(await ourErrors(), []);
    });
  });
});

// ---------------------------------------------------------------------------------------------
// 2. Live youtube.com
// ---------------------------------------------------------------------------------------------

describe('on live youtube.com (logged out)', () => {
  const PAUSE_MS = Number(process.env.FEATURES_PAUSE_MS ?? 12_000);
  let lastLoad = 0;
  before(async () => startBrowser({ offline: false }));
  after(async () => close());

  /** Loads a page at most once every PAUSE_MS (Google rate-limits bursts with a captcha). */
  async function paced(url) {
    const wait = lastLoad + PAUSE_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastLoad = Date.now();
    await open(url);
  }

  live('home: the placeholder, redirect modes and the guide-entry tags on the real page', async () => {
    await configure({ 'yt.home.feedMode': 'hide', 'yt.guide.hideWatchLater': true });
    await paced(HOME);
    await waitFor(() => document.querySelector('[data-at-peace-placeholder="home"]'));
    await waitFor(() => document.querySelectorAll('ytd-guide-entry-renderer[data-at-peace-entry]').length >= 4);
    const tags = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('ytd-guide-entry-renderer[data-at-peace-entry]')].map((e) => [e.getAttribute('data-at-peace-entry'), e.querySelector('a#endpoint')?.getAttribute('href') ?? null])));
    assert.deepEqual(tags, { home: '/', shorts: null, subscriptions: '/feed/subscriptions', you: '/feed/you', history: '/feed/history' });
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('ytd-browse[page-subtype="home"] #primary')).display), 'none');
    await shot('live-home-placeholder');
    // the mini guide (collapsed rail) too: the narrow layout renders its entries
    await page.setViewportSize({ width: 1100, height: 800 });
    await waitFor(() => document.querySelectorAll('ytd-mini-guide-entry-renderer[data-at-peace-entry]').length >= 3, null, 8000).catch(() => null);
    const mini = await page.evaluate(() => [...document.querySelectorAll('ytd-mini-guide-entry-renderer')].map((e) => e.getAttribute('data-at-peace-entry')));
    await page.setViewportSize({ width: 1440, height: 900 });
    assert.ok(mini.length === 0 || mini.slice(0, 3).join() === 'home,shorts,subscriptions', `mini guide tags: ${mini}`);
    // a redirecting mode: in-app click on the logo (from a search page) → straight to the target
    await configure({ 'yt.home.feedMode': 'subscriptions' });
    await paced(SEARCH);
    await page.click('ytd-masthead a#logo');
    await page.waitForURL('https://www.youtube.com/feed/subscriptions', { timeout: 15_000 });
    assert.deepEqual(await ourErrors(), []);
  });

  live('search: filters, calm titles, Shorts links and the Shorts click on the real results', async () => {
    await configure({ 'yt.filters.keywords': ['lofi'], 'yt.shorts.mode': 'watch', 'yt.general.calmTitles': 'sentence' });
    await paced(SEARCH);
    await waitFor(() => document.querySelectorAll('ytd-video-renderer').length >= 10);
    await waitFor(() => document.querySelector('[data-at-peace-filtered]'));
    // Cards are filled in progressively: wait until every card agrees with the filter (no card disagreeing for a moment).
    const disagreeing = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('ytd-video-renderer')]
          .map((c) => [c.querySelector('a#video-title')?.getAttribute('title') ?? null, c.hasAttribute('data-at-peace-filtered'), getComputedStyle(c).display === 'none'])
          .filter(([title, marked, hidden]) => title !== null && (marked !== title.toLowerCase().includes('lofi') || hidden !== marked)),
      );
    // (the list keeps growing for a moment while YouTube renders: judge it once the number of cards has settled)
    let count = -1;
    for (let stable = 0; stable < 3; ) {
      await sleep(500);
      const now = await page.evaluate(() => document.querySelectorAll('ytd-video-renderer').length);
      stable = now === count ? stable + 1 : 0;
      count = now;
    }
    await waitFor(() => [...document.querySelectorAll('ytd-video-renderer')].every((c) => { const t = c.querySelector('a#video-title')?.getAttribute('title'); return t == null || c.hasAttribute('data-at-peace-filtered') === t.toLowerCase().includes('lofi'); }), null, 6000).catch(() => null);
    assert.deepEqual(await disagreeing(), [], 'every card agrees with the filter');
    const info = await page.evaluate(() => ({
      shortsLeft: document.querySelectorAll('a[href^="/shorts/"]').length,
      shortsRewritten: document.querySelectorAll('a[data-at-peace-href]').length,
    }));
    assert.equal(info.shortsLeft, 0);
    await shot('live-search-filtered');
    if (info.shortsRewritten > 0) {
      const requests = [];
      page.on('request', (r) => r.isNavigationRequest() && requests.push(r.url()));
      const id = await page.evaluate(() => document.querySelector('a[data-at-peace-href]').getAttribute('data-at-peace-href').split('/shorts/')[1].split(/[?&#]/)[0]);
      await page.evaluate(() => document.querySelector('a[data-at-peace-href]').click());
      await page.waitForURL((u) => u.href.includes(id) && !u.href.includes('/shorts/'), { timeout: 15_000 });
      assert.ok(requests.some((u) => u.includes(`/watch?v=${id}`)), `a navigation to /watch?v=${id}: ${requests.join(' ')}`);
      assert.ok(!requests.some((u) => u.includes('/shorts/')));
    }
    assert.deepEqual(await ourErrors(), []);
  });

  live('watch (reached by an in-app click, which Google does not rate-limit): action tags, theater, autoplay switch, speed, keep-alive, layout nudge', async () => {
    await configure({
      'yt.watch.hideThanks': true, // switches the tagging on
      'yt.watch.autoTheater': true,
      'yt.watch.disableAutoplay': true,
      'yt.watch.defaultSpeed': '1.5',
      'yt.watch.dismissStillWatching': true,
    });
    await paced('https://www.youtube.com/results?search_query=how+to+cook+rice'); // not a live stream: no chat column to keep #secondary
    await page.locator('ytd-video-renderer a#video-title').first().click();
    await page.waitForURL(/\/watch\?v=/, { timeout: 20_000 });
    await waitFor(() => document.querySelector('ytd-watch-metadata #top-level-buttons-computed > *'), null, 20_000);
    await waitFor(() => document.querySelectorAll('ytd-watch-metadata [data-at-peace-action]').length >= 3, null, 15_000);
    const tags = await page.evaluate(() => [...document.querySelectorAll('ytd-watch-metadata [data-at-peace-action]')].map((e) => [e.localName + (e.getAttribute('id') ? `#${e.getAttribute('id')}` : ''), e.getAttribute('data-at-peace-action')]));
    const byTag = Object.fromEntries(tags.map(([el, tag]) => [tag, el]));
    assert.equal(byTag.like, 'segmented-like-dislike-button-view-model', JSON.stringify(tags));
    assert.equal(byTag.share, 'yt-button-view-model');
    assert.equal(byTag.download, 'ytd-download-button-renderer');
    assert.equal(byTag.save, 'yt-button-view-model');
    assert.equal(byTag.more, 'yt-button-shape#button-shape');
    for (const [el] of tags) assert.ok(!/^(ytd-menu-renderer|div#(actions|actions-inner|menu|top-level-buttons-computed|flexible-item-buttons))$/.test(el), `a container was tagged: ${el}`);

    // theater: attribute on the layout and the cookie
    await waitFor(() => document.querySelector('ytd-watch-flexy').hasAttribute('theater'), null, 15_000);
    assert.match(await page.evaluate(() => document.cookie), /wide=1/);
    // autoplay switch: off
    await waitFor(() => document.querySelector('ytd-watch-flexy .ytp-autonav-toggle-button')?.getAttribute('aria-checked') === 'false', null, 15_000);
    // speed: through the player API
    await waitFor(() => document.querySelector('#movie_player')?.getPlaybackRate?.() === 1.5, null, 15_000).catch(async (err) => {
      throw new Error(`${err.message}; rate=${await page.evaluate(() => document.querySelector('#movie_player')?.getPlaybackRate?.())}`);
    });
    // keep-alive: _lact is refreshed (on every navigation and every minute) although nobody touched the page
    await page.evaluate(() => {
      window._lact = 1;
      window.dispatchEvent(new CustomEvent('yt-navigate-finish'));
    });
    await waitFor(() => Date.now() - window._lact < 5000, null, 10_000);

    // layout nudge: with the related column collapsed, the player's control bar spans the player
    // (theater makes the player full width already: leave it, with the theater setting off, to see the column's effect)
    await configure({ 'yt.watch.hideThanks': true });
    await page.evaluate(() => document.querySelector('ytd-watch-flexy button.ytp-size-button').click());
    await waitFor(() => !document.querySelector('ytd-watch-flexy').hasAttribute('theater'));
    await sleep(800);
    const narrow = await page.evaluate(() => document.querySelector('ytd-watch-flexy #movie_player')?.getBoundingClientRect().width);
    await configure({ 'yt.watch.hideThanks': true, 'yt.watch.hideRelated': true });
    await sleep(700); // measured: with the CSS change alone (no nudge) the control bar is still at its old width after 600 ms
    const bars = await page.evaluate(() => {
      const player = document.querySelector('ytd-watch-flexy #movie_player');
      const bar = player?.querySelector('.ytp-chrome-bottom');
      return { player: player?.getBoundingClientRect().width, bar: bar?.getBoundingClientRect().width };
    });
    await shot('live-watch-related-hidden');
    assert.ok(bars.player > 0 && bars.bar > 0, JSON.stringify(bars));
    assert.ok(bars.player > narrow + 100, `the player grew when the related column was hidden (${narrow} → ${bars.player})`);
    assert.ok(bars.bar >= bars.player - 30, `the control bar (${bars.bar}px) spans the player (${bars.player}px)`);
    assert.deepEqual(await ourErrors(), []);
  });

  live('channel: tabs tagged from the page data; the Videos-tab redirect through DNR and in-app', async () => {
    await configure({ 'yt.channel.hideShortsTab': true, 'yt.channel.hidePostsTab': true });
    await paced('https://www.youtube.com/@veritasium/videos');
    await waitFor(() => document.querySelectorAll('yt-tab-shape[data-at-peace-tab]').length >= 4, null, 15_000);
    const tabs = await page.evaluate(() => [...document.querySelectorAll('yt-tab-shape')].map((t) => [t.getAttribute('tab-title'), t.getAttribute('data-at-peace-tab'), getComputedStyle(t).display === 'none']));
    const byTitle = Object.fromEntries(tabs.map(([title, tag, hidden]) => [title, { tag, hidden }]));
    assert.deepEqual(byTitle.Home, { tag: 'home', hidden: false });
    assert.deepEqual(byTitle.Videos, { tag: 'videos', hidden: false });
    assert.deepEqual(byTitle.Shorts, { tag: 'shorts', hidden: true });
    assert.deepEqual(byTitle.Posts, { tag: 'posts', hidden: true });
    await shot('live-channel-tabs');
    // DNR: a full load of the channel root goes to /videos
    await configure({ 'yt.channel.openVideosTab': true });
    await waitForRules((rules) => rules.some((r) => (r.action.redirect?.regexSubstitution ?? '').endsWith('/videos')), 'channel');
    await paced('https://www.youtube.com/@veritasium');
    assert.equal(new URL(page.url()).pathname, '/@veritasium/videos');
    // in-app: from a search page, a click on the channel link
    await paced(SEARCH);
    await page.locator('ytd-video-renderer ytd-channel-name a:visible').first().click();
    await page.waitForURL(/\/videos$/, { timeout: 15_000 });
    assert.deepEqual(await ourErrors(), []);
  });

  live('Shorts through DNR and the real network: /shorts/ID → /watch?v=ID (watch) and the blocked page (block)', async () => {
    await configure({ 'yt.shorts.mode': 'block' });
    await waitForRules((rules) => rules.some((r) => (r.action.redirect?.regexSubstitution ?? '').includes('reason=shorts')), 'shorts block');
    await page.goto(`https://www.youtube.com/shorts/${SHORT_ID}`, { waitUntil: 'domcontentloaded' });
    assert.equal(page.url(), `${extUrl('src/pages/blocked/blocked.html')}?reason=shorts#https://www.youtube.com/shorts/${SHORT_ID}`);
    // watch: the redirect target is a watch page (which Google may answer with its captcha; the redirect is what is tested)
    await configure({ 'yt.shorts.mode': 'watch' });
    await waitForRules((rules) => rules.some((r) => (r.action.redirect?.regexSubstitution ?? '').endsWith('/watch?v=\\1')), 'shorts watch');
    const requests = [];
    page.on('request', (r) => r.isNavigationRequest() && requests.push(r.url()));
    await page.goto(`https://www.youtube.com/shorts/${SHORT_ID}`, { waitUntil: 'domcontentloaded' }).catch(() => null);
    assert.ok(page.url().includes(SHORT_ID) && !page.url().includes('/shorts/'), page.url());
  });
});
