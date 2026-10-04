// Phase 3c, Chromium: focus blocks, weekly schedules, the daily limit and the blocked page. YouTube
// is stubbed (see _mindful.mjs); the DNR rules, the background and the pages are the real ones.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { launch, close, extUrl, evalInExtension, setStorage, extensionDiagnostics } from './harness.mjs';
import { stubYouTube, send, resetStorage, configure, settle, dnrRules, readState, newTab, shot, today, ourErrors } from './_mindful.mjs';

let stub;
const YT = 'https://www.youtube.com/';
const WATCH = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
let BLOCKED;

before(async () => {
  await launch();
  BLOCKED = extUrl('src/pages/blocked/blocked.html');
  stub = await stubYouTube();
});
after(async () => {
  await close();
});
beforeEach(async () => {
  stub.hits.length = 0;
  await resetStorage();
});

const waitState = (page, s, timeout = 10_000) => page.waitForFunction((x) => document.body.dataset.state === x, s, { timeout });

async function blockedTab(url = WATCH) {
  const page = await newTab();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await waitState(page, 'blocked');
  return page;
}

test('a focus block redirects YouTube to the blocked page, with a live countdown, the hollow seal and a rule at priority 300', async () => {
  const res = await send('FOCUS_START', { minutes: 25 });
  assert.equal(res.ok, true);
  assert.equal(res.block.reason, 'focus');
  const [rule, ...rest] = await dnrRules();
  assert.deepEqual([rule.id, rule.priority, rest.length], [100, 300, 0]);

  const page = await newTab();
  await page.goto(WATCH, { waitUntil: 'domcontentloaded' });
  assert.equal(page.url(), `${BLOCKED}?reason=focus#${WATCH}`);
  await waitState(page, 'blocked');
  assert.equal(await page.locator('#title').textContent(), 'YouTube is closed for now.');
  assert.match(await page.locator('#clock').textContent(), /^2[45]:\d\d$/);
  assert.match(await page.locator('#until').textContent(), /^Back at /);
  assert.equal(await page.locator('#target').textContent(), WATCH);
  assert.equal(await page.locator('h1').textContent(), 'At Peace');
  // Hollow: an outline, no fill.
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.ring')).backgroundColor), 'rgba(0, 0, 0, 0)');
  // Live: it counts down.
  const first = await page.locator('#clock').textContent();
  await page.waitForFunction((t) => document.getElementById('clock').textContent !== t, first, { timeout: 4000 });
  assert.equal(stub.hits.length, 0);
  assert.deepEqual(ourErrors(page), []);
  await shot(page, 'blocked-focus');
  const { stats } = await readState();
  assert.equal(stats[today()].youtube.blockedHits, 1, 'one hit per load');
  await page.close();
});

test('a block beats the pause: the blocked page is shown, not the pause page', async () => {
  await configure({ 'pause.enabled': true, 'pause.breathSeconds': 3 });
  await send('FOCUS_START', { minutes: 25 });
  assert.deepEqual((await dnrRules()).map((r) => [r.id, r.priority]), [[100, 300], [200, 200]]);
  const page = await blockedTab();
  assert.ok(page.url().startsWith(BLOCKED));
  await page.close();
});

test('a block that starts while YouTube is open sends that tab to the blocked page (the page guard)', async () => {
  const page = await newTab();
  await page.goto(WATCH, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.documentElement.getAttribute('data-at-peace-loaded') === '1');
  assert.equal(page.url(), WATCH);
  await send('FOCUS_START', { minutes: 25 });
  await page.waitForURL((u) => u.pathname.endsWith('/blocked.html'), { timeout: 8000 });
  assert.equal(page.url(), `${BLOCKED}?reason=focus#${WATCH}`);
  await waitState(page, 'blocked');
  await page.close();
});

test('the master switch is no way out of a block', async () => {
  await configure({ 'general.enabled': false });
  await send('FOCUS_START', { minutes: 25 });
  const page = await blockedTab(YT);
  assert.equal(await page.locator('#title').textContent(), 'YouTube is closed for now.');
  await page.close();
});

