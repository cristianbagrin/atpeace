// The catalog check in REAL Firefox (headless, Selenium + geckodriver). Firefox is the product (Zen), so this is
// the run that says "the settings do what they say" where it counts.
//
// For a representative setting of every section of the YouTube catalog it asserts, on a page of that kind, that
//   * the targets are on screen with everything off (so "hidden" proves something),
//   * they are gone with the setting on, and come back when it is off again,
//   * the things that must stay (player, title, search box, playlist panel, tabs, the neighbouring settings'
//     elements) are still there.
// It also covers the Firefox-specific risks: grayscale on <html> keeps position:fixed bars in place (PLAN R4),
// the thumbnail blur reveals on a real pointer hover, the watch-layout resize nudge, and the mini guide's
// bridge tags.
//
// YouTube is OFFLINE: pages are rebuilt from the Phase 1 research snapshots and served by a local http server
// (tests/e2e/_yt-fixture.mjs); Firefox resolves www.youtube.com to 127.0.0.1 and the content scripts match
// `*://www.youtube.com/*` whatever the port, so they inject exactly as on the real site. No traffic to Google, no
// captcha, deterministic. The snapshots are local files (tests/e2e/artifacts/research/*.dom.json, written by
// tools/yt-probe.mjs): without them these tests are skipped and say so. Snapshots carry no YouTube CSS (a small
// wireframe stylesheet stands in), so the checks use what the DOM says is rendered (display, visibility, boxes),
// never pixels.
//
// Prerequisite: bash tests/firefox/setup.sh (npm run test:firefox does it).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { By } from 'selenium-webdriver';
import { launchFirefox, ROOT } from './_harness.mjs';
import { fixturesAvailable, startFixtureServer } from '../e2e/_yt-fixture.mjs';
import { until, sleep } from '../helpers/wait.mjs';

const SHOTS = join(ROOT, 'tests', 'e2e', 'artifacts', 'catalog');
const ABSENT = 'research snapshots are absent (tests/e2e/artifacts/research is local only; tools/yt-probe.mjs writes them)';
const skipUnless = (...names) => (fixturesAvailable(names) ? false : ABSENT);

let ff;
let driver;
let server;

