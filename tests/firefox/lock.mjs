// The settings lock and the welcome page in REAL Firefox (Phase 4b): the first install opens the
// welcome page; the page applies a preset and the pause choices and marks the onboarding done; a
// password lock is set up in the options page, refuses a loosening with a calm note, unlocks with
// the password, relocks; the popup unlocks inline with the friction wait (10 s, real time).
// Prerequisite: bash tests/firefox/setup.sh.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { By, Key } from 'selenium-webdriver';
import { launchFirefox, extUrl, ROOT } from './_harness.mjs';

const SHOTS = join(ROOT, 'tests', 'e2e', 'artifacts', 'lock');
const OPTIONS = extUrl('src/pages/options/options.html');
const POPUP = extUrl('src/pages/popup/popup.html');
const WELCOME_PATH = '/src/pages/welcome/welcome.html';
const PASSWORD = 'correct horse';
const HIDE_ADS = 'yt.general.hideAds';

let ff;
let driver;
let welcomeHandle = null;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(what, fn, timeout = 15_000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    try {
      last = await fn();
      if (last) return last;
    } catch (err) {
      last = err;
    }
    await sleep(100);
  }
  throw new Error(`timed out waiting for ${what}${last instanceof Error ? `: ${last.message}` : ''}`);
}

const css = (selector) => driver.findElement(By.css(selector));
const run = (fn, ...args) => driver.executeScript(fn, ...args);
const settings = async () => (await ff.getStorage('settings')).settings ?? {};
const state = async () => (await ff.getStorage('state')).state ?? {};
const meta = async () => (await ff.getStorage('meta')).meta ?? {};
const byText = (tag, text) => driver.findElement(By.xpath(`//${tag}[normalize-space()="${text}"]`));

async function shot(name) {
  mkdirSync(SHOTS, { recursive: true });
  writeFileSync(join(SHOTS, `firefox-${name}.png`), await driver.takeScreenshot(), 'base64');
}

async function open(url) {
  await sleep(300);
  await driver.get(url);
  await until('the page to be ready', () => run(() => document.body.dataset.ready === 'true' || document.querySelector('#content:not([aria-busy])') !== null));
  await sleep(200);
}

/** Scrolls an element to the middle (the options page has a sticky bar) and clicks it. */
async function click(selectorOrElement) {
  const el = typeof selectorOrElement === 'string' ? await css(selectorOrElement) : selectorOrElement;
  await run((e) => e.scrollIntoView({ block: 'center' }), el);
  await el.click();
}

async function reset(seed) {
  await ff.setStorage({ settings: {}, state: {}, stats: {} });
  await driver.get('about:blank');
  if (seed) await ff.setStorage(seed);
}

before(async () => {
  mkdirSync(SHOTS, { recursive: true });
  ff = await launchFirefox();
  driver = ff.driver;
  await driver.manage().window().setRect({ width: 1280, height: 1000 });
  // The temporary install counts as a first install: the background opens the welcome page.
  const original = await driver.getWindowHandle();
  welcomeHandle = await until(
    'the welcome tab',
    async () => {
      for (const handle of await driver.getAllWindowHandles()) {
        await driver.switchTo().window(handle);
        if ((await driver.getCurrentUrl()).includes(WELCOME_PATH)) return handle;
      }
      return null;
    },
    15_000,
  ).catch(() => null);
  if (!welcomeHandle) await driver.switchTo().window(original);
});

after(async () => {
  await ff?.close();
});

