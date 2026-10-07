// Phase 3c in REAL Firefox (headless, Selenium + geckodriver): the Mindful Pause, the expiry overlay,
// focus blocks and a user-added site. Firefox is the product (Zen), so this is the run that counts.
// Prerequisite: bash tests/firefox/setup.sh. Live youtube.com is loaded ONCE (then reused); the
// user-added site is a local server (guard.test, resolved to localhost by a Firefox preference).
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { By, Key } from 'selenium-webdriver';
import { launchFirefox, extUrl, ROOT } from './_harness.mjs';

const SHOTS = join(ROOT, 'tests', 'e2e', 'artifacts', 'mindful');
const WATCH = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';

let ff;
let driver;
let server;
let siteUrl;
let extHandle = null;
let youtubeHandle = null;
let captcha = false;

before(async () => {
  server = createServer((req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end('<!doctype html><html><head><title>guard test page</title></head><body><h1>A page on a site I added</h1><video id="v"></video>' +
        '<a id="same" href="https://www.youtube.com/watch?v=abc">same tab</a> <a id="blank" target="_blank" href="https://www.youtube.com/watch?v=def">new tab</a></body></html>');
  });
  await new Promise((resolve) => server.listen(0, resolve));
  siteUrl = `http://guard.test:${server.address().port}/some/page?x=1`;
  ff = await launchFirefox({
    prefs: {
      'network.dns.localDomains': 'guard.test',
      'network.proxy.no_proxies_on': 'localhost, 127.0.0.1, guard.test',
      // The one place a person says "yes": auto-granted so the real add-a-site flow can run unattended.
      'extensions.webextOptionalPermissionPrompts': false,
    },
  });
  driver = ff.driver;
  await driver.manage().window().setRect({ width: 1280, height: 800 });
  await mkdir(SHOTS, { recursive: true });
});

after(async () => {
  await ff?.close();
  await new Promise((resolve) => server?.close(resolve));
});

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------

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

const setStorage = (obj) => ff.setStorage(obj);

async function dnrRules() {
  const rules = await inExt(() => driver.executeAsyncScript((done) => browser.declarativeNetRequest.getDynamicRules().then(done, (e) => done({ __error: String(e) }))));
  return rules.sort((a, b) => a.id - b.id);
}

/**
 * Visible text of an element, once it has some. (WebDriver reports '' for an element that is
 * still fading in at opacity 0, which is how every layer of the pause page arrives.)
 */
async function textOf(id, timeout = 5000) {
  let text = '';
  await driver.wait(async () => {
    text = await driver.findElement(By.id(id)).getText();
    return text !== '';
  }, timeout, `#${id} never had visible text`);
  return text;
}

/** Wipes everything and waits for the background to settle. */
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
}

async function configure(settings) {
  await setStorage({ settings });
  await sleep(150);
  await send('GET_STATUS'); // reconciles: when it answers, the rules match the settings
}

const bodyState = () => driver.executeScript(() => document.body?.dataset.state ?? null);

async function waitBodyState(state, timeout = 15_000) {
  await driver.wait(async () => (await bodyState()) === state, timeout, `page never reached state "${state}" (is "${await bodyState()}", at ${await driver.getCurrentUrl()})`);
}

async function waitUrl(test, timeout = 15_000, what = 'url') {
  await driver.wait(async () => test(await driver.getCurrentUrl()), timeout, `${what}: still at ${await driver.getCurrentUrl()}`);
}

const overlayTitle = () => driver.executeScript(() => document.querySelector('[data-at-peace-overlay]')?.getAttribute('data-at-peace-overlay') ?? null);

async function ourErrors(from) {
  return [...(await ff.ourScriptErrors()).slice(from.scripts), ...ff.pageErrorsSince(from.log).filter((e) => e.includes('moz-extension://') || e.includes('[At Peace]'))];
}

/** Marks "now" so ourErrors() reports only what happens after it. */
const mark = async () => ({ log: ff.logEntries.length, scripts: (await ff.ourScriptErrors()).length });

let errorsSeen = 0;
afterEach(async (t) => {
  const errors = await ff.ourScriptErrors();
  if (errors.length > errorsSeen) t.diagnostic(`script errors after this test: ${JSON.stringify(errors.slice(errorsSeen))}`);
  errorsSeen = errors.length;
});

