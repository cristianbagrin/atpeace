// Feedback item 13 in REAL Firefox (headless, Selenium + geckodriver): the "Your N minutes are up." overlay on a
// YouTube watch page. Same core flow as tests/e2e/overlay.spec.mjs, with one difference: Selenium cannot look into
// the overlay's closed shadow root, so it is driven with the keyboard (Tab / Enter / Esc, the way a person can)
// and read through the two attributes its host shows the page: the title and the view (note | breath | choice).
//
// www.youtube.com is a local stand-in (tests/helpers/overlay-stub.mjs: a watch page with a real, muted media
// element and window.__spa(url) for single-page navigation), served over http by a local server; nothing goes to
// Google. Prerequisite: bash tests/firefox/setup.sh.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Key } from 'selenium-webdriver';
import { launchFirefox, extUrl, ROOT, NAVIGATION_NOISE } from './_harness.mjs';
import { stubPage } from '../helpers/overlay-stub.mjs';
import { until } from '../helpers/wait.mjs';

const SHOTS = join(ROOT, 'tests', 'e2e', 'artifacts', 'round1', '7c');
let ff;
let driver;
let server;
let origin;
let extHandle = null;

before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(stubPage(url.pathname === '/watch' ? 'Watch (stub)' : 'Home (stub)'));
  });
  await new Promise((resolve) => server.listen(0, resolve));
  origin = `http://www.youtube.com:${server.address().port}`;
  ff = await launchFirefox({
    prefs: {
      'network.dns.localDomains': 'www.youtube.com',
      'network.proxy.no_proxies_on': 'localhost, 127.0.0.1, www.youtube.com',
      'network.stricttransportsecurity.preloadlist': false, // youtube.com is HSTS-preloaded: keep our local http page http
    },
  });
  driver = ff.driver;
  await driver.manage().window().setRect({ width: 1280, height: 720 });
  await mkdir(SHOTS, { recursive: true });
});