test('friction "wait": a 30 second wait, then the button; ending frees the site and the link goes back', async () => {
  await configure({ 'focus.unlockFriction': 'wait' });
  await send('FOCUS_START', { minutes: 25 });
  assert.deepEqual(await send('FOCUS_END', {}), { ok: false, error: 'friction-required' });
  const page = await newTab();
  await page.clock.install({ time: Date.now() });
  await page.goto(WATCH, { waitUntil: 'domcontentloaded' });
  await waitState(page, 'blocked');
  await page.getByRole('button', { name: 'End focus early…' }).click();
  const confirmButton = page.getByRole('button', { name: 'End focus now' });
  assert.equal(await confirmButton.isDisabled(), true);
  await page.clock.runFor(10_000);
  assert.equal(await confirmButton.isDisabled(), true, 'still waiting after 10 s');
  await shot(page, 'blocked-wait');
  await page.clock.runFor(21_000);
  assert.equal(await confirmButton.isEnabled(), true);
  await confirmButton.click();
  await waitState(page, 'free');
  assert.equal(await page.locator('#title').textContent(), 'You’re free to go.');
  assert.deepEqual(await dnrRules(), []);
  assert.equal((await readState()).state.block, null);
  await page.locator('#cta a').click();
  await page.waitForURL(WATCH, { timeout: 8000 });
  assert.equal(stub.hits.length, 1);
  await page.close();
});

test('"Keep going" cancels the wait', async () => {
  await configure({ 'focus.unlockFriction': 'wait' });
  await send('FOCUS_START', { minutes: 25 });
  const page = await blockedTab();
  await page.getByRole('button', { name: 'End focus early…' }).click();
  await page.getByRole('button', { name: 'Keep going' }).click();
  assert.equal(await page.getByRole('button', { name: 'End focus early…' }).isVisible(), true);
  await page.close();
});

test('friction "phrase": the sentence must be typed (case and punctuation do not matter)', async () => {
  await configure({ 'focus.unlockFriction': 'phrase' });
  await send('FOCUS_START', { minutes: 25 });
  const page = await blockedTab();
  await page.getByRole('button', { name: 'End focus early…' }).click();
  const end = page.getByRole('button', { name: 'End focus', exact: true });
  assert.equal(await end.isDisabled(), true);
  await page.fill('#phrase', 'I am choosing to end');
  assert.equal(await end.isDisabled(), true);
  await page.waitForTimeout(500);
  await shot(page, 'blocked-phrase');
  await page.fill('#phrase', 'i am choosing, to END my focus session!');
  assert.equal(await end.isEnabled(), true);
  await page.press('#phrase', 'Enter');
  await waitState(page, 'free');
  assert.deepEqual(await dnrRules(), []);
  await page.close();
});

test('friction "none": one click ends the block', async () => {
  await configure({ 'focus.unlockFriction': 'none' });
  await send('FOCUS_START', { minutes: 25 });
  const page = await blockedTab();
  await page.getByRole('button', { name: 'End focus', exact: true }).click();
  await waitState(page, 'free');
  await page.close();
});

test('strict: nothing on the page ends the block, and neither does the background', async () => {
  await configure({ 'focus.strict': true });
  await send('FOCUS_START', { minutes: 25 });
  const page = await blockedTab();
  assert.equal(await page.getByRole('button').count(), 0, 'no button on the page');
  assert.match(await page.locator('#unlock').textContent(), /cannot be ended early/);
  assert.deepEqual(await send('FOCUS_END', { frictionDone: true }), { ok: false, error: 'strict' });
  assert.equal((await readState()).state.block.reason, 'focus');
  assert.equal((await dnrRules()).length, 1);
  await shot(page, 'blocked-strict');
  await page.close();
});

test('a block that ends by itself: the page says "free", the rule goes, the link opens the site', async () => {
  await send('FOCUS_START', { minutes: 25 });
  const page = await blockedTab();
  const end = Date.now() + 4000;
  await evalInExtension(
    async (until) => {
      const { state } = await chrome.storage.local.get('state');
      await chrome.storage.local.set({ state: { ...state, blocks: state.blocks.map((b) => ({ ...b, until })), block: { ...state.block, until } } });
    },
    end,
  );
  await waitState(page, 'free', 12_000);
  assert.equal(await page.locator('#cta a').getAttribute('href'), WATCH);
  assert.deepEqual(await dnrRules(), []);
  await page.locator('#cta a').click();
  await page.waitForURL(WATCH, { timeout: 8000 });
  await page.close();
});

