// Phase 3c, Chromium: the Mindful Pause end to end. A navigation to youtube.com is redirected by a
// DNR rule to the pause page; the breath, the choice, Continue / Close, the session, its expiry
// overlay on the YouTube tab. youtube.com itself is stubbed (see _mindful.mjs) except in the one
// test at the end that loads the real site once.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { launch, close, getContext, extUrl, openExtPage, evalInExtension, extensionDiagnostics, trackErrors } from './harness.mjs';
import { stubYouTube, send, resetStorage, configure, settle, dnrRules, readState, newTab, shot, waitPauseState, today, ourErrors } from './_mindful.mjs';

let stub;
const YT = 'https://www.youtube.com/';
const WATCH = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';

before(async () => {
  await launch();
  stub = await stubYouTube();
});
after(async () => {
  await close();
});
beforeEach(async () => {
  stub.hits.length = 0;
  await resetStorage();
  await configure({ 'pause.enabled': true, 'pause.breathSeconds': 3 });
});

test('a youtube.com load is redirected to the pause page with the original URL, and a pause rule exists', async () => {
  const rules = await dnrRules();
  assert.equal(rules.length, 1);
  assert.equal(rules[0].id, 200);
  assert.equal(rules[0].priority, 200);
  const page = await newTab();
  await page.goto(WATCH, { waitUntil: 'domcontentloaded' });
  assert.equal(page.url(), `${extUrl('src/pages/pause/pause.html')}#${WATCH}`);
  await waitPauseState(page, 'breathing');
  assert.equal(await page.locator('#target').count(), 0, 'the address is not shown');
  assert.equal(await page.locator('#foot-hint').textContent(), 'Press Esc to close');
  assert.equal(await page.evaluate((url) => document.body.innerText.includes(url), WATCH), false, 'the address appears nowhere on the page');
  assert.equal(await page.locator('h1').textContent(), 'At Peace');
  assert.equal(stub.hits.length, 0, 'nothing reached youtube.com');
  assert.deepEqual(ourErrors(page), []);
  await page.close();
});

test('the breath: guidance changes, the sun is animated, Continue stays disabled until it is over', async () => {
  const page = await newTab();
  await page.goto(WATCH, { waitUntil: 'domcontentloaded' });
  await waitPauseState(page, 'breathing');
  assert.equal(await page.evaluate(() => document.body.dataset.breath), '3');
  assert.equal(await page.locator('#guidance').textContent(), 'Breathe in…');
  assert.equal(await page.locator('#continue').isDisabled(), true);
  assert.equal(await page.locator('#close').isDisabled(), true);
  // The sun is really animating (the Web Animations API reports a running animation).
  const running = await page.evaluate(() => document.getAnimations().filter((a) => a.effect?.target?.id === 'sun' && a.playState === 'running').length);
  assert.equal(running, 1);
  await page.waitForFunction(() => document.getElementById('guidance').textContent === '…and out', null, { timeout: 4000 });
  await page.waitForTimeout(300);
  await shot(page, 'pause-mid-breath-out');
  await waitPauseState(page, 'choosing');
  assert.equal(await page.locator('#continue').isEnabled(), true);
  assert.equal(await page.locator('#close').isEnabled(), true);
  await page.close();
});

test('the choice: the count above the question, defaults, no intention field, screenshot', async () => {
  const page = await newTab();
  await page.goto(WATCH, { waitUntil: 'domcontentloaded' });
  await waitPauseState(page, 'choosing');
  assert.equal(await page.locator('#kicker').textContent(), 'first time today');
  assert.equal(await page.locator('#count-line').count(), 0, 'no second, hidden sentence for the same fact');
  assert.equal(await page.locator('#question').textContent(), 'Open YouTube?');
  assert.equal(await page.locator('#close').textContent(), 'Close YouTube');
  assert.equal(await page.locator('#minutes').inputValue(), '15');
  assert.equal(await page.locator('#intention, #intention-wrap, input[type=text]').count(), 0, 'nothing to type on the pause page');
  assert.equal(await page.locator('#continue').textContent(), 'Continue for');
  await shot(page, 'pause-choice');
  await page.close();
});

