// Phase 3b in REAL Firefox (headless, Selenium + geckodriver): the YouTube JS behaviours, the MAIN-world
// bridge and the redirects. Firefox is the product (Zen), so this is the run that counts.
//
// Two groups, each with its own browser (one resolves www.youtube.com to localhost, the other must not):
//   1. OFFLINE: pages rebuilt from the Phase 1 snapshots and served by a local http server
//      (tests/e2e/_yt-fixture.mjs): home placeholder, the keyboard / hover guards.
//      Skipped without the snapshots (tests/e2e/artifacts/research is local only).
//   2. LIVE youtube.com, logged out, paced (Google answers bursts with a /sorry/ captcha: a captcha skips
//      the test): the bridge on the real data objects (guide entries, channel tabs, the buttons under the
//      video), theater / autoplay switch / speed through the player API, and every redirect through the
//      real declarativeNetRequest rules and the in-app interceptors, including History behaviour.
// What cannot be exercised without playback or a login is listed in docs (user checklist), as in the
// Chromium spec tests/e2e/features.spec.mjs. Prerequisite: bash tests/firefox/setup.sh.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { By, Key } from 'selenium-webdriver';
import { launchFirefox, extUrl, ROOT, NAVIGATION_NOISE } from './_harness.mjs';
import { fixturesAvailable, startFixtureServer } from '../e2e/_yt-fixture.mjs';
import { until } from '../helpers/wait.mjs';

const SHOTS = join(ROOT, 'tests', 'e2e', 'artifacts', 'features');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const SEARCH = 'https://www.youtube.com/results?search_query=lofi';
const SHORT_ID = 'C0STkNVChLI';

/** Shared helpers for a launched Firefox. */
function tools(ff) {
  const { driver } = ff;
  let extHandle = null;

  async function inExt(fn) {
    const original = await driver.getWindowHandle();
    if (extHandle === null) {
      await driver.switchTo().newWindow('tab');
      extHandle = await driver.getWindowHandle();
      await driver.get(extUrl('src/pages/popup/popup.html'));
    } else {
      await driver.switchTo().window(extHandle);
    }
    try {
      return await fn();
    } finally {
      await driver.switchTo().window(original);
    }
  }

  const run = (fn, arg) => driver.executeScript(fn, arg ?? null);

  return {
    driver,
    inExt,
    until,
    run,
    shot: async (name) => writeFile(join(SHOTS, `${name}.png`), await driver.takeScreenshot(), 'base64'),
    async configure(settings) {
      await ff.setStorage({ settings });
      await sleep(250);
    },
    dnr: async () => inExt(() => driver.executeAsyncScript((done) => browser.declarativeNetRequest.getDynamicRules().then(done, (e) => done({ __error: String(e) })))),
    async waitRules(predicate, what) {
      return until(async () => {
        const rules = await inExt(() => driver.executeAsyncScript((done) => browser.declarativeNetRequest.getDynamicRules().then(done, (e) => done({ __error: String(e) }))));
        return predicate(rules) ? rules : null;
      }, `DNR rules: ${what}`, 8000);
    },
    /** Navigates and waits for the engine's first settings. A captcha throws code YT_SORRY. */
    async open(url, { fixture = false } = {}) {
      await driver.get(url);
      if ((await driver.getCurrentUrl()).includes('/sorry/')) throw Object.assign(new Error('Google served its captcha page (/sorry/)'), { code: 'YT_SORRY' });
      await until(() => run(() => document.documentElement.hasAttribute('data-at-peace') && document.documentElement.hasAttribute('data-at-peace-page')), 'the engine', 20_000);
      if (fixture) await until(() => run(() => document.documentElement.getAttribute('data-fixture-ready') === '1'), 'the snapshot', 20_000);
    },
    async ourErrors() {
      // Firefox logs "Promise resolved after context unloaded" for an async hook (here guard-core.js's storage read)
      // whose page navigates away mid-flight: harmless, and not ours to count (see the note in tests/firefox/engine.mjs).
      const benign = (e) => NAVIGATION_NOISE.test(e);
      return [...(await ff.ourScriptErrors()), ...ff.pageErrorsSince(0).filter((e) => e.includes('moz-extension://') || e.includes('[At Peace]'))].filter((e) => !benign(e));
    },
  };
}

// ---------------------------------------------------------------------------------------------
// 1. Offline snapshots
// ---------------------------------------------------------------------------------------------

const HAVE = fixturesAvailable(['home', 'search-lofi', 'channel-videos', 'watch-chapters']);