test('a block ended elsewhere (the popup, another tab) turns an open blocked page into "free" at once', async () => {
  await configure({ 'focus.unlockFriction': 'none' });
  await send('FOCUS_START', { minutes: 25 });
  const page = await blockedTab();
  await send('FOCUS_END', {});
  await waitState(page, 'free', 6000);
  await shot(page, 'blocked-free');
  await page.close();
});

test('FOCUS_START with untilEndOfDay blocks until local midnight', async () => {
  const res = await send('FOCUS_START', { untilEndOfDay: true });
  const midnight = new Date();
  midnight.setHours(24, 0, 0, 0);
  assert.equal(res.block.until, midnight.getTime());
  const page = await blockedTab();
  assert.match(await page.locator('#until').textContent(), /^Back tomorrow$/);
  await page.close();
});

test('a schedule that is active now closes YouTube and names itself; one on another day does not', async () => {
  const day = new Date().getDay();
  const schedule = (days) => ({ id: 'work', name: 'Work hours', days, start: '00:00', end: '23:59', action: 'block', siteKeys: ['youtube'], enabled: true });
  await configure({ 'focus.schedules': [schedule([day])] });
  const page = await blockedTab(YT);
  assert.ok(page.url().startsWith(`${BLOCKED}?reason=schedule#`));
  assert.equal(await page.locator('#title').textContent(), 'Closed by your schedule.');
  assert.match(await page.locator('#sub').textContent(), /“Work hours” keeps YouTube closed/);
  assert.equal(await page.locator('#unlock button').count(), 1, 'only a link to the settings, no way to end it here');
  await shot(page, 'blocked-schedule');
  await page.close();

  await configure({ 'focus.schedules': [schedule([(day + 3) % 7])] });
  const other = await newTab();
  await other.goto(YT, { waitUntil: 'domcontentloaded' });
  assert.equal(other.url(), YT);
  assert.equal(stub.hits.length, 1);
  await other.close();
});

test('a preset schedule applies its preset while it runs (and says so in the status)', async () => {
  const day = new Date().getDay();
  await configure({ 'focus.schedules': [{ id: 'p', name: 'Deep', days: [day], start: '00:00', end: '23:59', action: 'preset:deep-work', siteKeys: ['youtube'], enabled: true }] });
  const status = await settle();
  assert.equal(status.scheduleOverride, 'deep-work');
  assert.equal(status.activeSchedules[0].action, 'preset:deep-work');
  assert.equal(status.block, null);
  const effective = await evalInExtension(async () => (await chrome.storage.local.get('state')).state.scheduleOverride);
  assert.equal(effective, 'deep-work');
  // Deep work turns the pause on, so YouTube is paused (not blocked).
  const page = await newTab();
  await page.goto(YT, { waitUntil: 'domcontentloaded' });
  assert.ok(page.url().startsWith(extUrl('src/pages/pause/pause.html')));
  await page.close();
});

test('the daily limit: reached → blocked until midnight; "5 more minutes" once; then no more', async () => {
  await configure({ 'focus.dailyMinutes': 1, 'focus.limitGrace': 1 });
  await setStorage({ stats: { [today()]: { youtube: { activeSec: 40, opens: 0, turnedBack: 0, continued: 0, blockedHits: 0 } } } });
  assert.equal((await send('HEARTBEAT', { siteKey: 'youtube' })).counted, true); // +30 s → 70 s ≥ 60 s
  assert.equal((await readState()).state.block.reason, 'limit');

  const page = await newTab();
  await page.goto('https://www.youtube.com/feed/subscriptions', { waitUntil: 'domcontentloaded' });
  await waitState(page, 'blocked');
  assert.ok(page.url().startsWith(`${BLOCKED}?reason=limit#`));
  assert.equal(await page.locator('#title').textContent(), 'That’s your time for today.');
  assert.equal(await page.locator('#sub').textContent(), 'You reached today’s limit of 1 minute.');
  assert.equal(await page.locator('#until').textContent(), 'Back tomorrow');
  assert.equal(await page.locator('#unlock .hint').textContent(), 'One left today.');
  await shot(page, 'blocked-limit');

  await page.getByRole('button', { name: '5 more minutes' }).click();
  await page.waitForURL('https://www.youtube.com/feed/subscriptions', { timeout: 8000 });
  assert.equal(stub.hits.length, 1, 'the site loads: nothing is blocking it any more');
  assert.equal((await readState()).state.extraTime[today()], 5);
  assert.deepEqual(await dnrRules(), []);

  // The extra five minutes get used up: blocked again, and this time no grace is left.
  await setStorage({ stats: { [today()]: { youtube: { activeSec: 70 + 300, opens: 0, turnedBack: 0, continued: 0, blockedHits: 1 } } } });
  await settle();
  const again = await newTab();
  await again.goto(YT, { waitUntil: 'domcontentloaded' });
  await waitState(again, 'blocked');
  assert.equal(await again.locator('#unlock button').filter({ hasText: '5 more minutes' }).count(), 0);
  assert.deepEqual(await send('LIMIT_GRACE'), { ok: false, error: 'no-grace' });
  await again.close();
  await page.close();
});