// ---------------------------------------------------------------------------------------------
// the pause, on real YouTube (one live load)
// ---------------------------------------------------------------------------------------------

test('pause: a youtube.com load is redirected before any request; breath; choice', async () => {
  await reset();
  await configure({ 'pause.enabled': true, 'pause.breathSeconds': 3 });
  const rules = await dnrRules();
  assert.equal(rules.length, 1);
  assert.equal(rules[0].id, 200);

  await driver.get(WATCH);
  await waitUrl((u) => u.startsWith(extUrl('src/pages/pause/pause.html')), 15_000, 'pause redirect');
  assert.equal(await driver.getCurrentUrl(), `${extUrl('src/pages/pause/pause.html')}#${WATCH}`);
  await waitBodyState('breathing');
  assert.equal((await driver.findElements(By.id('target'))).length, 0, 'the address is not shown');
  assert.equal(await textOf('foot-hint'), 'Press Esc to close');
  assert.equal(await driver.findElement(By.id('continue')).isEnabled(), false);
  assert.equal(await textOf('guidance'), 'Breathe in…');
  await sleep(900);
  await shot('firefox-pause-breath');
  // the sun is animated by the Web Animations API
  assert.equal(await driver.executeScript(() => document.getAnimations().filter((a) => a.effect?.target?.id === 'sun' && a.playState === 'running').length), 1);
  await waitBodyState('choosing');
  assert.equal(await textOf('kicker'), 'FIRST TIME TODAY'); // Selenium returns the rendered (uppercased) text
  assert.equal(await textOf('question'), 'Open YouTube?');
  assert.equal(await textOf('close'), 'Close YouTube');
  assert.equal(await driver.findElement(By.id('continue')).isEnabled(), true);
  await sleep(700); // the choice fades in
  await shot('firefox-pause-choice');
});

test('pause: Continue starts the session and the real site loads (a second navigation is not paused)', async (t) => {
  const from = await mark();
  assert.equal((await driver.findElements(By.css('input[type=text]'))).length, 0, 'nothing to type on the pause page');
  await driver.findElement(By.id('continue')).click();
  await waitUrl((u) => !u.startsWith('moz-extension:'), 20_000, 'leaving the pause page after Continue');
  await driver.wait(async () => new URL(await driver.getCurrentUrl()).hostname !== '', 20_000);
  if ((await driver.getCurrentUrl()).includes('/sorry/')) {
    captcha = true;
    return t.skip('Google served its captcha page (/sorry/); try again later');
  }
  assert.equal(new URL(await driver.getCurrentUrl()).hostname, 'www.youtube.com');
  await driver.wait(async () => (await driver.executeScript(() => document.documentElement.getAttribute('data-at-peace-loaded'))) === '1', 20_000, 'content script never ran on youtube.com');
  youtubeHandle = await driver.getWindowHandle();
  const { state, stats } = await storage(['state', 'stats']);
  assert.ok(state.sessions.youtube > Date.now() + 14 * 60_000, 'a 15 minute session');
  assert.equal(state.sessionMinutes.youtube, 15);
  const day = Object.keys(stats)[0];
  assert.equal(stats[day].youtube.continued, 1);
  assert.equal('intentions' in stats[day].youtube, false, 'no intention is stored');
  assert.deepEqual(await dnrRules(), [], 'no pause rule while the session runs');
  assert.deepEqual(await ourErrors(from), []);
});

test('expiry: the session ends → the video stops and the overlay covers the page', async (t) => {
  if (captcha) return t.skip('no live YouTube tab: Google served its captcha page (/sorry/) to the Continue step above');
  await driver.switchTo().window(youtubeHandle);
  const from = await mark();
  const { state } = await storage('state');
  await setStorage({ state: { ...state, sessions: { youtube: Date.now() + 4000 } } });
  await driver.wait(async () => (await overlayTitle()) !== null, 15_000, 'overlay never appeared');
  assert.equal(await overlayTitle(), 'Your 15 minutes are up.');
  assert.equal(await driver.executeScript(() => document.body.inert), true, 'the page behind is inert');
  assert.equal(await driver.executeScript(() => [...document.querySelectorAll('video')].every((v) => v.paused)), true);
  await sleep(600);
  await shot('firefox-session-expiry-overlay');
  // The background has re-armed the pause for the next load.
  await send('GET_STATUS');
  assert.equal((await dnrRules()).length, 1);
  assert.deepEqual(await ourErrors(from), []);
});