describe('offline snapshots', { skip: HAVE ? false : 'research snapshots are absent (tests/e2e/artifacts/research is local only)' }, () => {
  let ff;
  let t;
  let server;

  before(async () => {
    server = await startFixtureServer();
    ff = await launchFirefox({
      prefs: {
        'network.dns.localDomains': 'www.youtube.com',
        'network.proxy.no_proxies_on': 'localhost, 127.0.0.1, www.youtube.com',
        'network.stricttransportsecurity.preloadlist': false, // youtube.com is HSTS-preloaded: keep our local http page http
      },
    });
    t = tools(ff);
    await ff.driver.manage().window().setRect({ width: 1440, height: 900 });
    await mkdir(SHOTS, { recursive: true });
  });
  after(async () => {
    await ff?.close();
    await server?.close();
  });
  const url = (path) => `${server.origin}${path}`;

  test('home placeholder: drawn in place of the feed (closed shadow root): a glyph and one line, nothing to click', async () => {
    await t.configure({ 'yt.home.feedMode': 'hide' });
    await t.open(url('/'), { fixture: true });
    const info = await t.until(
      () =>
        t.run(() => {
          const host = document.querySelector('[data-at-peace-placeholder="home"]');
          if (!host) return null;
          const r = host.getBoundingClientRect();
          const primary = document.querySelector('ytd-browse[page-subtype="home"] #primary');
          return { text: host.getAttribute('data-at-peace-text'), x: r.x, y: r.y, w: r.width, h: r.height, feedHidden: getComputedStyle(primary).display === 'none', shadow: host.shadowRoot === null };
        }),
      'the placeholder',
    );
    assert.equal(info.text, 'Your home is hidden.');
    assert.equal(info.feedHidden, true);
    assert.equal(info.shadow, true, 'closed shadow root');
    assert.ok(info.w > 300 && info.h > 200);
    await t.shot('firefox-home-placeholder');
    await t.driver.actions({ async: true }).move({ x: Math.round(info.x + 200), y: Math.round(info.y + info.h / 2) }).click().perform();
    assert.notEqual(await t.run(() => document.activeElement?.getAttribute('name')), 'search_query', 'clicking the card does not steal the focus');
  });

  test('Shorts links are rewritten to /watch?v=ID (and restored); the bridge announces itself in the page world', async () => {
    await t.configure({ 'yt.shorts.mode': 'watch' });
    await t.open(url('/results?search_query=lofi'), { fixture: true });
    await t.until(() => t.run(() => document.querySelectorAll('a[data-at-peace-href]').length > 0), 'rewritten links');
    const links = await t.run(() => [...document.querySelectorAll('a[data-at-peace-href]')].map((a) => [a.getAttribute('data-at-peace-href'), a.getAttribute('href')]));
    for (const [orig, now] of links) assert.equal(now, `/watch?v=${orig.split('/shorts/')[1].split(/[?&#]/)[0]}`);
    assert.equal(await t.run(() => document.querySelectorAll('a[href^="/shorts/"]').length), 0);
    assert.equal(await t.run(() => document.documentElement.getAttribute('data-at-peace-bridge')), '1');
    await t.configure({});
    await t.until(() => t.run(() => document.querySelectorAll('a[data-at-peace-href]').length === 0 && document.querySelectorAll('a[href^="/shorts/"]').length > 0), 'restored');
  });

  test('search suggestions guard: ArrowDown reaches the page with the setting off, not with it on; typing still works', async () => {
    await t.configure({});
    await t.open(url('/results?search_query=lofi'), { fixture: true });
    await t.run(() => {
      window.__keys = [];
      document.querySelector('input[name="search_query"]').addEventListener('keydown', (e) => window.__keys.push(e.key));
    });
    const box = await t.driver.findElement(By.css('input[name="search_query"]'));
    await box.click();
    await box.sendKeys(Key.ARROW_DOWN);
    assert.deepEqual(await t.run(() => window.__keys), ['ArrowDown']);
    await t.configure({ 'yt.masthead.hideSearchSuggestions': true });
    await t.run(() => (window.__keys = []));
    await box.click();
    await box.sendKeys(Key.ARROW_DOWN, Key.ARROW_UP, 'a');
    assert.deepEqual(await t.run(() => window.__keys), ['a']);
  });

  test('hover preview guard: pointer-enter on a thumbnail never reaches the page while the setting is on', async () => {
    await t.configure({});
    await t.open(url('/results?search_query=lofi'), { fixture: true });
    await t.run(() => {
      window.__enter = 0;
      for (const el of document.querySelectorAll('ytd-thumbnail')) el.addEventListener('mouseover', () => window.__enter++);
    });
    const thumb = await t.driver.findElement(By.css('ytd-video-renderer ytd-thumbnail'));
    await t.driver.actions({ async: true }).move({ origin: thumb, x: 5, y: 5 }).move({ origin: thumb, x: 40, y: 40 }).perform();
    assert.ok((await t.run(() => window.__enter)) > 0, 'the page sees hovers by default');
    await t.configure({ 'yt.general.disableHoverPreview': true });
    await t.run(() => (window.__enter = 0));
    await t.driver.actions({ async: true }).move({ origin: thumb, x: 10, y: 10 }).move({ origin: thumb, x: 60, y: 50 }).perform();
    assert.equal(await t.run(() => window.__enter), 0);
  });

  test('no errors from our code in this group', async () => {
    assert.deepEqual(await t.ourErrors(), []);
  });
});