test('the daily limit does nothing when it is 0 (off)', async () => {
  await setStorage({ stats: { [today()]: { youtube: { activeSec: 99999, opens: 0, turnedBack: 0, continued: 0, blockedHits: 0 } } } });
  await send('HEARTBEAT', { siteKey: 'youtube' });
  const page = await newTab();
  await page.goto(YT, { waitUntil: 'domcontentloaded' });
  assert.equal(page.url(), YT);
  await page.close();
});

test('GET_STATUS has the shape the popup relies on (Contract C3)', async () => {
  await configure({ 'pause.enabled': true, 'focus.dailyMinutes': 30 });
  await send('FOCUS_START', { minutes: 10 });
  const status = await send('GET_STATUS');
  assert.equal(status.ok, true);
  assert.equal(status.version, '0.1.0');
  assert.deepEqual(Object.keys(status.block).sort(), ['reason', 'siteKeys', 'until']);
  assert.deepEqual(status.limit, { dailyMinutes: 30, usedSec: 0, graceLeft: 1 });
  assert.deepEqual(status.sessions, {});
  assert.equal(typeof status.today.youtube.activeSec, 'number');
});

test('shorts: the blocked page has a calm line and a link to the normal watch page', async () => {
  const page = await newTab();
  await page.goto(`${BLOCKED}?reason=shorts#https://www.youtube.com/shorts/abcdefghijk`);
  await waitState(page, 'shorts');
  assert.equal(await page.locator('#title').textContent(), 'Shorts are off.');
  assert.equal(await page.locator('#cta a').getAttribute('href'), 'https://www.youtube.com/watch?v=abcdefghijk');
  assert.equal(await page.locator('#clock').isVisible(), false);
  await shot(page, 'blocked-shorts');
  await page.close();
});

test('the blocked page copes with a missing or hostile hash and reason', async () => {
  for (const suffix of ['', '?reason=nonsense', '?reason=focus#javascript:alert(1)', '?reason=focus#not a url']) {
    const page = await newTab();
    await page.goto(BLOCKED + suffix);
    await waitState(page, 'free');
    assert.equal(await page.locator('#cta a').count(), 0, `no link for ${suffix}`);
    assert.deepEqual(ourErrors(page), [], suffix);
    await page.close();
  }
});

test('dark theme, and a narrow window without horizontal scroll', async () => {
  await configure({ 'general.theme': 'dark' });
  await send('FOCUS_START', { minutes: 25 });
  const page = await blockedTab();
  assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), 'dark');
  await shot(page, 'blocked-focus-dark');
  await page.setViewportSize({ width: 390, height: 780 });
  await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  await shot(page, 'blocked-focus-narrow');
  await page.close();
});

test('the time tracker counts the time on a visible, focused YouTube tab (a beat after 30 s)', async () => {
  const page = await newTab();
  await page.goto(YT, { waitUntil: 'domcontentloaded' });
  await page.bringToFront();
  await page.waitForFunction(() => document.documentElement.getAttribute('data-at-peace-loaded') === '1');
  await page.waitForTimeout(31_500);
  const { stats } = await readState();
  assert.equal(stats[today()].youtube.activeSec, 30);
  await page.close();
});

test('no runtime errors from the extension after all of this', async () => {
  const diagnostics = await extensionDiagnostics();
  assert.deepEqual(diagnostics.runtimeErrors, []);
});