test('welcome: the first install opens it, Gentle is applied, choices are saved, Finish marks the onboarding done', async () => {
  assert.ok(welcomeHandle, 'no welcome tab appeared after the install');
  await driver.switchTo().window(welcomeHandle);
  await until('the page', () => run(() => document.body.dataset.ready === 'true'));
  assert.equal((await meta()).onboarded, false);
  assert.equal((await settings())['yt.shorts.mode'], 'watch', 'Gentle is in place');
  assert.equal(await run(() => document.querySelector('input[name="preset"]:checked').value), 'gentle');
  await shot('welcome-gentle');

  // a preset
  await click(await driver.findElement(By.xpath('//label[contains(@class,"choice")][.//span[normalize-space()="Focused"]]')));
  await until('Focused applied', async () => (await settings())['yt.home.feedMode'] === 'hide');
  assert.equal((await settings())['yt.comments.hideAll'], true);
  // the pause: switch, breath, session
  await click(await driver.findElement(By.xpath('//label[normalize-space()="Pause before opening YouTube"]')));
  await until('pause on', async () => (await settings())['pause.enabled'] === true);
  assert.equal(await run(() => document.querySelector('input[name="preset"]:checked').value), 'focused', 'the pause does not unselect the preset');
  const breath = await css('#pause input[type="number"]');
  await breath.clear();
  await breath.sendKeys('9', Key.TAB);
  await until('breath 9', async () => (await settings())['pause.breathSeconds'] === 9);
  await run(() => {
    const select = document.querySelector('#pause select');
    select.value = '30';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await until('session 30', async () => (await settings())['pause.sessionMinutes'] === '30');
  await shot('welcome-choices');

  // finish
  await click('#finish-button');
  await until('the finished state', () => run(() => document.getElementById('open-youtube') !== null));
  assert.equal((await meta()).onboarded, true);
  assert.equal(await css('#open-youtube').getAttribute('href'), 'https://www.youtube.com/');
  assert.ok(await css('#open-settings'));
  await shot('welcome-done');
  assert.deepEqual(await ff.ourScriptErrors(), []);
});

test('options: password lock — refused loosening shows a calm note, wrong password, right password, loosen, lock now', async () => {
  await reset({ settings: { [HIDE_ADS]: true } });
  await open(`${OPTIONS}#section=advanced`);

  await run(() => document.querySelector('#lock-password').scrollIntoView({ block: 'center' }));
  await shot('lock-setup');
  await css('#lock-password').sendKeys(PASSWORD);
  await css('#lock-password-again').sendKeys(PASSWORD);
  await click(await byText('button', 'Turn on the lock'));
  await until('the lock to be saved', async () => (await settings())['advanced.lock']?.mode === 'password');
  const lock = (await settings())['advanced.lock'];
  assert.ok(lock.iterations >= 200_000 && lock.salt && lock.hash);
  assert.ok(!JSON.stringify(await ff.getStorage()).includes(PASSWORD));
  await until('the lock bar', () => run(() => /Locked\./.test(document.querySelector('.lock-bar')?.textContent ?? '') && !document.querySelector('.lock-bar').hidden));

  // loosening: refused, the switch goes back
  const label = `.row[data-id="${HIDE_ADS}"] .row-label`;
  await click(label);
  await until('the locked note', () => run((id) => !document.querySelector(`.row[data-id="${id}"] .row-lock`).hidden, HIDE_ADS));
  assert.equal((await settings())[HIDE_ADS], true);
  assert.equal(await run((id) => document.querySelector(`.row[data-id="${id}"] input.switch`).checked, HIDE_ADS), true);
  await shot('options-refused');

  // unlock: wrong, then right
  await click(`.row[data-id="${HIDE_ADS}"] .row-lock button`);
  await until('the dialog', () => run(() => document.querySelector('dialog[open] input[type="password"]') !== null));
  await shot('unlock-dialog');
  await css('dialog[open] input[type="password"]').sendKeys('wrong', Key.ENTER);
  await until('the error', () => run(() => !document.querySelector('dialog[open] .unlock-error').hidden));
  assert.equal((await state()).lockUnlockedUntil ?? 0, 0);
  const field = await css('dialog[open] input[type="password"]');
  await field.clear();
  await field.sendKeys(PASSWORD, Key.ENTER);
  await until('the dialog to close', () => run(() => document.querySelector('dialog[open]') === null));
  assert.ok((await state()).lockUnlockedUntil > Date.now());
  await until('"Unlocked until"', () => run(() => /Unlocked until/.test(document.querySelector('.lock-bar').textContent)));

  // now it goes through; "Lock now" closes it again
  await click(label);
  await until('hideAds off', async () => (await settings())[HIDE_ADS] === false);
  await run(() => window.scrollTo(0, 0));
  await click(await byText('button', 'Lock now'));
  await until('relocked', async () => ((await state()).lockUnlockedUntil ?? 0) === 0);
  await click(label);
  await until('turning it on is allowed while locked', async () => (await settings())[HIDE_ADS] === true);
  await click(label);
  await until('the note again', () => run((id) => !document.querySelector(`.row[data-id="${id}"] .row-lock`).hidden, HIDE_ADS));
  assert.equal((await settings())[HIDE_ADS], true);
  assert.deepEqual(await ff.ourScriptErrors(), []);
});

test('popup: locked, refused with a note, the friction unlock is inline (wait, then the sentence)', async () => {
  await reset({ settings: { 'advanced.lock': { mode: 'friction', waitSeconds: 10 } } });
  await open(POPUP);
  await until('the lock bar', () => run(() => !document.querySelector('.lock-bar').hidden));
  await click('#master input.switch');
  await until('the refusal', () => run(() => /That would show something again/.test(document.querySelector('.lock-bar').textContent)));
  assert.equal(await run(() => document.querySelector('#master input.switch').checked), true);
  assert.equal((await settings())['general.enabled'], undefined);
  await shot('popup-refused');

  await click(await byText('button', 'Unlock…'));
  await until('the unlock steps', () => run(() => document.querySelector('.unlock-inline .unlock-sentence') !== null));
  assert.equal(await run(() => document.querySelector('.unlock-inline input[type="text"]').disabled), true);
  await shot('popup-unlock-wait');
  await until('the wait to end (10 s)', () => run(() => !document.querySelector('.unlock-inline input[type="text"]').disabled), 20_000);
  const sentence = await css('.unlock-inline .unlock-sentence').getText();
  await css('.unlock-inline input[type="text"]').sendKeys(sentence, Key.ENTER);
  await until('"Unlocked until"', () => run(() => /Unlocked until/.test(document.querySelector('.lock-bar').textContent)));
  await shot('popup-unlocked');
  await click('#master input.switch');
  await until('At Peace off', async () => (await settings())['general.enabled'] === false);
  assert.deepEqual(await ff.ourScriptErrors(), []);
});

test('options: "When I open YouTube" short labels in the popup, the redirect row waits for "my own page", clear usage history', async () => {
  await reset({ settings: { 'yt.home.feedMode': 'hide' }, stats: { [new Date().toISOString().slice(0, 10)]: { youtube: { activeSec: 120, opens: 2, turnedBack: 0, continued: 1, blockedHits: 0 } } } });
  await open(POPUP);
  const labels = await run(() => [...document.querySelectorAll('.row[data-id="yt.home.feedMode"] option')].map((o) => o.textContent));
  assert.deepEqual(labels, ['Show feed', 'Calm page', 'Subscriptions', 'Watch later', 'Playlists', 'My own page']);
  await open(`${OPTIONS}#setting=yt.home.redirectUrl`);
  assert.equal(await run(() => document.querySelector('.row[data-id="yt.home.redirectUrl"]').classList.contains('is-disabled')), true);
  assert.match(await run(() => document.querySelector('.row[data-id="yt.home.redirectUrl"] .row-hint').textContent), /set to “Go to my own page”/);
  await run(() => {
    const select = document.querySelector('.row[data-id="yt.home.feedMode"] select');
    select.value = 'custom';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await until('the row to open up', () => run(() => !document.querySelector('.row[data-id="yt.home.redirectUrl"]').classList.contains('is-disabled')));

  await open(`${OPTIONS}#section=week`);
  await click(await byText('button', 'Clear usage history…'));
  await until('the dialog', () => run(() => document.querySelector('dialog[open]') !== null));
  await click(await byText('button', 'Clear history'));
  await until('stats cleared', async () => Object.keys((await ff.getStorage('stats')).stats ?? {}).length === 0);
  assert.deepEqual(await ff.ourScriptErrors(), []);
});
