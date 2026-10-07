// Phase 7c (feedback item 13), Chromium: the "Your N minutes are up." overlay on a YouTube watch page.
//
//   Leave YouTube · Finish this video · Breathe again   (elsewhere: Leave · Breathe again)
//   Esc = Finish this video on a watch page, Breathe again elsewhere; both show a small hint.
//   Finish this video: the overlay steps aside, the video plays on, and the overlay is back when it ends
//     or when another video / page is opened (before the next video can start).
//   Breathe again: IN PLACE (no navigation, no reload): the breath, then "Continue for [5 … 1 h]".
//
// www.youtube.com is a small offline stand-in (nothing goes to Google): a watch page with a REAL media
// element (a generated WAV of 20 s, muted) inside #movie_player, whose end the tests trigger with
// `currentTime = duration`, and a window.__spa(url) that does what YouTube's SPA navigation does
// (yt-navigate-start, pushState, yt-navigate-finish). The content scripts inject because the URL matches.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { launch, close, getContext, extUrl, evalInExtension, extensionDiagnostics, ARTIFACTS, trackErrors } from './harness.mjs';
import { send, resetStorage, configure, settle, dnrRules, readState, newTab, today, ourErrors } from './_mindful.mjs';
import { readOverlay, clickInOverlay, waitOverlay, waitNoOverlay, overlayView } from './_overlay.mjs';
import { until } from '../helpers/wait.mjs';
import { stubPage as PAGE } from '../helpers/overlay-stub.mjs';

const SHOTS = join(ARTIFACTS, 'round1', '7c');
const WATCH = 'https://www.youtube.com/watch?v=abc';
const HOME = 'https://www.youtube.com/';

let hits;

before(async () => {
  await launch();
  await mkdir(SHOTS, { recursive: true });
  hits = [];
  await getContext().route(/^https:\/\/www\.youtube\.com\//, (route) => {
    const url = new URL(route.request().url());
    hits.push(url.href);
    route.fulfill({ status: 200, contentType: 'text/html', body: PAGE(url.pathname === '/watch' ? 'Watch (stub)' : 'Home (stub)') });
  });
});
after(async () => {
  await close();
});
beforeEach(async () => {
  hits.length = 0;
  await resetStorage();
  await configure({ 'pause.enabled': true, 'pause.breathSeconds': 3 });
});

const shot = (page, name) => page.screenshot({ path: join(SHOTS, `${name}.png`) });

/** A page with a running 5 minute session (so no pause page) whose video plays. */
async function open(url = WATCH, { play = true } = {}) {
  assert.equal((await send('PAUSE_CONTINUE', { siteKey: 'youtube', minutes: 5 })).ok, true);
  const page = await newTab();
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.getAttribute('data-at-peace-loaded') === '1');
  await page.waitForFunction(() => document.getElementById('v').readyState >= 1);
  if (play) {
    await page.evaluate(() => document.getElementById('v').play());
    await page.waitForFunction(() => document.getElementById('v').currentTime > 0.3, null, { timeout: 8000 });
  }
  page.navigations = 0;
  page.on('framenavigated', (frame) => frame === page.mainFrame() && page.navigations++);
  return page;
}

/** Makes the running session end in `ms` (the page and the background both follow storage). */
async function expireSoon(ms = 800) {
  await evalInExtension(
    async (end) => {
      const { state = {} } = await chrome.storage.local.get('state');
      await chrome.storage.local.set({ state: { ...state, sessions: { youtube: end }, sessionMinutes: { youtube: 5 } } });
    },
    Date.now() + ms,
  );
}

const video = (page) => page.evaluate(() => {
  const v = document.getElementById('v');
  return { paused: v.paused, ended: v.ended, time: v.currentTime, duration: v.duration };
});
const bodyInert = (page) => page.evaluate(() => document.body.inert);
const labels = (info) => info.buttons.map((b) => b.label);

/** Waits until the overlay's first button has the focus (Escape and Tab need it inside). */
async function settled(page, view = 'note') {
  await waitOverlay(page, view);
  await until(async () => (await readOverlay(page))?.focused, { what: 'focus inside the overlay', timeout: 5000 });
  return readOverlay(page);
}