test('the open counter increments with every visit (first, 2nd, 3rd)', async () => {
  const words = [];
  for (let i = 0; i < 3; i++) {
    const page = await newTab();
    await page.goto(YT, { waitUntil: 'domcontentloaded' });
    await waitPauseState(page, 'choosing');
    words.push(await page.locator('#kicker').textContent());
    await page.close();
  }
  assert.deepEqual(words, ['first time today', '2nd time today', '3rd time today']);
  const { stats } = await readState();
  assert.equal(stats[today()].youtube.opens, 3);
});

test('a reload of the pause page is not another visit', async () => {
  const page = await newTab();
  await page.goto(YT, { waitUntil: 'domcontentloaded' });
  await waitPauseState(page, 'choosing');
  await page.reload();
  await waitPauseState(page, 'choosing');
  assert.equal(await page.locator('#kicker').textContent(), 'first time today');
  await page.close();
});

test('the count and a second visit within the hour: nothing is switched off, the breath is always the same length', async () => {
  // Leftovers from 0.1.0 in storage ("show count" off, escalation on) change nothing: those settings are gone.
  await configure({ 'pause.enabled': true, 'pause.breathSeconds': 3, 'pause.showCount': false, 'pause.escalate': true, 'pause.escalateStep': 2 });
  const first = await newTab();
  await first.goto(YT, { waitUntil: 'domcontentloaded' });
  await waitPauseState(first, 'breathing');
  assert.equal(await first.evaluate(() => document.body.dataset.breath), '3');
  const second = await newTab();
  await second.goto(YT, { waitUntil: 'domcontentloaded' });
  await waitPauseState(second, 'breathing');
  assert.equal(await second.evaluate(() => document.body.dataset.breath), '3', 'no escalation');
  await waitPauseState(second, 'choosing');
  assert.equal(await second.locator('#kicker').textContent(), '2nd time today');
  await first.close();
  await second.close();
});

test('Continue: the session starts, the site loads, a second navigation in the session is NOT paused', async () => {
  const page = await newTab();
  await page.goto(WATCH, { waitUntil: 'domcontentloaded' });
  await waitPauseState(page, 'choosing');
  await page.selectOption('#minutes', '5');
  await page.click('#continue');
  await page.waitForURL(WATCH, { timeout: 10_000 });
  assert.equal(await page.title(), 'YouTube (stub)');
  assert.equal(stub.hits.length, 1);
  assert.deepEqual(ourErrors(page), []);

  const { state, stats } = await readState();
  assert.ok(Math.abs(state.sessions.youtube - (Date.now() + 5 * 60_000)) < 15_000);
  assert.equal(state.sessionMinutes.youtube, 5);
  assert.equal(stats[today()].youtube.continued, 1);
  assert.equal('intentions' in stats[today()].youtube, false, 'no intention is stored');
  assert.deepEqual(await dnrRules(), [], 'the pause rule is gone while the session runs');
  assert.ok(await page.evaluate(() => performance.getEntriesByType('navigation')[0].name.startsWith('https://www.youtube.com/')));

  await page.goto('https://www.youtube.com/feed/subscriptions', { waitUntil: 'domcontentloaded' });
  assert.equal(page.url(), 'https://www.youtube.com/feed/subscriptions');
  assert.equal(stub.hits.length, 2);
  // The pause page left no trace in the history: back goes to the page before it.
  await page.goBack();
  assert.equal(page.url(), WATCH);
  await page.close();
});

test('Continue also works with the keyboard: Enter on the focused button', async () => {
  const page = await newTab();
  await page.goto(YT, { waitUntil: 'domcontentloaded' });
  await waitPauseState(page, 'choosing');
  await page.focus('#continue');
  await page.keyboard.press('Enter');
  await page.waitForURL(YT, { timeout: 10_000 });
  await page.close();
});