before(async () => {
  if (!fixturesAvailable(['home'])) return; // every test below is skipped with the reason above
  server = await startFixtureServer();
  ff = await launchFirefox({
    prefs: {
      'network.dns.localDomains': 'www.youtube.com',
      'network.proxy.no_proxies_on': 'localhost, 127.0.0.1, www.youtube.com',
      'network.stricttransportsecurity.preloadlist': false, // youtube.com is HSTS-preloaded: keep our local http page on http
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

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

const run = (fn, ...args) => driver.executeScript(fn, ...args);
const shot = async (name) => writeFile(join(SHOTS, `firefox-${name}.png`), await driver.takeScreenshot(), 'base64');

const PAGES = {
  home: '/',
  homeNarrow: '/?fixture=home-narrow',
  search: '/results?search_query=lofi',
  watch: '/watch?v=abcdefghijk',
  watchPlaylist: '/watch?v=abcdefghijk&list=PL1&fixture=watch-playlist',
  channel: '/@MrBeast/videos',
  shorts: '/shorts/abcdefghijk?fixture=shorts',
  subscriptions: '/feed/subscriptions?fixture=feed-subscriptions',
};

let previousTokens = new Set();

/** The tokens a settings map should put on <html>: toggles by id, selects as id=value. */
const tokensOf = (settings) => Object.entries(settings).flatMap(([id, v]) => (v === true ? [id] : typeof v === 'string' ? [`${id}=${v}`] : []));

/** Replaces the stored settings (everything else default) and waits until the page's tokens follow. */
async function apply(settings) {
  await ff.setStorage({ settings });
  const want = tokensOf(settings);
  const drop = [...previousTokens].filter((t) => !want.includes(t) && !t.includes('='));
  await until(
    () => run(({ want: w, drop: d }) => {
      const tokens = (document.documentElement.getAttribute('data-at-peace') ?? '').split(' ');
      return w.every((t) => tokens.includes(t)) && d.every((t) => !tokens.includes(t));
    }, { want, drop }),
    { what: `the page to follow ${JSON.stringify(settings).slice(0, 100)}`, retryErrors: true },
  );
  previousTokens = new Set(want);
  await sleep(150); // a frame or two for rules and the engine's own work (filters, placeholders) to settle
}

/** Loads a snapshot page with everything off and waits for the engine and the rebuilt document. */
async function open(path) {
  await ff.setStorage({ settings: {} });
  previousTokens = new Set();
  await driver.get(`${server.origin}${path}`);
  await until(
    () => run(() => document.documentElement.getAttribute('data-fixture-ready') === '1' && document.documentElement.hasAttribute('data-at-peace') && document.documentElement.hasAttribute('data-at-peace-page')),
    { what: `the engine on ${path}`, timeout: 30_000, retryErrors: true },
  );
}

/** Runs in the page: for each selector, how many elements match and how many are rendered (display, visibility, a box). */
function probeInPage(selectors) {
  return selectors.map((sel) => {
    let els;
    try {
      els = [...document.querySelectorAll(sel)];
    } catch (err) {
      return { sel, error: String(err) };
    }
    const rendered = (el) => {
      const cs = getComputedStyle(el);
      return cs.display !== 'none' && cs.visibility !== 'hidden' && el.getClientRects().length > 0;
    };
    return { sel, count: els.length, shown: els.filter(rendered).length };
  });
}
const probe = (selectors) => run(probeInPage, selectors);

async function expectShown(what, selectors) {
  for (const r of await probe(selectors)) {
    assert.equal(r.error, undefined, `${what}: ${r.sel} is a valid selector (${r.error})`);
    assert.ok(r.count > 0, `${what}: ${r.sel} exists on the page`);
    assert.ok(r.shown > 0, `${what}: ${r.sel} is on screen (${r.shown} of ${r.count})`);
  }
}
async function expectGone(what, selectors) {
  for (const r of await probe(selectors)) {
    assert.equal(r.error, undefined, `${what}: ${r.sel} is a valid selector (${r.error})`);
    assert.ok(r.count > 0, `${what}: ${r.sel} exists on the page`);
    assert.equal(r.shown, 0, `${what}: ${r.sel} is hidden (${r.shown} of ${r.count} still on screen)`);
  }
}

/**
 * The whole story for one setting group: the targets are on screen with everything off, gone with `settings` on,
 * the must-stay elements are on screen throughout, and the targets are back when everything is off again.
 */
async function hides(what, settings, targets, stays = []) {
  await apply({});
  await expectShown(`${what} (everything off)`, [...targets, ...stays]);
  await apply(settings);
  await expectGone(what, targets);
  await expectShown(`${what}: what must stay`, stays);
  await apply({});
  await expectShown(`${what} (switched off again)`, targets);
}

const computed = (selector, property, pseudo = null) => run((s, p, ps) => getComputedStyle(document.querySelector(s), ps)[p], selector, property, pseudo);

async function hover(selector) {
  const el = await driver.findElement(By.css(selector));
  await run((e) => e.scrollIntoView({ block: 'center' }), el);
  await driver.actions({ async: true }).move({ origin: el }).perform();
}
const moveAway = () => driver.actions({ async: true }).move({ x: 4, y: 4 }).perform();

// ---------------------------------------------------------------------------------------------
// All of YouTube (search results carry the cards)
// ---------------------------------------------------------------------------------------------

const CARD = 'ytd-search ytd-video-renderer';
const META = 'ytd-search ytd-video-meta-block #metadata-line > span.inline-metadata-item';

test('All of YouTube: view counts and durations go, dates, titles and thumbnails stay', { skip: skipUnless('search-lofi') }, async () => {
  await open(PAGES.search);
  await hides('view counts', { 'yt.general.hideViewCounts': true }, [`${META}:nth-of-type(1)`], [`${META}:nth-of-type(2)`, `${CARD} a#video-title`]);
  await hides('upload dates', { 'yt.general.hideUploadDates': true }, [`${META}:nth-of-type(2)`], [`${META}:nth-of-type(1)`, `${CARD} a#video-title`]);
  await hides('durations', { 'yt.general.hideDurations': true }, ['ytd-search ytd-thumbnail-overlay-time-status-renderer'], [`${CARD} ytd-thumbnail`, `${CARD} a#video-title`]);
  await apply({ 'yt.general.hideViewCounts': true });
  assert.equal(await computed(`${META}:nth-of-type(2)`, 'display', '::before'), 'none', 'with the view count gone no stray bullet is left before the date');
  await apply({});
});

test('All of YouTube: grayscale on <html> leaves the fixed top bar where it was', { skip: skipUnless('search-lofi') }, async () => {
  await open(PAGES.search);
  await apply({});
  assert.equal(await computed('html', 'filter'), 'none');
  await run(() => window.scrollTo(0, 800));
  const before = await run(() => document.querySelector('ytd-masthead').getBoundingClientRect().top);
  assert.equal(await computed('ytd-masthead', 'position'), 'fixed', 'precondition: the top bar is position:fixed');
  await apply({ 'yt.general.grayscale': true });
  assert.match(await computed('html', 'filter'), /^grayscale\(/);
  await run(() => window.scrollTo(0, 900));
  await sleep(150);
  const after = await run(() => document.querySelector('ytd-masthead').getBoundingClientRect().top);
  assert.equal(after, before, 'a filter on <html> does not turn position:fixed into position:absolute (PLAN R4)');
  assert.equal(after, 0, 'and the bar still sits at the top of the window after scrolling');
  await shot('grayscale-search');
  await apply({});
  assert.equal(await computed('html', 'filter'), 'none', 'switched off again');
});

test('All of YouTube: thumbnails blur, and the blur lifts on a real pointer hover and comes back', { skip: skipUnless('search-lofi') }, async () => {
  await open(PAGES.search);
  const img = `${CARD} ytd-thumbnail img`;
  await apply({ 'yt.general.thumbnails': 'blur' });
  await run(() => window.scrollTo(0, 0));
  assert.match(await computed(img, 'filter'), /^blur\(/, 'blurred at rest');
  await shot('thumbnails-blur');
  await hover(`${CARD} ytd-thumbnail`);
  await until(async () => (await computed(img, 'filter')) === 'none', { what: 'the blur to lift under the pointer', timeout: 3000 });
  await moveAway();
  await until(async () => /^blur\(/.test(await computed(img, 'filter')), { what: 'the blur to come back', timeout: 3000 });
  await apply({ 'yt.general.thumbnails': 'grayscale' });
  assert.match(await computed(img, 'filter'), /^grayscale\(/, 'grayscale until hovered');
  await apply({ 'yt.general.thumbnails': 'hide' });
  assert.notEqual(await computed(img, 'visibility'), 'visible', 'hide: the picture is not shown');
  await expectShown('hide keeps the title', [`${CARD} a#video-title`]);
  await apply({});
  assert.equal(await computed(img, 'filter'), 'none', 'back to normal');
});

// ---------------------------------------------------------------------------------------------
// Top bar, left sidebar, Home
// ---------------------------------------------------------------------------------------------

test('Top bar: the microphone and the country code go; the logo and the search box stay', { skip: skipUnless('home') }, async () => {
  await open(PAGES.home);
  await hides(
    'masthead bits',
    { 'yt.masthead.hideVoiceSearch': true, 'yt.masthead.hideCountryCode': true },
    ['ytd-masthead #voice-search-button', 'ytd-topbar-logo-renderer #country-code'],
    ['ytd-topbar-logo-renderer a#logo', 'ytd-masthead yt-searchbox', 'ytd-masthead input[name="search_query"]'],
  );
});

test('Left sidebar: the five primary entries go one by one; Explore and the footer stay; hiding all gives the gutter back', { skip: skipUnless('home') }, async () => {
  await open(PAGES.home);
  const primary = 'tp-yt-app-drawer#guide ytd-guide-section-renderer:first-of-type ytd-guide-entry-renderer';
  await apply({});
  assert.equal((await probe([primary]))[0].count, 5, 'precondition: five primary entries');
  await hides(
    'primary entries',
    { 'yt.guide.hideHome': true, 'yt.guide.hideShorts': true, 'yt.guide.hideSubscriptionsEntry': true, 'yt.guide.hideYouEntry': true, 'yt.guide.hideHistory': true },
    [primary],
    ['ytd-guide-entry-renderer:has(> a#endpoint[href="/reporthistory"])', 'ytd-guide-section-renderer:has(a#endpoint[href="/channel/UC-9-kyTW8ZkZNDHQJ6FgpwQ"])'],
  );
  const gutter = () => computed('ytd-page-manager', 'marginLeft');
  assert.equal(await gutter(), '240px', 'precondition: the docked guide leaves a 240 px gutter');
  await apply({ 'yt.guide.hideAll': true });
  await expectGone('whole sidebar', ['tp-yt-app-drawer#guide']);
  assert.equal(await gutter(), '0px', 'no empty strip is left where the sidebar was');
  await expectShown('the page itself stays', ['ytd-masthead', 'ytd-page-manager']);
  await apply({});
});

test('Left sidebar, mini guide: its entries are tagged by the bridge from `entry.data.icon.iconType`, and a rule that only knows the tag hides them', { skip: skipUnless('home-narrow') }, async () => {
  await open(PAGES.homeNarrow);
  const mini = await run(() => {
    const entries = [...document.querySelectorAll('ytd-mini-guide-entry-renderer')];
    // Observed live at 1100x800 (docs/youtube-dom.md 4.7): Home, Shorts, Subscriptions, You, each with only `icon.iconType`.
    ['TAB_HOME_CAIRO', 'TAB_SHORTS_CAIRO', 'TAB_SUBSCRIPTIONS_CAIRO', 'ACCOUNT_CIRCLE_CAIRO'].forEach((iconType, i) => entries[i] && (entries[i].data = { icon: { iconType } }));
    for (const link of document.querySelectorAll('ytd-mini-guide-entry-renderer a#endpoint')) link.setAttribute('href', '#'); // only the tag can identify an entry now
    return entries.length;
  });
  assert.equal(mini, 4, 'the snapshot has the four logged-out mini guide entries');
  await apply({ 'yt.guide.hideShorts': true, 'yt.guide.hideSubscriptionsEntry': true });
  await until(() => run(() => document.querySelectorAll('ytd-mini-guide-entry-renderer[data-at-peace-entry]').length === 4), { what: 'the four mini guide tags', retryErrors: true });
  const after = await run(() => [...document.querySelectorAll('ytd-mini-guide-entry-renderer')].map((e) => [e.getAttribute('data-at-peace-entry'), getComputedStyle(e).display === 'none']));
  assert.deepEqual(after.map(([tag]) => tag), ['home', 'shorts', 'subscriptions', 'you']);
  assert.deepEqual(after.map(([, hidden]) => hidden), [false, true, true, false]);
  await apply({});
  await until(() => run(() => document.querySelectorAll('[data-at-peace-entry]').length === 0), { what: 'the tags to go', retryErrors: true });
});

test('Home: the "try searching" card goes, a calm placeholder replaces the feed, shelves hide as whole items', { skip: skipUnless('home') }, async () => {
  await open(PAGES.home);
  await hides('feed nudge', { 'yt.home.hideFeedNudge': true }, ['ytd-feed-nudge-renderer'], ['ytd-masthead']);

  await apply({ 'yt.home.feedMode': 'hide' });
  await expectGone('feed column', ['ytd-browse[page-subtype="home"] #primary']);
  await until(() => run(() => document.querySelector('[data-at-peace-placeholder="home"]') !== null), { what: 'the placeholder', retryErrors: true });
  await expectShown('masthead and search stay on a calm home', ['ytd-masthead', 'ytd-masthead yt-searchbox']);
  await apply({ 'yt.home.feedMode': 'show' });
  await until(() => run(() => document.querySelector('[data-at-peace-placeholder]') === null), { what: 'the placeholder to go', retryErrors: true });
  await expectShown('feed column back', ['ytd-browse[page-subtype="home"] #primary']);

  // Signed out there is no feed, so give the grid synthetic items (as the Chromium catalog spec does).
  await run(() => {
    const grid = document.querySelector('ytd-browse[page-subtype="home"] ytd-rich-grid-renderer > #contents');
    const add = (id, tag, attrs = {}, child = null) => {
      const el = document.createElement(tag);
      el.setAttribute('data-test-id', id);
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      grid.appendChild(el);
      if (child) {
        const c = document.createElement(child.tag);
        for (const [k, v] of Object.entries(child.attrs ?? {})) c.setAttribute(k, v);
        el.appendChild(c);
      }
    };
    add('short', 'ytd-rich-item-renderer', {}, { tag: 'a', attrs: { href: '/shorts/abcdefghijk', id: 'thumbnail' } });
    add('video', 'ytd-rich-item-renderer', {}, { tag: 'a', attrs: { href: '/watch?v=abcdefghijk', id: 'thumbnail' } });
    add('shelf', 'ytd-rich-section-renderer', {}, { tag: 'ytd-rich-shelf-renderer', attrs: { 'is-shorts': '' } });
    add('extra', 'ytd-rich-section-renderer', {}, { tag: 'div' });
    for (const el of grid.querySelectorAll('[data-test-id]')) el.append(el.getAttribute('data-test-id')); // some text, so they have a box (appending keeps the children)
  });
  const state = (id) => run((i) => getComputedStyle(document.querySelector(`[data-test-id="${i}"]`)).display, id);
  await apply({ 'yt.home.hideShortsShelf': true });
  assert.equal(await state('short'), 'none', 'a Shorts card goes');
  assert.equal(await state('shelf'), 'none', 'a Shorts shelf goes whole');
  assert.notEqual(await state('video'), 'none', 'an ordinary video card stays');
  assert.notEqual(await state('extra'), 'none', 'an unrelated row stays');
  await apply({ 'yt.home.hideOtherShelves': true });
  assert.equal(await state('extra'), 'none', 'every extra row goes');
  assert.notEqual(await state('video'), 'none', 'but never a video card');
  await apply({});
});

// ---------------------------------------------------------------------------------------------
// Video page, Player, Comments
// ---------------------------------------------------------------------------------------------

const TITLE = 'ytd-watch-metadata #title h1';

test('Video page: hiding related videos widens the player, keeps title, player and channel row, and nudges the player to re-measure', { skip: skipUnless('watch-chapters') }, async () => {
  await open(PAGES.watch);
  await apply({});
  await expectShown('baseline', ['#related', '#secondary', '#movie_player', TITLE, 'ytd-watch-metadata #owner']);
  const widthBefore = await run(() => document.querySelector('#player').getBoundingClientRect().width);

  // Count the resize events YouTube's player listens for: the layout nudge must send them.
  await run(() => {
    window.__resizes = [];
    window.addEventListener('resize', () => window.__resizes.push(performance.now()));
  });
  await apply({ 'yt.watch.hideRelated': true });
  await expectGone('related', ['ytd-watch-flexy #related', '#secondary']);
  await expectShown('what must stay', ['#movie_player', TITLE, 'ytd-watch-metadata #owner']);
  const widthAfter = await run(() => document.querySelector('#player').getBoundingClientRect().width);
  assert.ok(widthAfter > widthBefore + 250, `the player takes over the empty column (${widthBefore} → ${widthAfter})`);
  const resizes = await until(async () => {
    const list = await run(() => [...window.__resizes]);
    return list.length >= 2 ? list : null;
  }, { what: 'the layout nudge to send two resize events', timeout: 3000, retryErrors: true });
  assert.ok(resizes[1] - resizes[0] > 200, `the second nudge comes after the layout settles (${Math.round(resizes[1] - resizes[0])} ms later)`);
  await shot('watch-related-hidden');
  await apply({});
  await expectShown('everything back', ['#related', '#secondary']);
});

test('Video page: buttons under the video hide one by one, the details trim, comments go', { skip: skipUnless('watch-chapters') }, async () => {
  await open(PAGES.watch);
  const like = 'ytd-watch-metadata segmented-like-dislike-button-view-model';
  const share = 'ytd-watch-metadata #top-level-buttons-computed > yt-button-view-model:has(path[d^="M10 3.158V7.51"])';
  const save = 'ytd-watch-metadata #flexible-item-buttons > yt-button-view-model:has(path[d^="M19 2H5a2 2 0 00-2 2v16"])';
  await hides('like and dislike', { 'yt.watch.hideLikeButtons': true }, [like], [share, save]);
  await hides('share', { 'yt.watch.hideShare': true }, [share], [like, save]);
  await hides('save', { 'yt.watch.hideSave': true }, [save], [like, share]);
  await hides('owner details', { 'yt.watch.hideOwnerAvatar': true, 'yt.watch.hideSubscriberCount': true }, ['ytd-watch-metadata ytd-video-owner-renderer #avatar', 'ytd-watch-metadata #owner-sub-count'], ['ytd-watch-metadata ytd-video-owner-renderer ytd-channel-name', 'ytd-watch-metadata #subscribe-button']);
  await hides('description', { 'yt.watch.hideDescription': true }, ['ytd-watch-metadata ytd-text-inline-expander'], [TITLE, 'ytd-watch-metadata #owner']);
  await hides('comments', { 'yt.comments.hideAll': true }, ['ytd-comments#comments'], ['#movie_player', TITLE]);
});

test('Player: the info-cards button and the end-screen grid hide; the player and its video stay', { skip: skipUnless('watch-chapters') }, async () => {
  await open(PAGES.watch);
  // The snapshot's control bar is not rendered (a player that never started), so the controls cannot be judged here
  // (the Chromium catalog spec checks them on the live page); the overlays below are on screen in the snapshot.
  await hides('player overlays', { 'yt.player.hideInfoCards': true, 'yt.player.hideEndscreenWall': true }, ['.ytp-cards-button', '.ytp-fullscreen-grid'], ['#movie_player', 'video']);
});

test('Video page with a playlist: hiding related videos keeps the playlist panel and its column', { skip: skipUnless('watch-playlist') }, async () => {
  await open(PAGES.watchPlaylist);
  await apply({});
  await expectShown('before', ['ytd-playlist-panel-renderer#playlist', '#related', '#secondary']);
  await apply({ 'yt.watch.hideRelated': true });
  await expectGone('related', ['ytd-watch-flexy #related']);
  await expectShown('the playlist panel stays, and so does its column', ['ytd-playlist-panel-renderer#playlist', '#secondary', '#movie_player']);
  await shot('watch-playlist-related-hidden');
  await apply({});
});

// ---------------------------------------------------------------------------------------------
// Search, Shorts, Subscriptions, Channel, Filters
// ---------------------------------------------------------------------------------------------

test('Search results: descriptions and filter chips go; titles, thumbnails and channel names stay', { skip: skipUnless('search-lofi') }, async () => {
  await open(PAGES.search);
  await hides(
    'result extras',
    { 'yt.search.hideSnippets': true, 'yt.search.hideFilterChips': true },
    [`${CARD} .metadata-snippet-container`, 'ytd-search ytd-search-header-renderer #chip-bar'],
    [`${CARD} a#video-title`, `${CARD} ytd-thumbnail`, `${CARD} ytd-channel-name`],
  );
});

test('Shorts player: comments, subscribe and like counts go one by one; the player and the like button stay', { skip: skipUnless('shorts') }, async () => {
  // Mode "block" and "watch" leave the page for another one (a redirect), so they are covered by the features specs;
  // here the Shorts are allowed and only the small settings are judged.
  await open(PAGES.shorts);
  const bar = 'ytd-shorts reel-action-bar-view-model';
  const like = `${bar} like-button-view-model`;
  await hides('comments button', { 'yt.shorts.hideComments': true }, [`${bar} > button-view-model:nth-of-type(1)`], ['ytd-shorts', like]);
  await hides('subscribe', { 'yt.shorts.hideSubscribe': true }, ['ytd-shorts yt-reel-channel-bar-view-model .ytReelChannelBarViewModelReelSubscribeButton'], ['ytd-shorts', 'ytd-shorts yt-reel-channel-bar-view-model']);
  await hides('like counts', { 'yt.shorts.hideLikeCounts': true }, [`${like} .ytSpecButtonShapeWithLabelLabel`], [like, 'ytd-shorts']);
});

test('Subscriptions feed: Shorts cards and watched cards hide as whole items (synthetic cards)', { skip: skipUnless('feed-subscriptions') }, async () => {
  await open(PAGES.subscriptions);
  const added = await run(() => {
    const host = document.querySelector('ytd-browse[page-subtype="subscriptions"]');
    if (!host) return false;
    const card = (id, childTag, childAttrs) => {
      const el = document.createElement('ytd-rich-item-renderer');
      el.setAttribute('data-test-id', id);
      host.appendChild(el);
      const child = document.createElement(childTag);
      for (const [k, v] of Object.entries(childAttrs ?? {})) child.setAttribute(k, v);
      child.textContent = id;
      el.appendChild(child);
    };
    card('short', 'a', { href: '/shorts/abcdefghijk' });
    card('watched', 'yt-thumbnail-overlay-progress-bar-view-model');
    card('video', 'a', { href: '/watch?v=abcdefghijk' });
    return true;
  });
  assert.ok(added, 'the subscriptions page element exists in the snapshot');
  const display = (id) => run((i) => getComputedStyle(document.querySelector(`[data-test-id="${i}"]`)).display, id);
  await apply({});
  for (const id of ['short', 'watched', 'video']) assert.notEqual(await display(id), 'none', `${id} shown with everything off`);
  await apply({ 'yt.subs.hideShorts': true });
  assert.equal(await display('short'), 'none');
  assert.notEqual(await display('watched'), 'none', 'the Shorts setting leaves watched cards alone');
  assert.notEqual(await display('video'), 'none');
  await apply({ 'yt.subs.hideWatched': true });
  assert.equal(await display('watched'), 'none');
  assert.notEqual(await display('short'), 'none', 'the watched setting leaves Shorts alone');
  assert.notEqual(await display('video'), 'none', 'an ordinary video card always stays');
  await apply({});
});

test('Channel pages: the banner and the subscriber count go; the name, the tabs and the videos stay', { skip: skipUnless('channel-videos') }, async () => {
  await open(PAGES.channel);
  const channel = 'ytd-browse[page-subtype="channels"]';
  await hides('banner', { 'yt.channel.hideBanner': true }, [`${channel} #page-header-banner`], [`${channel} h1`, `${channel} yt-tab-shape`]);
  await hides(
    'subscriber count',
    { 'yt.channel.hideSubscriberCount': true },
    [`${channel} .ytPageHeaderViewModelContentMetadata .ytContentMetadataViewModelMetadataRow:has(> .ytContentMetadataViewModelDelimiter) > :nth-child(1 of .ytContentMetadataViewModelMetadataText)`],
    [`${channel} .ytPageHeaderViewModelContentMetadata`, `${channel} h1`, `${channel} ytd-rich-item-renderer`],
  );
});

test('Filters: a channel filter hides that channel\'s results in the search and nothing else', { skip: skipUnless('search-lofi') }, async () => {
  await open(PAGES.search);
  await apply({});
  // Pick the channel of the first result from the page itself, so the test follows whatever the snapshot holds.
  const pick = await run(() => {
    const names = [...document.querySelectorAll('ytd-search ytd-video-renderer')].map((card) => (card.querySelector('ytd-channel-name a, ytd-channel-name yt-formatted-string')?.textContent ?? '').trim());
    const first = names.find(Boolean);
    return { first, total: names.length, withFirst: names.filter((n) => n === first).length };
  });
  assert.ok(pick.first, 'the snapshot has channel names on its results');
  assert.ok(pick.withFirst < pick.total, 'precondition: not every result is from that channel');
  await apply({ 'yt.filters.channels': [pick.first], 'yt.filters.applyTo': ['search'] });
  const hidden = await until(
    () => run((name) => {
      const cards = [...document.querySelectorAll('ytd-search ytd-video-renderer')];
      const gone = cards.filter((c) => getComputedStyle(c).display === 'none');
      const mine = cards.filter((c) => (c.querySelector('ytd-channel-name a, ytd-channel-name yt-formatted-string')?.textContent ?? '').trim() === name);
      return gone.length > 0 && gone.every((c) => mine.includes(c)) && mine.every((c) => gone.includes(c)) ? { gone: gone.length, total: cards.length } : null;
    }, pick.first),
    { what: `the results of "${pick.first}" to be hidden`, retryErrors: true },
  );
  assert.equal(hidden.gone, pick.withFirst, 'exactly that channel\'s results are hidden');
  assert.ok(hidden.total - hidden.gone > 0, 'the other results stay');
  await apply({});
  await until(() => run(() => [...document.querySelectorAll('ytd-search ytd-video-renderer')].every((c) => getComputedStyle(c).display !== 'none')), { what: 'the results to come back', retryErrors: true });
});

test('No errors from our code appeared in Firefox while doing all of the above', { skip: skipUnless('home') }, async () => {
  // Firefox logs "Promise resolved after context unloaded" when a page navigates away while an async hook is still reading storage: harmless.
  const benign = (e) => /Promise resolved after context unloaded/.test(e);
  const errors = [...(await ff.ourScriptErrors()), ...ff.pageErrorsSince(0).filter((e) => e.includes('moz-extension://') || e.includes('[At Peace]'))].filter((e) => !benign(e));
  assert.deepEqual(errors, []);
});