test('on a watch page: a title and three choices, Leave YouTube first, a hint for Esc; the video is paused behind it', async () => {
  const page = await open();
  await expireSoon();
  const info = await settled(page);
  assert.equal(info.title, 'Your 5 minutes are up.');
  assert.deepEqual(info.body, [], 'no sentence under the title');
  assert.deepEqual(labels(info), ['Leave YouTube', 'Finish this video', 'Breathe again']);
  assert.deepEqual(info.buttons.map((b) => b.primary), [true, false, false]);
  assert.equal(info.hint, 'Esc: finish this video');
  assert.equal(info.focused, 'Leave YouTube');
  assert.equal((await video(page)).paused, true);
  assert.equal(await bodyInert(page), true, 'the page behind is not reachable');
  await shot(page, 'overlay-watch-choices');
  assert.deepEqual(ourErrors(page), []);
  await page.close();
});

test('Esc on a watch page is "Finish this video": the overlay goes, the video plays on, and it comes back when the video ends', async () => {
  const page = await open();
  await expireSoon();
  await settled(page);
  const before = await video(page);
  await page.keyboard.press('Escape');
  await waitNoOverlay(page);
  assert.equal(await bodyInert(page), false, 'the page is the person\'s again');
  await page.waitForFunction((t) => document.getElementById('v').currentTime > t + 0.3 && !document.getElementById('v').paused, before.time, { timeout: 8000 });
  assert.equal(page.navigations, 0);

  // The video ends: the overlay is back at once, the media is paused, and there is nothing left to finish.
  await page.evaluate(() => { const v = document.getElementById('v'); v.currentTime = v.duration; });
  const back = await settled(page);
  assert.equal(back.title, 'Your 5 minutes are up.');
  assert.deepEqual(labels(back), ['Leave', 'Breathe again']);
  assert.equal(back.hint, 'Esc: breathe');
  const ended = await video(page);
  assert.equal(ended.ended, true);
  assert.equal(ended.paused, true);
  await shot(page, 'overlay-after-video-ended');
  assert.equal(page.navigations, 0);
  assert.deepEqual(ourErrors(page), []);
  await page.close();
});

test('"Finish this video" by click does the same; another video opened meanwhile brings the overlay back before it can play', async () => {
  const page = await open();
  await expireSoon();
  await settled(page);
  await clickInOverlay(page, 'Finish this video');
  await waitNoOverlay(page);
  await page.waitForFunction(() => !document.getElementById('v').paused);

  // The person (or autoplay) opens the next video: YouTube's navigation event comes first.
  await page.evaluate((url) => window.__spa(url), '/watch?v=next');
  const back = await settled(page);
  assert.deepEqual(labels(back), ['Leave YouTube', 'Finish this video', 'Breathe again'], 'a new video can be finished too');
  assert.equal((await video(page)).paused, true);
  // …and the next video starting to play is paused again while the overlay is up.
  await page.evaluate(() => document.getElementById('v').play().catch(() => {}));
  await page.waitForFunction(() => document.getElementById('v').paused, null, { timeout: 3000 });
  await page.close();
});

test('opening a page without a video (home) brings it back with Leave · Breathe again; the same video\'s time link does not', async () => {
  const page = await open();
  await expireSoon();
  await settled(page);
  await page.keyboard.press('Escape');
  await waitNoOverlay(page);
  await page.evaluate(() => window.__spa('/watch?v=abc&t=30s')); // the same video
  await page.waitForTimeout(500);
  assert.equal(await overlayView(page), null);
  await page.evaluate(() => window.__spa('/'));
  const back = await settled(page);
  assert.deepEqual(labels(back), ['Leave', 'Breathe again']);
  assert.equal(back.hint, 'Esc: breathe');
  await page.close();
});