test('Close goes back to where the person came from, and counts as turned back', async () => {
  const page = await newTab();
  await page.goto('about:blank');
  await page.goto(YT, { waitUntil: 'domcontentloaded' });
  await waitPauseState(page, 'choosing');
  await page.click('#close');
  await page.waitForURL('about:blank', { timeout: 10_000 });
  const { stats, state } = await readState();
  assert.equal(stats[today()].youtube.turnedBack, 1);
  assert.deepEqual(state?.sessions ?? {}, {});
  assert.equal(stub.hits.length, 0);
  await page.close();
});

/**
 * A tab opened by a link (target=_blank): its history starts at the pause page. The link sits on an
 * https page (a stub on opener.test): Chromium only lets a DNR redirect reach an extension page for
 * initiators that match web_accessible_resources, which an about:blank page does not.
 */
async function openLinkTab(url) {
  await getContext().route('https://opener.test/**', (route) =>
    route.fulfill({ status: 200, contentType: 'text/html', body: `<!doctype html><title>opener</title><a id="l" target="_blank" href="${url}">go</a>` }),
  );
  const opener = await newTab();
  await opener.goto('https://opener.test/');
  const [popup] = await Promise.all([getContext().waitForEvent('page'), opener.click('#l')]);
  trackErrors(popup);
  await popup.bringToFront(); // a background tab waits for its breath until it is looked at
  await popup.waitForLoadState('domcontentloaded');
  return { opener, popup };
}

test('Close in a tab with nothing to go back to closes the tab', async () => {
  const { opener, popup: page } = await openLinkTab(YT);
  await waitPauseState(page, 'choosing');
  assert.equal(await page.evaluate(() => history.length), 1);
  const closed = new Promise((resolve) => page.once('close', resolve));
  await page.click('#close');
  await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(new Error('tab did not close')), 8000))]);
  assert.equal(page.isClosed(), true);
  const { stats } = await readState();
  assert.equal(stats[today()].youtube.turnedBack, 1);
  await opener.close();
});

test('never a trap: if the background does not answer, Continue still navigates; if it refuses, the page says so and Close still works', async () => {
  const page = await newTab();
  await page.goto(WATCH, { waitUntil: 'domcontentloaded' });
  await waitPauseState(page, 'choosing');
  // The background refuses: a calm note, the button comes back.
  await page.evaluate(() => {
    chrome.runtime.sendMessage = () => Promise.resolve({ ok: false, error: 'handler-failed' });
  });
  await page.click('#continue');
  await page.waitForFunction(() => document.getElementById('note').textContent !== '');
  assert.match(await page.locator('#note').textContent(), /did not work/);
  assert.equal(await page.locator('#continue').isEnabled(), true);
  assert.equal(await page.locator('#continue').textContent(), 'Continue for');
  assert.equal(page.url().startsWith(extUrl('src/pages/pause/pause.html')), true);
  // The background does not answer at all: go on anyway.
  await page.evaluate(() => {
    chrome.runtime.sendMessage = () => Promise.reject(new Error('Could not establish connection. Receiving end does not exist.'));
  });
  await page.click('#continue');
  await page.waitForURL(WATCH, { timeout: 10_000 });
  await page.close();
});

test('Escape is Close; it never trips over the select', async () => {
  const { opener, popup: page } = await openLinkTab(YT);
  await waitPauseState(page, 'choosing');
  await page.focus('#minutes');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  assert.equal(page.isClosed(), false, 'Escape inside the select does not close the page');
  await page.focus('#close');
  const closed = new Promise((resolve) => page.once('close', resolve));
  await page.keyboard.press('Escape');
  await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(new Error('tab did not close')), 8000))]);
  await opener.close();
});