test('expiry: Escape does nothing; a block that starts now beats the overlay and sends the tab to the blocked page', async (t) => {
  if (captcha) return t.skip('no live YouTube tab: Google served its captcha page (/sorry/) to the Continue step above');
  await driver.switchTo().window(youtubeHandle);
  const watchUrl = await driver.getCurrentUrl();
  await driver.actions().sendKeys(Key.ESCAPE).perform();
  await sleep(300);
  assert.equal(await overlayTitle(), 'Your 15 minutes are up.');
  assert.equal((await send('FOCUS_START', { minutes: 25 })).ok, true);
  // The page guard (a content script) navigates to a moz-extension:// page: Firefox must allow it.
  await waitUrl((u) => u.startsWith(extUrl('src/pages/blocked/blocked.html')), 15_000, 'guard redirect to the blocked page');
  assert.equal(await driver.getCurrentUrl(), `${extUrl('src/pages/blocked/blocked.html')}?reason=focus#${watchUrl}`);
  await waitBodyState('blocked');
  assert.equal(await textOf('title'), 'YouTube is closed for now.');
  assert.match(await textOf('clock'), /^2[45]:\d\d$/);
  await shot('firefox-blocked-focus');
});

// ---------------------------------------------------------------------------------------------
// blocks on fresh navigations (no live load: the redirect happens before any request)
// ---------------------------------------------------------------------------------------------

test('focus: a full youtube.com load is redirected by the block rule; wait friction; free at the end', async () => {
  await reset();
  await configure({ 'focus.unlockFriction': 'wait', 'pause.enabled': true, 'pause.breathSeconds': 3 });
  await send('FOCUS_START', { minutes: 25 });
  const rules = await dnrRules();
  assert.deepEqual(rules.map((r) => [r.id, r.priority]), [[100, 300], [200, 200]]);
  const from = await mark();
  await driver.get('https://www.youtube.com/feed/subscriptions');
  await waitUrl((u) => u.startsWith(extUrl('src/pages/blocked/blocked.html')), 15_000, 'block redirect');
  assert.equal(await driver.getCurrentUrl(), `${extUrl('src/pages/blocked/blocked.html')}?reason=focus#https://www.youtube.com/feed/subscriptions`);
  await waitBodyState('blocked');
  assert.equal((await driver.findElements(By.id('target'))).length, 0, 'the blocked page does not show the address');
  assert.equal((await driver.findElements(By.css('footer'))).length, 0, 'and has no footer: Esc does nothing there');

  assert.deepEqual(await send('FOCUS_END', {}), { ok: false, error: 'friction-required' });
  const early = await driver.findElement(By.xpath("//button[normalize-space()='End focus early…']"));
  await early.click();
  const now = await driver.findElement(By.xpath("//button[normalize-space()='End focus now']"));
  assert.equal(await now.isEnabled(), false);
  await shot('firefox-blocked-wait');
  assert.deepEqual(await send('FOCUS_END', { frictionDone: true }), { ok: true }); // (what the button sends after 30 s)
  await waitBodyState('free', 8000);
  assert.equal(await textOf('title'), 'YouTube is open again.');
  assert.deepEqual((await dnrRules()).map((r) => r.id), [200]);
  assert.deepEqual(await ourErrors(from), []);
});