test('Back to another page (popstate) brings it back too', async () => {
  const page = await open(HOME, { play: false });
  await page.evaluate(() => window.__spa('/watch?v=abc'));
  await page.evaluate(() => document.getElementById('v').play());
  await expireSoon();
  await settled(page);
  assert.equal((await readOverlay(page)).hint, 'Esc: finish this video');
  await page.keyboard.press('Escape');
  await waitNoOverlay(page);
  await page.evaluate(() => history.back());
  const back = await settled(page);
  assert.deepEqual(labels(back), ['Leave', 'Breathe again']);
  await page.close();
});

test('Breathe again happens IN PLACE: no navigation, no reload, the same video position; then Continue for N min', async () => {
  const page = await open();
  const marker = await page.evaluate(() => window.__marker);
  await expireSoon();
  await settled(page);
  const paused = await video(page);

  await clickInOverlay(page, 'Breathe again');
  const breath = await waitOverlay(page, 'breath').then(() => readOverlay(page));
  assert.equal(breath.dial, true, 'the breathing dial: sixty ticks and the mint disc');
  assert.match(breath.title, /^Breathe in…|…and out$/);
  assert.deepEqual(breath.buttons, [], 'nothing to press while breathing');
  assert.equal(page.url(), WATCH);
  await page.waitForTimeout(900);
  await shot(page, 'overlay-breathing');

  // After the breath (3 s): "Continue?" with the minutes, counted like a visit to the pause page.
  const choice = await waitOverlay(page, 'choice', 8000).then(() => readOverlay(page));
  assert.equal(choice.kicker, 'first time today');
  assert.equal(choice.title, 'Continue?');
  assert.deepEqual(labels(choice), ['Leave YouTube', 'Continue for']);
  assert.deepEqual(choice.chips.map((c) => c.label), ['5 min', '10 min', '15 min', '30 min', '1 h']);
  assert.equal(choice.chips.find((c) => c.pressed).label, '15 min', 'the pause setting\'s default');
  assert.equal((await readState()).stats[today()].youtube.opens, 1);
  await page.waitForTimeout(500);
  await shot(page, 'overlay-choice');

  await clickInOverlay(page, '10 min');
  assert.equal((await readOverlay(page)).chips.find((c) => c.pressed).label, '10 min');
  await clickInOverlay(page, 'Continue for');
  await waitNoOverlay(page);

  // A new session, the page was never reloaded, the video goes on where it was.
  assert.equal(page.navigations, 0, 'no navigation');
  assert.equal(page.url(), WATCH);
  assert.equal(await page.evaluate(() => window.__marker), marker, 'not reloaded');
  assert.equal(await bodyInert(page), false);
  await page.waitForFunction((t) => !document.getElementById('v').paused && document.getElementById('v').currentTime >= t, paused.time, { timeout: 8000 });
  const { state } = await readState();
  assert.ok(Math.abs(state.sessions.youtube - (Date.now() + 10 * 60_000)) < 20_000, 'a 10 minute session');
  assert.equal(state.sessionMinutes.youtube, 10);
  assert.deepEqual(await dnrRules(), [], 'no pause rule while the session runs');
  assert.deepEqual(hits.length, 1, 'youtube.com was loaded once');
  assert.deepEqual(ourErrors(page), []);
  await page.close();
});

test('Esc without a video on the page is "Breathe again"; the breath and the choice then ignore Esc', async () => {
  const page = await open(HOME, { play: false });
  await expireSoon();
  const info = await settled(page);
  assert.deepEqual(labels(info), ['Leave', 'Breathe again']);
  assert.equal(info.hint, 'Esc: breathe');
  await shot(page, 'overlay-plain-choices');
  await page.keyboard.press('Escape');
  await waitOverlay(page, 'breath');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  assert.equal(await overlayView(page), 'breath', 'Esc does not skip the breath');
  await waitOverlay(page, 'choice', 8000);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  assert.equal(await overlayView(page), 'choice', 'Esc does not choose for the person');
  assert.equal(page.navigations, 0);
  await page.close();
});