test('a session started in another tab turns this pause page into "continue" at once', async () => {
  const waiting = await newTab();
  await waiting.goto(WATCH, { waitUntil: 'domcontentloaded' });
  await waitPauseState(waiting, 'breathing');
  const other = await newTab();
  await other.goto(YT, { waitUntil: 'domcontentloaded' });
  await waitPauseState(other, 'choosing');
  await other.selectOption('#minutes', '10');
  await other.click('#continue');
  await other.waitForURL(YT, { timeout: 10_000 });

  await waitPauseState(waiting, 'session', 6000);
  assert.match(await waiting.locator('#session-line').textContent(), /^YouTube is open for (9|10) more minutes\.$/);
  assert.equal(await waiting.locator('#session-go').textContent(), 'Continue');
  assert.equal(await waiting.locator('#session-sub').count(), 0, 'no second sentence');
  assert.equal(await waiting.locator('#kicker').isHidden(), true, 'the headline says it already');
  await shot(waiting, 'pause-session-running');
  await waiting.click('#session-go');
  await waiting.waitForURL(WATCH, { timeout: 10_000 });
  await waiting.close();
  await other.close();
});

test('a pause page that names a site that is not paused shows "nothing to open" and cannot be used as a redirect', async () => {
  for (const hash of ['', '#', '#https://evil.example/phish', '#javascript:alert(1)', '#chrome://settings', '#not a url']) {
    const page = await openExtPage('src/pages/pause/pause.html');
    await page.goto(extUrl('src/pages/pause/pause.html') + hash);
    await waitPauseState(page, 'invalid');
    assert.equal(await page.locator('#invalid-close').isVisible(), true, hash);
    assert.equal(await page.locator('#invalid-line').textContent(), 'Nothing to open.');
    assert.equal(await page.locator('#invalid .lede').count(), 0, 'no explanation');
    assert.equal(await page.locator('#continue').isDisabled(), true);
    assert.equal(await page.locator('#foot-hint').isHidden(), true, 'Esc does nothing here, so the hint is not shown');
    assert.deepEqual(ourErrors(page), [], hash);
    if (hash === '') await shot(page, 'pause-invalid');
    await page.close();
  }
});

test('prefers-reduced-motion: no scaling, a soft fade and a countdown instead', async () => {
  const page = await newTab();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(YT, { waitUntil: 'domcontentloaded' });
  await waitPauseState(page, 'breathing');
  await page.waitForTimeout(500);
  assert.equal(await page.locator('#countdown').isVisible(), true);
  assert.match(await page.locator('#countdown').textContent(), /^00:0[0-3]$/);
  const keyframes = await page.evaluate(() => {
    const a = document.getAnimations().find((x) => x.effect?.target?.id === 'sun');
    return a.effect.getKeyframes().map((k) => [k.transform, Number(k.opacity)]);
  });
  assert.ok(keyframes.every(([t]) => t === 'scale(0.8)'), 'the size never changes');
  assert.ok(keyframes.some(([, o]) => o < 1), 'but the sun fades');
  await shot(page, 'pause-reduced-motion');
  await waitPauseState(page, 'choosing');
  assert.equal(await page.locator('#countdown').isHidden(), true);
  await page.close();
});

test('dark theme and a narrow window', async () => {
  await configure({ 'pause.enabled': true, 'pause.breathSeconds': 3, 'general.theme': 'dark' });
  const page = await newTab();
  await page.goto(WATCH, { waitUntil: 'domcontentloaded' });
  await waitPauseState(page, 'choosing');
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await shot(page, 'pause-choice-dark');
  await page.setViewportSize({ width: 390, height: 780 });
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no horizontal scroll on a phone-width window');
  await shot(page, 'pause-choice-narrow');
  await page.close();
});