test('focus: strict leaves no way out; a schedule closes the site; the daily limit with "5 more minutes"', async () => {
  await reset();
  await configure({ 'focus.strict': true });
  await send('FOCUS_START', { minutes: 25 });
  await driver.get('https://www.youtube.com/');
  await waitBodyState('blocked');
  assert.equal((await driver.findElements(By.css('#unlock button'))).length, 0);
  assert.deepEqual(await send('FOCUS_END', { frictionDone: true }), { ok: false, error: 'strict' });

  const day = new Date().getDay();
  await reset();
  await configure({ 'focus.schedules': [{ id: 's1', name: 'Work hours', days: [day], start: '00:00', end: '23:59', action: 'block', siteKeys: ['youtube'], enabled: true }] });
  await driver.get('https://www.youtube.com/');
  await waitBodyState('blocked');
  assert.equal(await textOf('title'), 'YouTube is closed for now.');
  assert.equal(await textOf('kicker'), 'SCHEDULE · WORK HOURS');
  await shot('firefox-blocked-schedule');

  await reset();
  await configure({ 'focus.dailyMinutes': 1, 'focus.limitGrace': 1 });
  const dayKey = new Date().toLocaleDateString('sv');
  await setStorage({ stats: { [dayKey]: { youtube: { activeSec: 40, opens: 0, turnedBack: 0, continued: 0, blockedHits: 0 } } } });
  assert.equal((await send('HEARTBEAT', { siteKey: 'youtube' })).counted, true);
  await driver.get('https://www.youtube.com/');
  await waitBodyState('blocked');
  assert.equal(await textOf('title'), 'YouTube is closed for today.');
  assert.equal(await textOf('kicker'), 'DAILY LIMIT');
  await driver.findElement(By.xpath("//button[normalize-space()='5 more minutes']"));
  await shot('firefox-blocked-limit');
  assert.equal((await send('LIMIT_GRACE')).ok, true);
  assert.deepEqual(await dnrRules(), [], 'the block rule is gone');
});

test('pause: links on pages the extension has no access to are paused too (same tab and new tab); Close in a new tab closes it', async () => {
  await reset();
  await configure({ 'pause.enabled': true, 'pause.breathSeconds': 3 });
  const origin = `http://localhost:${server.address().port}/`;
  await driver.get(origin);
  const opener = await driver.getWindowHandle();
  await driver.findElement(By.id('same')).click();
  await waitUrl((u) => u.startsWith(extUrl('src/pages/pause/pause.html')), 10_000, 'same-tab link');
  assert.equal(await driver.getCurrentUrl(), `${extUrl('src/pages/pause/pause.html')}#https://www.youtube.com/watch?v=abc`);

  await driver.get(origin);
  const before = await driver.getAllWindowHandles();
  await driver.findElement(By.id('blank')).click();
  await driver.wait(async () => (await driver.getAllWindowHandles()).length > before.length, 10_000);
  const popup = (await driver.getAllWindowHandles()).find((h) => !before.includes(h));
  await driver.switchTo().window(popup);
  await waitUrl((u) => u.startsWith(extUrl('src/pages/pause/pause.html')), 10_000, 'new-tab link');
  assert.equal(await driver.executeScript(() => history.length), 1, 'a tab opened by a link starts at the pause page');
  await waitBodyState('choosing');
  await sleep(500);
  await driver.findElement(By.id('close')).click();
  await driver.wait(async () => !(await driver.getAllWindowHandles()).includes(popup), 10_000, 'the tab did not close');
  await driver.switchTo().window(opener);
  const { stats } = await storage('stats');
  assert.equal(Object.values(stats)[0].youtube.turnedBack, 1);
});

test('pause: the session ends by itself — the background alarm brings the pause rule back (nobody asks it to)', async () => {
  await reset();
  await configure({ 'pause.enabled': true, 'pause.breathSeconds': 3 });
  assert.equal((await send('PAUSE_CONTINUE', { siteKey: 'youtube', minutes: 5 })).ok, true);
  assert.deepEqual(await dnrRules(), []);
  const { state } = await storage('state');
  await setStorage({ state: { ...state, sessions: { youtube: Date.now() + 3000 } } });
  await sleep(1000);
  assert.deepEqual(await dnrRules(), [], 'still running');
  await driver.wait(async () => (await dnrRules()).length === 1, 12_000, 'the pause rule did not come back after the session ended');
  assert.deepEqual((await storage('state')).state.sessions, {});
});

// ---------------------------------------------------------------------------------------------
// a user-added site, end to end (real permission flow, real guard registration)
// ---------------------------------------------------------------------------------------------