after(async () => {
  await ff?.close();
  await new Promise((resolve) => server?.close(resolve));
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const shot = async (name) => writeFile(join(SHOTS, `${name}.png`), await driver.takeScreenshot(), 'base64');

/** Runs fn in a dedicated tab on an extension page (so messages and storage work), then returns to the tab we came from. */
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

const send = (type, payload) =>
  inExt(() => driver.executeAsyncScript((t, p, done) => browser.runtime.sendMessage({ type: t, payload: p }).then(done, (e) => done({ __error: String(e) })), type, payload ?? null));
const storage = (keys) => inExt(() => driver.executeAsyncScript((k, done) => browser.storage.local.get(k).then(done, (e) => done({ __error: String(e) })), keys));

async function reset() {
  await inExt(() =>
    driver.executeAsyncScript(async (done) => {
      await browser.storage.local.clear();
      await browser.storage.session.clear();
      for (const alarm of await browser.alarms.getAll()) await browser.alarms.clear(alarm.name);
      done(true);
    }),
  );
  await sleep(150);
  await send('GET_STATUS');
  await ff.setStorage({ settings: { 'pause.enabled': true, 'pause.breathSeconds': 3 } });
  await sleep(150);
  await send('GET_STATUS');
}

const view = () => driver.executeScript(() => document.querySelector('[data-at-peace-overlay]')?.getAttribute('data-at-peace-view') ?? null);
const title = () => driver.executeScript(() => document.querySelector('[data-at-peace-overlay]')?.getAttribute('data-at-peace-overlay') ?? null);
const waitView = (wanted, timeout = 10_000) => driver.wait(async () => (await view()) === wanted, timeout, `the overlay never showed "${wanted}"`);
const video = () => driver.executeScript(() => { const v = document.getElementById('v'); return { paused: v.paused, ended: v.ended, time: v.currentTime }; });
const press = (...keys) => driver.actions().sendKeys(...keys).perform();

/** A page with a running 5 minute session (so no pause page) and a playing video. */
async function open(path = '/watch?v=abc', { play = true } = {}) {
  assert.equal((await send('PAUSE_CONTINUE', { siteKey: 'youtube', minutes: 5 })).ok, true);
  await driver.get(`${origin}${path}`);
  await until(() => driver.executeScript(() => document.documentElement.getAttribute('data-at-peace-loaded') === '1'), 'the content script', 20_000);
  await until(() => driver.executeScript(() => document.getElementById('v').readyState >= 1), 'the media', 10_000);
  if (play) {
    await driver.executeScript(() => document.getElementById('v').play());
    await until(async () => (await video()).time > 0.3, 'the video to play', 10_000);
  }
}

/** The session ends in `ms`. */
async function expireSoon(ms = 800) {
  const { state = {} } = await storage('state');
  await ff.setStorage({ state: { ...state, sessions: { youtube: Date.now() + ms }, sessionMinutes: { youtube: 5 } } });
}

/** The overlay is up and has the focus inside (Tab and Esc need it there). */
async function noteUp(expectedView = 'note') {
  await waitView(expectedView);
  await sleep(500); // the focus moves to the first button on the next frame
}

test('Esc on a watch page is "Finish this video": the video plays on; when it ends the overlay is back; Esc is then "Breathe again"', async () => {
  await reset();
  await open();
  await expireSoon();
  await noteUp();
  assert.equal(await title(), 'Your 5 minutes are up.');
  assert.equal((await video()).paused, true, 'paused behind the overlay');
  assert.equal(await driver.executeScript(() => document.body.inert), true);
  await shot('firefox-overlay-watch');

  const before = await video();
  await press(Key.ESCAPE);
  await until(async () => (await view()) === null, 'the overlay to step aside', 5000);
  assert.equal(await driver.executeScript(() => document.body.inert), false);
  await until(async () => {
    const v = await video();
    return !v.paused && v.time > before.time + 0.3;
  }, 'the video to play on', 8000);

  // The video ends: the overlay is back, the media paused; nothing left to finish, so Esc breathes.
  await driver.executeScript(() => { const v = document.getElementById('v'); v.currentTime = v.duration; });
  await waitView('note');
  const ended = await video();
  assert.equal(ended.ended, true);
  assert.equal(ended.paused, true);
  await sleep(500);
  await press(Key.ESCAPE);
  await waitView('breath');
  await shot('firefox-overlay-breath');
  await waitView('choice', 8000);
  await shot('firefox-overlay-choice');
  const { stats } = await storage('stats');
  assert.equal(Object.values(stats)[0].youtube.opens, 1, 'counted like a visit to the pause page');
});

test('Breathe again happens IN PLACE: same page, same video position; Continue starts a new session and the video goes on', async () => {
  await reset();
  await open();
  const marker = await driver.executeScript(() => window.__marker);
  const url = await driver.getCurrentUrl();
  await expireSoon();
  await noteUp();
  const paused = await video();

  await press(Key.TAB, Key.TAB, Key.ENTER); // Leave YouTube → Finish this video → Breathe again
  await waitView('breath');
  assert.equal(await driver.getCurrentUrl(), url, 'no navigation');
  await waitView('choice', 8000);
  await sleep(400);
  await press(Key.TAB, Key.ENTER); // Leave YouTube (focused) → Continue for [15 min]
  await until(async () => (await view()) === null, 'the overlay to go', 8000);

  assert.equal(await driver.getCurrentUrl(), url);
  assert.equal(await driver.executeScript(() => window.__marker), marker, 'not reloaded');
  assert.equal(await driver.executeScript(() => document.body.inert), false);
  await until(async () => {
    const v = await video();
    return !v.paused && v.time >= paused.time;
  }, 'the video to resume where it was', 8000);
  const { state } = await storage('state');
  assert.ok(Math.abs(state.sessions.youtube - (Date.now() + 15 * 60_000)) < 30_000, 'a 15 minute session');
  assert.deepEqual((await ff.ourScriptErrors()).filter((e) => !NAVIGATION_NOISE.test(e)), []);
});

test('another video opened while finishing brings the overlay back before it can play; the same video\'s time link does not', async () => {
  await reset();
  await open();
  await expireSoon();
  await noteUp();
  await press(Key.TAB, Key.ENTER); // Finish this video
  await until(async () => (await view()) === null, 'the overlay to step aside', 5000);
  await driver.executeScript(() => window.__spa('/watch?v=abc&t=30s')); // the same video: nothing happens
  await sleep(600);
  assert.equal(await view(), null);
  await driver.executeScript(() => window.__spa('/watch?v=next'));
  await waitView('note');
  assert.equal((await video()).paused, true);
  await driver.executeScript(() => document.getElementById('v').play().catch(() => {}));
  await until(async () => (await video()).paused, 'the next video to be paused again', 4000);
});

test('Leave closes the tab it is in', async () => {
  await reset();
  const first = await driver.getWindowHandle();
  await driver.switchTo().newWindow('tab');
  const mine = await driver.getWindowHandle();
  await open('/', { play: false });
  await expireSoon();
  await noteUp();
  const handles = await driver.getAllWindowHandles();
  assert.ok(handles.includes(mine));
  await press(Key.ENTER); // Leave (focused)
  await until(async () => !(await driver.getAllWindowHandles()).includes(mine), 'the tab to close', 8000);
  await driver.switchTo().window(first);
});