test('a pause for a user-added site: rule, page, label and its own session', async () => {
  await configure({
    'pause.enabled': true,
    'pause.breathSeconds': 3,
    'pause.sites': [
      { siteKey: 'youtube', domain: 'youtube.com', enabled: true },
      { siteKey: 'example.org', domain: 'example.org', enabled: true },
    ],
  });
  const rules = await dnrRules();
  assert.deepEqual(rules.map((r) => r.condition.regexFilter), ['^https?://([a-z0-9-]+\\.)*example\\.org(:[0-9]+)?/.*', '^https?://(www\\.|m\\.)?youtube\\.com/.*']);
  // The redirect itself needs the browser to have granted access to the site (permissions.request, asked
  // for when the site is added), which a test cannot click. So the page is opened the way the rule would.
  const page = await newTab();
  await page.goto(`${extUrl('src/pages/pause/pause.html')}#https://sub.example.org/some/page?x=1`);
  await waitPauseState(page, 'choosing');
  assert.equal(await page.locator('#close').textContent(), 'Close example.org');
  assert.equal(await page.locator('#kicker').textContent(), 'first time today');
  assert.equal((await send('PAUSE_CONTINUE', { siteKey: 'example.org', minutes: 5 })).ok, true);
  assert.equal((await dnrRules()).length, 1, 'only the YouTube pause is left');
  await page.close();
});

test('expiry: when the session ends the YouTube tab pauses the video and shows the overlay; Leave closes the tab', async () => {
  const page = await newTab();
  await page.goto(YT, { waitUntil: 'domcontentloaded' });
  await waitPauseState(page, 'choosing');
  await page.selectOption('#minutes', '5');
  await page.click('#continue');
  await page.waitForURL(YT, { timeout: 10_000 });
  await page.waitForFunction(() => document.documentElement.getAttribute('data-at-peace-loaded') === '1');
  // Make the session end in 4 seconds, the way a short session would (the page and the background both follow storage).
  const until = Date.now() + 4000;
  await send('GET_STATUS');
  await page.evaluate(() => {
    document.getElementById('v').play = () => Promise.resolve(); // no real playback in the sandbox
  });
  await configureSession(until);
  await page.waitForTimeout(1500);
  assert.equal(await page.locator('[data-at-peace-overlay]').count(), 0, 'not yet');
  await page.waitForSelector('[data-at-peace-overlay]', { state: 'attached', timeout: 10_000 });
  assert.equal(await page.getAttribute('[data-at-peace-overlay]', 'data-at-peace-overlay'), 'Your 5 minutes are up.');
  assert.equal(await page.evaluate(() => document.body.inert), true, 'the page behind is not reachable');
  await page.waitForTimeout(500);
  await shot(page, 'session-expiry-overlay');
  // Background: the session is gone and the pause rule is back.
  await settle();
  assert.deepEqual((await readState()).state.sessions, {});
  assert.equal((await dnrRules()).length, 1);
  // Keys never reach the page (the details of Escape, Finish this video and the breath are in overlay.spec.mjs).
  assert.equal(await page.getAttribute('[data-at-peace-overlay]', 'data-at-peace-view'), 'note');
  await page.keyboard.press('k'); // YouTube's play/pause shortcut: the page must not see it
  assert.equal(page.isClosed(), false);
  assert.equal(await page.locator('[data-at-peace-overlay]').count(), 1);
  const closed = new Promise((resolve) => page.once('close', resolve));
  await page.keyboard.press('Enter').catch(() => {}); // the primary action, "Leave YouTube", has the focus (the tab goes away mid-call)
  await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(new Error('tab did not close')), 8000))]);
});

test('expiry: "Breathe again" breathes in place: the page is not taken to the pause page and not reloaded', async () => {
  const page = await newTab();
  await page.goto(WATCH, { waitUntil: 'domcontentloaded' });
  await waitPauseState(page, 'choosing');
  await page.click('#continue');
  await page.waitForURL(WATCH, { timeout: 10_000 });
  await configureSession(Date.now() + 2500);
  await page.waitForSelector('[data-at-peace-overlay]', { state: 'attached', timeout: 10_000 });
  await page.waitForTimeout(600);
  await page.evaluate(() => { window.__same = 'still here'; });
  await page.keyboard.press('Tab'); // Leave YouTube → Finish this video
  await page.keyboard.press('Tab'); // → Breathe again
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('[data-at-peace-overlay]')?.getAttribute('data-at-peace-view') === 'breath');
  assert.equal(page.url(), WATCH, 'no navigation to the pause page');
  assert.equal(await page.evaluate(() => window.__same), 'still here', 'no reload');
  await page.waitForFunction(() => document.querySelector('[data-at-peace-overlay]')?.getAttribute('data-at-peace-view') === 'choice', null, { timeout: 8000 });
  await page.close();
});