test('user site: add it in the options page (real permission request), the guard script is registered', async () => {
  await reset();
  await configure({ 'pause.enabled': true, 'pause.breathSeconds': 3 });
  const errors = await ff.openExtPage('src/pages/options/options.html#pause');
  assert.deepEqual(errors, []);
  await driver.wait(async () => (await driver.findElements(By.css('[data-id="pause.sites"] .pause-sites'))).length > 0, 15_000);
  const input = await driver.findElement(By.css('[data-id="pause.sites"] .adder input'));
  await input.sendKeys('guard.test');
  await driver.findElement(By.xpath("//*[@data-id='pause.sites']//button[normalize-space()='Add site']")).click();
  await driver.wait(async () => (await driver.findElements(By.css('[data-id="pause.sites"] .site'))).length === 2, 15_000, 'the site was not added (permission refused?)');
  const { settings } = await storage('settings');
  assert.deepEqual(settings['pause.sites'][1], { siteKey: 'guard.test', domain: 'guard.test', enabled: true });
  await shot('firefox-options-pause-sites');

  const granted = await inExt(() => driver.executeAsyncScript((done) => browser.permissions.contains({ origins: ['*://*.guard.test/*'] }).then(done)));
  assert.equal(granted, true, 'the permission was really granted');
  await driver.wait(async () => {
    const scripts = await inExt(() => driver.executeAsyncScript((done) => browser.scripting.getRegisteredContentScripts().then(done, (e) => done({ __error: String(e) }))));
    return scripts.some((s) => s.id === 'at-peace-guard' && s.matches.includes('*://*.guard.test/*'));
  }, 10_000, 'the guard content script was not registered');
  const rules = await dnrRules();
  assert.ok(rules.some((r) => r.condition.regexFilter.includes('guard\\.test')), 'a pause rule for the new site');
});

test('user site: pause redirect → breath → Continue → the page loads; the guard shows the expiry overlay there', async () => {
  const from = await mark();
  await driver.get(siteUrl);
  await waitUrl((u) => u.startsWith(extUrl('src/pages/pause/pause.html')), 15_000, 'pause redirect for the user site');
  assert.equal(await driver.getCurrentUrl(), `${extUrl('src/pages/pause/pause.html')}#${siteUrl}`);
  await waitBodyState('choosing');
  assert.equal(await textOf('close'), 'Close guard.test');
  assert.equal(await textOf('kicker'), 'FIRST TIME TODAY');
  await shot('firefox-pause-user-site');
  await driver.findElement(By.id('continue')).click();
  await waitUrl((u) => u.startsWith('http://guard.test:'), 15_000, 'the user site after Continue');
  assert.equal(await driver.getTitle(), 'guard test page');
  const { state } = await storage('state');
  assert.ok(state.sessions['guard.test'] > Date.now());

  // The registered guard runs on this page: the session ends → overlay (document_start script, closed shadow root).
  await setStorage({ state: { ...state, sessions: { 'guard.test': Date.now() + 3500 }, sessionMinutes: { 'guard.test': 15 } } });
  await driver.wait(async () => (await overlayTitle()) !== null, 15_000, 'the guard on the user site never showed the overlay');
  assert.equal(await overlayTitle(), 'Your 15 minutes are up.');
  await sleep(500);
  await shot('firefox-expiry-overlay-user-site');
  assert.deepEqual(await ourErrors(from), []);
});

test('user site: a focus block for it redirects the open tab', async () => {
  await send('FOCUS_START', { minutes: 25, siteKeys: ['guard.test'] });
  await waitUrl((u) => u.startsWith(extUrl('src/pages/blocked/blocked.html')), 15_000, 'block on the user site');
  await waitBodyState('blocked');
  assert.equal(await textOf('title'), 'guard.test is closed for now.');
});

test('Firefox reports no script errors from the extension after all of this (navigation noise aside)', async () => {
  // "Promise resolved while context is inactive / rejected after context unloaded" is what Firefox logs when a page
  // leaves while an extension API call is still in flight (the options page here); it is not a failure of ours.
  const noise = /Promise (resolved while context is inactive|rejected after context unloaded)/;
  const errors = (await ff.ourScriptErrors()).filter((e) => !noise.test(e));
  assert.deepEqual(errors, []);
});
