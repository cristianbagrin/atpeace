// Phase 3c, Chromium: ONE load of the real youtube.com (every other Mindful Pause spec stubs it, and
// several agents share this machine's IP, which Google rate-limits with a captcha). Pause → continue
// → the real site loads with our content scripts → the session ends → overlay → a block arrives.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { launch, close, extUrl, evalInExtension } from './harness.mjs';
import { send, resetStorage, configure, newTab, shot, waitPauseState, ourErrors, readState } from './_mindful.mjs';

before(async () => {
  await launch();
});
after(async () => {
  await close();
});

test('real youtube.com: pause, continue, expiry overlay, then a block', async (t) => {
  await resetStorage();
  await configure({ 'pause.enabled': true, 'pause.breathSeconds': 3 });
  const page = await newTab();
  await page.goto('https://www.youtube.com/watch?v=aqz-KE-bpKQ', { waitUntil: 'domcontentloaded' });
  assert.ok(page.url().startsWith(extUrl('src/pages/pause/pause.html')), 'redirected to the pause page before any request went out');
  await waitPauseState(page, 'choosing');
  await page.click('#continue');
  await page.waitForURL((u) => u.protocol !== 'chrome-extension:', { timeout: 20_000 });
  if (page.url().includes('/sorry/')) return t.skip('Google served its captcha page (/sorry/); try again later');
  assert.equal(new URL(page.url()).hostname, 'www.youtube.com');
  await page.waitForFunction(() => document.documentElement.getAttribute('data-at-peace-loaded') === '1', null, { timeout: 20_000 });
  assert.ok(page.url().startsWith('https://www.youtube.com/watch?v=aqz-KE-bpKQ'));
  assert.ok((await readState()).state.sessions.youtube > Date.now());

  // The session ends in 3 seconds: the video (if any) stops and the overlay appears.
  await evalInExtension(async (end) => {
    const { state } = await chrome.storage.local.get('state');
    await chrome.storage.local.set({ state: { ...state, sessions: { youtube: end } } });
  }, Date.now() + 3000);
  await page.waitForSelector('[data-at-peace-overlay]', { state: 'attached', timeout: 15_000 });
  assert.equal(await page.evaluate(() => [...document.querySelectorAll('video')].every((v) => v.paused)), true);
  await page.waitForTimeout(600);
  await shot(page, 'session-expiry-overlay-live');

  // A new session (another tab) lets the person back in; then a block closes the tab's YouTube.
  await evalInExtension(async (end) => {
    const { state } = await chrome.storage.local.get('state');
    await chrome.storage.local.set({ state: { ...state, sessions: { youtube: end } } });
  }, Date.now() + 120_000);
  await page.waitForFunction(() => !document.querySelector('[data-at-peace-overlay]'), null, { timeout: 8000 });
  assert.equal(await page.evaluate(() => document.body.inert), false);
  await send('FOCUS_START', { minutes: 25 });
  await page.waitForURL((u) => u.pathname.endsWith('/blocked.html'), { timeout: 10_000 });
  assert.ok(page.url().includes('reason=focus#https://www.youtube.com/watch?v=aqz-KE-bpKQ'));
  assert.deepEqual(ourErrors(page), []);
  await page.close();
});