// ---------------------------------------------------------------------------------------------
// 2. Live youtube.com
// ---------------------------------------------------------------------------------------------

describe('live youtube.com (logged out)', () => {
  const PAUSE_MS = Number(process.env.FEATURES_PAUSE_MS ?? 12_000);
  let ff;
  let t;
  let lastLoad = 0;

  before(async () => {
    ff = await launchFirefox();
    t = tools(ff);
    await ff.driver.manage().window().setRect({ width: 1440, height: 900 });
    await mkdir(SHOTS, { recursive: true });
  });
  after(async () => {
    await ff?.close();
  });

  async function paced(url) {
    const wait = lastLoad + PAUSE_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastLoad = Date.now();
    await t.open(url);
  }

  function live(name, fn) {
    test(name, async (ctx) => {
      try {
        await fn();
      } catch (err) {
        const captcha = (await ff.driver.getCurrentUrl().catch(() => '')).includes('/sorry/');
        if (captcha) return ctx.skip('Google served its captcha page (/sorry/); try again later');
        if (err?.code === 'YT_SORRY' || err?.code === 'YT_NOT_RENDERED') return ctx.skip(`${err.message}; try again later`);
        throw err;
      }
    });
  }

  /** Live YouTube sometimes does not render a part of the page at all (seen: a load with no guide entries in the DOM for 10+ s): that is not a result about us. */
  async function expectRendered(check, what, timeout = 15_000) {
    const ok = await t.until(check, what, timeout).then(() => true, () => false);
    if (!ok) throw Object.assign(new Error(`Live YouTube served this page without ${what} in the DOM (a page variant seen in Firefox; the same checks run on the offline snapshot)`), { code: 'YT_NOT_RENDERED' });
  }

  live('home: placeholder, guide entries tagged from entry.data in the page world, redirect by click with a clean history', async () => {
    await t.configure({ 'yt.home.feedMode': 'hide', 'yt.guide.hideWatchLater': true });
    await paced('https://www.youtube.com/');
    await t.until(() => t.run(() => document.querySelector('[data-at-peace-placeholder="home"]')), 'the placeholder');
    await expectRendered(() => t.run(() => document.querySelectorAll('ytd-guide-entry-renderer').length >= 5), 'its guide entries');
    await t.until(() => t.run(() => document.querySelectorAll('ytd-guide-entry-renderer[data-at-peace-entry]').length >= 4), 'guide entry tags', 20_000);
    const tags = await t.run(() => Object.fromEntries([...document.querySelectorAll('ytd-guide-entry-renderer[data-at-peace-entry]')].map((e) => [e.getAttribute('data-at-peace-entry'), e.querySelector('a#endpoint')?.getAttribute('href') ?? null])));
    assert.deepEqual(tags, { home: '/', shorts: null, subscriptions: '/feed/subscriptions', you: '/feed/you', history: '/feed/history' });
    await t.shot('firefox-live-home-placeholder');
    // the redirect, in-app: a click on the logo from the search page
    await t.configure({ 'yt.home.feedMode': 'watchLater' });
    await paced(SEARCH);
    await t.run(() => document.querySelector('ytd-masthead a#logo').click()); // (a WebDriver click cannot scroll the logo into view in a headless window)
    await t.until(async () => (await t.driver.getCurrentUrl()) === 'https://www.youtube.com/playlist?list=WL', 'the redirect to Watch later');
    await t.driver.navigate().back();
    await t.until(async () => (await t.driver.getCurrentUrl()) === SEARCH, 'Back returning to the page the click came from');
    // ... and without a click: a script navigates to / (Navigation API path); the pushed entry is replaced, Back skips nothing
    await t.configure({ 'yt.home.feedMode': 'subscriptions' });
    await paced(SEARCH);
    await t.run(() => history.pushState({}, '', '/'));
    await t.until(async () => (await t.driver.getCurrentUrl()) === 'https://www.youtube.com/feed/subscriptions', 'the Navigation API redirect');
    await t.driver.navigate().back();
    await t.until(async () => (await t.driver.getCurrentUrl()) === SEARCH, 'Back landing on the page before the pushed home entry');
    assert.deepEqual(await t.ourErrors(), []);
  });

  live('DNR in Firefox: / → target, /@handle → /videos, /shorts/ID → /watch?v=ID or the blocked page', async () => {
    await t.configure({ 'yt.home.feedMode': 'subscriptions', 'yt.channel.openVideosTab': true, 'yt.shorts.mode': 'block' });
    await t.waitRules((rules) => rules.length >= 3, 'three redirect rules');
    const rules = await t.dnr();
    const subs = rules.map((r) => r.action.redirect?.regexSubstitution);
    assert.ok(subs.includes('https://www.youtube.com/feed/subscriptions'), subs.join(' | '));
    assert.ok(subs.some((s) => s.endsWith('/\\1/videos')));
    assert.ok(subs.some((s) => s.includes('reason=shorts#\\0')));
    // Shorts "block": the extension's own blocked page, no YouTube request at all
    await t.driver.get(`https://www.youtube.com/shorts/${SHORT_ID}`);
    assert.equal(await t.driver.getCurrentUrl(), `${extUrl('src/pages/blocked/blocked.html')}?reason=shorts#https://www.youtube.com/shorts/${SHORT_ID}`);
    // watch: the redirect target is the normal player
    await t.configure({ 'yt.home.feedMode': 'subscriptions', 'yt.channel.openVideosTab': true, 'yt.shorts.mode': 'watch' });
    await t.waitRules((r) => r.some((x) => (x.action.redirect?.regexSubstitution ?? '').endsWith('/watch?v=\\1')), 'shorts watch rule');
    await t.driver.get(`https://www.youtube.com/shorts/${SHORT_ID}`);
    const now = await t.driver.getCurrentUrl();
    assert.ok(now.includes(SHORT_ID) && !now.includes('/shorts/'), now);
    // channel root and home, through the real network (the targets are real pages)
    await paced('https://www.youtube.com/@veritasium');
    assert.equal(new URL(await t.driver.getCurrentUrl()).pathname, '/@veritasium/videos', `rules: ${JSON.stringify((await t.dnr()).map((r) => [r.id, r.action.redirect.regexSubstitution]))}`);
    await paced('https://www.youtube.com/');
    assert.equal(await t.driver.getCurrentUrl(), 'https://www.youtube.com/feed/subscriptions');
  });

  live('search: Short links and a click on a Short (the in-app interceptor) in Firefox', async () => {
    await t.configure({ 'yt.shorts.mode': 'watch' });
    await paced(SEARCH);
    await t.until(() => t.run(() => document.querySelectorAll('ytd-video-renderer').length >= 10), 'results');
    assert.equal(await t.run(() => document.querySelectorAll('a[href^="/shorts/"]').length), 0);
    await t.shot('firefox-live-search-shorts');
    const id = await t.run(() => document.querySelector('a[data-at-peace-href]')?.getAttribute('data-at-peace-href')?.split('/shorts/')[1]?.split(/[?&#]/)[0] ?? null);
    if (id) {
      await t.run(() => document.querySelector('a[data-at-peace-href]').click());
      await t.until(async () => {
        const u = await t.driver.getCurrentUrl();
        return u.includes(id) && !u.includes('/shorts/');
      }, 'the click on a Short opening the normal player');
    }
  });

  live('watch (by an in-app click): action tags from the view-model data, theater, autoplay switch, speed through the player API, keep-alive', async () => {
    await t.configure({ 'yt.watch.hideThanks': true, 'yt.watch.autoTheater': true, 'yt.watch.disableAutoplay': true, 'yt.watch.defaultSpeed': '1.5', 'yt.watch.dismissStillWatching': true });
    await paced('https://www.youtube.com/results?search_query=how+to+cook+rice');
    await t.until(() => t.run(() => document.querySelector('ytd-video-renderer a#video-title')), 'search results', 20_000);
    await t.driver.findElement(By.css('ytd-video-renderer a#video-title')).click();
    await t.until(async () => /\/watch\?v=/.test(await t.driver.getCurrentUrl()), 'the watch page', 20_000);
    await expectRendered(() => t.run(() => document.querySelectorAll('ytd-watch-metadata #top-level-buttons-computed > *').length >= 2), 'the buttons under the video', 25_000);
    await t.until(() => t.run(() => document.querySelectorAll('ytd-watch-metadata [data-at-peace-action]').length >= 3), 'action tags', 20_000);
    const tags = await t.run(() => [...document.querySelectorAll('ytd-watch-metadata [data-at-peace-action]')].map((e) => [e.localName + (e.getAttribute('id') ? `#${e.getAttribute('id')}` : ''), e.getAttribute('data-at-peace-action')]));
    const byTag = Object.fromEntries(tags.map(([el, tag]) => [tag, el]));
    assert.equal(byTag.like, 'segmented-like-dislike-button-view-model', JSON.stringify(tags));
    assert.equal(byTag.share, 'yt-button-view-model');
    assert.equal(byTag.download, 'ytd-download-button-renderer');
    assert.equal(byTag.save, 'yt-button-view-model');
    assert.equal(byTag.more, 'yt-button-shape#button-shape');
    for (const [el] of tags) assert.ok(!/^(ytd-menu-renderer|div#(actions|actions-inner|menu|top-level-buttons-computed|flexible-item-buttons))$/.test(el), `a container was tagged: ${el}`);
    await t.until(() => t.run(() => document.querySelector('ytd-watch-flexy')?.hasAttribute('theater')), 'theater mode', 20_000);
    assert.match(await t.run(() => document.cookie), /wide=1/);
    // Autoplay switch: Firefox's player is "unstarted" here (no playback in the sandbox), so its controls are hidden
    // and a click on the switch does nothing (measured). The switch exists; the click path is verified in Chromium,
    // and the player-API path (bridge setAutonav) is exercised below. Not verifiable here: its effect at the end of a video.
    assert.equal(await t.run(() => document.querySelectorAll('ytd-watch-flexy .ytp-autonav-toggle-button').length), 1);
    // The player API through the bridge, driven from the page itself (a page-originated hello replaces the nonce, which
    // is exactly why the nonce is not a secret: the commands are harmless). Speed was set by the speed feature.
    const ask = (cmd, ...args) =>
      t.driver.executeAsyncScript((c, a, done) => {
        const nonce = 'firefox-test-nonce-0123456789';
        const onMessage = (e) => {
          const m = e.data;
          if (m && m.ns === 'at-peace' && m.dir === 'res' && m.nonce === nonce) {
            window.removeEventListener('message', onMessage);
            done(m);
          }
        };
        window.addEventListener('message', onMessage);
        window.postMessage({ ns: 'at-peace', dir: 'hello', nonce }, location.origin);
        setTimeout(() => window.postMessage({ ns: 'at-peace', dir: 'cmd', nonce, id: 7, cmd: c, args: a }, location.origin), 200);
        setTimeout(() => done({ timeout: true }), 5000);
      }, cmd, args);
    await t.until(async () => (await ask('getPlaybackRate')).value === 1.5, 'the player at 1.5x (set through the bridge by the speed feature)', 20_000);
    assert.equal((await ask('keepActive')).ok, true);
    assert.deepEqual(await ask('eval', '1+1'), { ns: 'at-peace', dir: 'res', nonce: 'firefox-test-nonce-0123456789', id: 7, ok: false, error: 'bad-command' });
    assert.equal(await t.run(() => document.querySelector('ytd-watch-flexy video').playbackRate), 1.5, 'the <video> follows');
    await t.shot('firefox-live-watch');
    assert.deepEqual(await t.ourErrors(), []);
  });

  live('channel: tabs tagged from the page data, the Shorts and Posts tabs hidden by tag alone', async () => {
    await t.configure({ 'yt.channel.hideShortsTab': true, 'yt.channel.hidePostsTab': true });
    await paced('https://www.youtube.com/@veritasium/videos');
    await t.until(() => t.run(() => document.querySelectorAll('yt-tab-shape[data-at-peace-tab]').length >= 4), 'tab tags', 20_000);
    const tabs = await t.run(() => Object.fromEntries([...document.querySelectorAll('yt-tab-shape')].map((tab) => [tab.getAttribute('tab-title'), [tab.getAttribute('data-at-peace-tab'), getComputedStyle(tab).display === 'none']])));
    assert.deepEqual(tabs.Home, ['home', false]);
    assert.deepEqual(tabs.Videos, ['videos', false]);
    assert.deepEqual(tabs.Shorts, ['shorts', true]);
    assert.deepEqual(tabs.Posts, ['posts', true]);
    await t.shot('firefox-live-channel-tabs');
    assert.deepEqual(await t.ourErrors(), []);
  });
});
