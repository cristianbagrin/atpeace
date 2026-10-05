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
import { until } from '../helpers/wait.mjs';

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
  await until(() => run(() => document.body.dataset.ready === 'true' || document.querySelector('#content:not([aria-busy])') !== null), { what: 'the page to be ready', retryErrors: true });
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
  welcomeHandle = await until(async () => {
      for (const handle of await driver.getAllWindowHandles()) {
        await driver.switchTo().window(handle);
        if ((await driver.getCurrentUrl()).includes(WELCOME_PATH)) return handle;
      }
      return null;
    }, { what: 'the welcome tab', retryErrors: true, timeout: 15_000 }).catch(() => null);
  if (!welcomeHandle) await driver.switchTo().window(original);
});

after(async () => {
  await ff?.close();
});

test('welcome: the first install opens it, Gentle is applied, choices are saved, Finish marks the onboarding done', async () => {
  assert.ok(welcomeHandle, 'no welcome tab appeared after the install');
  await driver.switchTo().window(welcomeHandle);
  await until(() => run(() => document.body.dataset.ready === 'true'), { what: 'the page', retryErrors: true });
  assert.equal((await meta()).onboarded, false);
  assert.equal((await settings())['yt.shorts.mode'], 'watch', 'Gentle is in place');
  assert.equal(await run(() => document.querySelector('input[name="preset"]:checked').value), 'gentle');
  await shot('welcome-gentle');

  // a preset
  await click(await driver.findElement(By.xpath('//label[contains(@class,"choice")][.//span[normalize-space()="Focused"]]')));
  await until(async () => (await settings())['yt.home.feedMode'] === 'hide', { what: 'Focused applied', retryErrors: true });
  assert.equal((await settings())['yt.comments.hideAll'], true);
  // the pause: switch, breath, session
  await click(await driver.findElement(By.xpath('//label[normalize-space()="Pause before opening YouTube"]')));
  await until(async () => (await settings())['pause.enabled'] === true, { what: 'pause on', retryErrors: true });
  assert.equal(await run(() => document.querySelector('input[name="preset"]:checked').value), 'focused', 'the pause does not unselect the preset');
  const breath = await css('#pause input[type="number"]');
  await breath.clear();
  await breath.sendKeys('9', Key.TAB);
  await until(async () => (await settings())['pause.breathSeconds'] === 9, { what: 'breath 9', retryErrors: true });
  await run(() => {
    const select = document.querySelector('#pause select');
    select.value = '30';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await until(async () => (await settings())['pause.sessionMinutes'] === '30', { what: 'session 30', retryErrors: true });
  await shot('welcome-choices');

  // finish
  await click('#finish-button');
  await until(() => run(() => document.getElementById('open-youtube') !== null), { what: 'the finished state', retryErrors: true });
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
  await until(async () => (await settings())['advanced.lock']?.mode === 'password', { what: 'the lock to be saved', retryErrors: true });
  const lock = (await settings())['advanced.lock'];
  assert.ok(lock.iterations >= 200_000 && lock.salt && lock.hash);
  assert.ok(!JSON.stringify(await ff.getStorage()).includes(PASSWORD));
  await until(() => run(() => /Locked\./.test(document.querySelector('.lock-bar')?.textContent ?? '') && !document.querySelector('.lock-bar').hidden), { what: 'the lock bar', retryErrors: true });

  // loosening: refused, the switch goes back
  const label = `.row[data-id="${HIDE_ADS}"] .row-label`;
  await click(label);
  await until(() => run((id) => !document.querySelector(`.row[data-id="${id}"] .row-lock`).hidden, HIDE_ADS), { what: 'the locked note', retryErrors: true });
  assert.equal((await settings())[HIDE_ADS], true);
  assert.equal(await run((id) => document.querySelector(`.row[data-id="${id}"] input.switch`).checked, HIDE_ADS), true);
  await shot('options-refused');

  // unlock: wrong, then right
  await click(`.row[data-id="${HIDE_ADS}"] .row-lock button`);
  await until(() => run(() => document.querySelector('dialog[open] input[type="password"]') !== null), { what: 'the dialog', retryErrors: true });
  await shot('unlock-dialog');
  await css('dialog[open] input[type="password"]').sendKeys('wrong', Key.ENTER);
  await until(() => run(() => !document.querySelector('dialog[open] .unlock-error').hidden), { what: 'the error', retryErrors: true });
  assert.equal((await state()).lockUnlockedUntil ?? 0, 0);
  const field = await css('dialog[open] input[type="password"]');
  await field.clear();
  await field.sendKeys(PASSWORD, Key.ENTER);
  await until(() => run(() => document.querySelector('dialog[open]') === null), { what: 'the dialog to close', retryErrors: true });
  assert.ok((await state()).lockUnlockedUntil > Date.now());
  await until(() => run(() => /Unlocked until/.test(document.querySelector('.lock-bar').textContent)), { what: '"Unlocked until"', retryErrors: true });

  // now it goes through; "Lock now" closes it again
  await click(label);
  await until(async () => (await settings())[HIDE_ADS] === false, { what: 'hideAds off', retryErrors: true });
  await run(() => window.scrollTo(0, 0));
  await click(await byText('button', 'Lock now'));
  await until(async () => ((await state()).lockUnlockedUntil ?? 0) === 0, { what: 'relocked', retryErrors: true });
  await click(label);
  await until(async () => (await settings())[HIDE_ADS] === true, { what: 'turning it on is allowed while locked', retryErrors: true });
  await click(label);
  await until(() => run((id) => !document.querySelector(`.row[data-id="${id}"] .row-lock`).hidden, HIDE_ADS), { what: 'the note again', retryErrors: true });
  assert.equal((await settings())[HIDE_ADS], true);
  assert.deepEqual(await ff.ourScriptErrors(), []);
});

test('popup: locked, refused with a note, the friction unlock is inline (wait, then the sentence)', async () => {
  await reset({ settings: { 'advanced.lock': { mode: 'friction', waitSeconds: 10 } } });
  await open(POPUP);
  await until(() => run(() => !document.querySelector('.lock-bar').hidden), { what: 'the lock bar', retryErrors: true });
  await click('#master input.switch');
  await until(() => run(() => /That would show something again/.test(document.querySelector('.lock-bar').textContent)), { what: 'the refusal', retryErrors: true });
  assert.equal(await run(() => document.querySelector('#master input.switch').checked), true);
  assert.equal((await settings())['general.enabled'], undefined);
  await shot('popup-refused');

  await click(await byText('button', 'Unlock…'));
  await until(() => run(() => document.querySelector('.unlock-inline .unlock-sentence') !== null), { what: 'the unlock steps', retryErrors: true });
  assert.equal(await run(() => document.querySelector('.unlock-inline input[type="text"]').disabled), true);
  await shot('popup-unlock-wait');
  await until(() => run(() => !document.querySelector('.unlock-inline input[type="text"]').disabled), { what: 'the wait to end (10 s)', retryErrors: true, timeout: 20_000 });
  const sentence = await css('.unlock-inline .unlock-sentence').getText();
  await css('.unlock-inline input[type="text"]').sendKeys(sentence, Key.ENTER);
  await until(() => run(() => /Unlocked until/.test(document.querySelector('.lock-bar').textContent)), { what: '"Unlocked until"', retryErrors: true });
  await shot('popup-unlocked');
  await click('#master input.switch');
  await until(async () => (await settings())['general.enabled'] === false, { what: 'At Peace off', retryErrors: true });
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
  await until(() => run(() => !document.querySelector('.row[data-id="yt.home.redirectUrl"]').classList.contains('is-disabled')), { what: 'the row to open up', retryErrors: true });

  await open(`${OPTIONS}#section=week`);
  await click(await byText('button', 'Clear usage history…'));
  await until(() => run(() => document.querySelector('dialog[open]') !== null), { what: 'the dialog', retryErrors: true });
  await click(await byText('button', 'Clear history'));
  await until(async () => Object.keys((await ff.getStorage('stats')).stats ?? {}).length === 0, { what: 'stats cleared', retryErrors: true });
  assert.deepEqual(await ff.ourScriptErrors(), []);
});