test('keys never reach the page while the overlay is up (k, j, f, m… are YouTube\'s shortcuts); Tab stays inside', async () => {
  const page = await open();
  await expireSoon();
  await settled(page);
  const keys = await page.evaluate(() => window.__keys);
  for (const key of ['k', 'j', 'ArrowRight', 'f', 'm']) await page.keyboard.press(key); // YouTube's own shortcuts
  assert.equal(await page.evaluate(() => window.__keys), keys, 'the page saw no key');
  assert.equal((await video(page)).paused, true);
  for (let i = 0; i < 4; i++) await page.keyboard.press('Tab');
  assert.equal(await overlayView(page), 'note');
  assert.ok((await readOverlay(page)).focused, 'the focus is still inside');
  assert.equal(await bodyInert(page), true);
  await page.close();
});

test('prefers-reduced-motion: the disc does not scale, a countdown shows, and the breath still ends in the choice', async () => {
  const page = await open();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expireSoon();
  await settled(page);
  await clickInOverlay(page, 'Breathe again');
  await waitOverlay(page, 'breath');
  await page.waitForTimeout(500);
  const info = await readOverlay(page);
  assert.match(info.countdown ?? '', /^00:0[0-3]$/);
  assert.equal(info.sun, 'matrix(0.8, 0, 0, 0.8, 0, 0)', 'the size never changes');
  await shot(page, 'overlay-breathing-reduced-motion');
  await waitOverlay(page, 'choice', 8000);
  assert.equal((await readOverlay(page)).countdown, null);
  await page.close();
});

test('Leave closes the tab', async () => {
  const opener = await newTab();
  await opener.goto('about:blank');
  await send('PAUSE_CONTINUE', { siteKey: 'youtube', minutes: 5 });
  const page = await newTab();
  await page.goto(HOME, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.getAttribute('data-at-peace-loaded') === '1');
  await expireSoon();
  await settled(page);
  const closed = new Promise((resolve) => page.once('close', resolve));
  await clickInOverlay(page, 'Leave');
  await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(new Error('tab did not close')), 8000))]);
  await opener.close();
});

test('Leave after a breath closes the tab and counts as turned back (the first Leave counts nothing)', async () => {
  const opener = await newTab();
  await opener.goto('about:blank');
  await send('PAUSE_CONTINUE', { siteKey: 'youtube', minutes: 5 });
  const page = await newTab();
  await page.goto(HOME, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.getAttribute('data-at-peace-loaded') === '1');
  await expireSoon();
  await settled(page);
  await clickInOverlay(page, 'Breathe again');
  await waitOverlay(page, 'choice', 8000);
  const closed = new Promise((resolve) => page.once('close', resolve));
  await clickInOverlay(page, 'Leave');
  await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(new Error('tab did not close')), 8000))]);
  const { stats } = await readState();
  assert.equal(stats[today()].youtube.turnedBack, 1);
  assert.equal(stats[today()].youtube.opens, 1);
  assert.equal(stats[today()].youtube.continued, 1, 'only the session that ended; the breath was not continued');
  await opener.close();
});

test('a focus block that starts during the breath sends the tab to the blocked page', async () => {
  const page = await open(HOME, { play: false });
  await expireSoon();
  await settled(page);
  await clickInOverlay(page, 'Breathe again');
  await waitOverlay(page, 'breath');
  assert.equal((await send('FOCUS_START', { minutes: 25 })).ok, true);
  await page.waitForURL((u) => u.pathname.endsWith('/blocked.html'), { timeout: 8000 });
  await page.close();
});

test('a session started in another tab takes the overlay away from this one (nothing is left inert)', async () => {
  const page = await open();
  await expireSoon();
  await settled(page);
  assert.equal((await send('PAUSE_CONTINUE', { siteKey: 'youtube', minutes: 10 })).ok, true);
  await waitNoOverlay(page);
  assert.equal(await bodyInert(page), false);
  await settle();
  await page.close();
});

test('Chromium reports no runtime errors from the extension after all of this', async () => {
  const diagnostics = await extensionDiagnostics();
  assert.deepEqual(diagnostics.runtimeErrors, []);
  assert.deepEqual(diagnostics.manifestErrors, []);
  assert.ok(typeof trackErrors === 'function' && typeof extUrl === 'function');
});