test('the expiry overlay is always on: a leftover pause.expiryOverlay = false from 0.1.0 does not hide it', async () => {
  await configure({ 'pause.enabled': true, 'pause.breathSeconds': 3, 'pause.expiryOverlay': false });
  const page = await newTab();
  await page.goto(YT, { waitUntil: 'domcontentloaded' });
  await waitPauseState(page, 'choosing');
  await page.click('#continue');
  await page.waitForURL(YT, { timeout: 10_000 });
  await configureSession(Date.now() + 2000);
  await page.waitForSelector('[data-at-peace-overlay]', { state: 'attached', timeout: 10_000 });
  await settle();
  assert.equal((await dnrRules()).length, 1);
  await page.close();
});

test('the overlay is not shown when the pause was switched off during the session', async () => {
  const page = await newTab();
  await page.goto(YT, { waitUntil: 'domcontentloaded' });
  await waitPauseState(page, 'choosing');
  await page.click('#continue');
  await page.waitForURL(YT, { timeout: 10_000 });
  await configureSession(Date.now() + 3000);
  await configure({ 'pause.enabled': false });
  await page.waitForTimeout(4500);
  assert.equal(await page.locator('[data-at-peace-overlay]').count(), 0);
  assert.deepEqual((await readState()).state.sessions, {});
  await page.close();
});

test('the master switch is no way out: with At Peace turned off the pause still works', async () => {
  await configure({ 'pause.enabled': true, 'pause.breathSeconds': 3, 'general.enabled': false });
  const page = await newTab();
  await page.goto(WATCH, { waitUntil: 'domcontentloaded' });
  assert.ok(page.url().startsWith(extUrl('src/pages/pause/pause.html')));
  await waitPauseState(page, 'choosing');
  await page.click('#continue');
  await page.waitForURL(WATCH, { timeout: 10_000 });
  await configureSession(Date.now() + 2000);
  await page.waitForSelector('[data-at-peace-overlay]', { state: 'attached', timeout: 10_000 });
  await page.close();
});

test('the session ends by itself: the background alarm brings the pause rule back (nobody asks it to)', async () => {
  assert.equal((await send('PAUSE_CONTINUE', { siteKey: 'youtube', minutes: 5 })).ok, true);
  assert.deepEqual(await dnrRules(), []);
  await configureSession(Date.now() + 3000);
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.deepEqual(await dnrRules(), [], 'still running');
  await new Promise((resolve) => setTimeout(resolve, 3500));
  assert.equal((await dnrRules()).length, 1, 'the pause is back');
  assert.deepEqual((await readState()).state.sessions, {});
  const page = await newTab();
  await page.goto(YT, { waitUntil: 'domcontentloaded' });
  assert.ok(page.url().startsWith(extUrl('src/pages/pause/pause.html')));
  await page.close();
});

test('Chromium reports no runtime errors from the extension after all of this', async () => {
  const diagnostics = await extensionDiagnostics();
  assert.deepEqual(diagnostics.runtimeErrors, []);
  assert.deepEqual(diagnostics.manifestErrors, []);
});

/** Replaces the running YouTube session's end (what a short session would look like). */
async function configureSession(until) {
  await evalInExtension(
    async (end) => {
      const { state = {} } = await chrome.storage.local.get('state');
      await chrome.storage.local.set({ state: { ...state, sessions: { youtube: end }, sessionMinutes: state.sessionMinutes ?? { youtube: 5 } } });
    },
    until,
  );
  await new Promise((resolve) => setTimeout(resolve, 150));
}
