// Welcome page E2E in Chromium (Phase 4b): it opens by itself after a fresh install, Gentle is
// already in place, choosing a preset and the pause settings is saved at once, Finish marks the
// onboarding done and offers the two ways on. Light + dark screenshots go to tests/e2e/artifacts/lock/.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, close, getContext, extUrl, trackErrors, setStorage, getStorage, evalInExtension, ARTIFACTS } from './harness.mjs';

const SHOTS = join(ARTIFACTS, 'lock');
const WELCOME = 'src/pages/welcome/welcome.html';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Polls an async condition (page.waitForFunction does not wait for a promise-returning predicate). */
async function until(check, timeout = 8000) {
  const start = Date.now();
  let last;
  while (!(last = await check())) {
    if (Date.now() - start > timeout) throw new Error(`condition not met within ${timeout} ms: ${check}`);
    await sleep(50);
  }
  return last;
}

let installTab = null;

before(async () => {
  mkdirSync(SHOTS, { recursive: true });
  await launch();
  // The background opens the welcome page by itself on the first install: look for that tab now.
  installTab = await until(() => getContext().pages().find((p) => p.url().includes('/src/pages/welcome/welcome.html')), 10_000).catch(() => null);
  if (installTab) trackErrors(installTab);
});
after(async () => {
  await close();
});

const stored = async () => (await getStorage('settings')).settings ?? {};
const meta = async () => (await getStorage('meta')).meta ?? {};

async function openWelcome({ seed, width = 1200, height = 1000 } = {}) {
  await evalInExtension(() => chrome.storage.local.clear());
  if (seed) await setStorage(seed);
  const page = trackErrors(await getContext().newPage());
  await page.setViewportSize({ width, height });
  await page.goto(extUrl(WELCOME));
  await page.waitForSelector('body[data-ready="true"]');
  return page;
}

test('a fresh install opens the welcome page by itself, with the Gentle preset already applied and nothing onboarded yet', async () => {
  assert.ok(installTab, 'no welcome tab appeared after the install');
  assert.match(installTab.url(), /\/src\/pages\/welcome\/welcome\.html$/);
  await installTab.waitForSelector('body[data-ready="true"]');
  const gentle = await stored();
  assert.equal(gentle['yt.general.hideAds'], true);
  assert.equal(gentle['yt.shorts.mode'], 'watch');
  assert.equal((await meta()).onboarded, false);
  assert.equal(await installTab.locator('input[name="preset"]:checked').inputValue(), 'gentle', 'Gentle is preselected');
  assert.deepEqual(installTab.errors, []);
  assert.equal(getContext().pages().filter((p) => p.url().includes('welcome.html')).length, 1, 'opened once');
});

test('the page: three numbered steps, four preset rows, the pause rows, the shortcuts and a Finish button', async () => {
  const page = await openWelcome({ seed: { settings: await stored() } });
  assert.equal(await page.locator('h1').textContent(), 'At Peace');
  assert.deepEqual(await page.locator('.step-title').allTextContents(), ['How much do you want to see?', 'A breath before YouTube?', 'Keep it in reach']);
  assert.deepEqual(await page.locator('.step .num').allTextContents(), ['01', '02', '03']);
  assert.deepEqual(await page.locator('.choice-name').allTextContents(), ['Gentle', 'Focused', 'Deep work', 'Untouched']);
  for (const desc of await page.locator('.choice-desc').allTextContents()) assert.ok(desc.length > 20 && desc.length < 100, desc);
  assert.deepEqual(await page.locator('#pause .row-label').allTextContents(), ['Pause before opening YouTube', 'Length of the breath', 'When I continue, keep it open for']);
  assert.deepEqual(await page.locator('.key-row dd').allTextContents(), ['Turn At Peace on or off', 'Block YouTube for 25 minutes', 'Hide an element on the page']);
  assert.match(await page.locator('.step').nth(2).textContent(), /Pin to Toolbar/);
  assert.equal(await page.getByRole('button', { name: 'Finish' }).count(), 1);
  // the three shortcuts of the manifest, as keys
  const manifestKeys = await page.evaluate(() => Object.values(chrome.runtime.getManifest().commands).map((c) => c.suggested_key.default));
  assert.deepEqual([...manifestKeys].sort(), ['Alt+Shift+F', 'Alt+Shift+H', 'Alt+Shift+P']);
  assert.ok((await page.locator('.key-row kbd').count()) >= 4);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('choosing a preset applies it, and Deep work switches the pause on in step 2', async () => {
  const page = await openWelcome({ seed: { settings: { 'yt.general.hideAds': true } } });
  assert.equal(await page.locator('input[name="preset"]:checked').count(), 0, 'a hand-made mix matches no preset');
  assert.match(await page.locator('#step-1-intro').textContent(), /your own mix/);

  // "your own mix" is replaced only after a question
  await page.locator('label.choice', { hasText: 'Focused' }).click();
  await page.locator('dialog[open] button[value="confirm"]').click();
  await until(async () => (await stored())['yt.home.feedMode'] === 'hide');
  const focused = await stored();
  assert.equal(focused['yt.comments.hideAll'], true);
  assert.equal(focused['yt.watch.disableAutoplay'], true);
  assert.equal(await page.locator('input[name="preset"]:checked').inputValue(), 'focused');
  assert.equal(await page.locator('#pause input.switch').isChecked(), false);

  await page.locator('label.choice', { hasText: 'Deep work' }).click(); // a preset is in place: no question
  await until(async () => (await stored())['yt.home.feedMode'] === 'subscriptions');
  assert.equal((await stored())['pause.enabled'], true, 'Deep work includes the pause');
  await page.waitForFunction(() => document.querySelector('#pause input.switch').checked);
  assert.equal(await page.locator('#pause .row').nth(1).evaluate((r) => r.classList.contains('is-disabled')), false);

  await page.locator('label.choice', { hasText: 'Untouched' }).click();
  await until(async () => (await stored())['yt.home.feedMode'] === undefined && (await stored())['pause.enabled'] === undefined);
  assert.equal((await stored())['yt.general.hideAds'], undefined, 'nothing hidden');
  await page.waitForFunction(() => !document.querySelector('#pause input.switch').checked);
  assert.equal(await page.locator('#pause .row').nth(1).evaluate((r) => r.classList.contains('is-disabled')), true, 'the breath waits for the switch');
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('the whole flow: Focused, a breath of 9 seconds, 30-minute sessions, Finish → onboarded, two ways on', async () => {
  const page = await openWelcome({ seed: { settings: await stored() } });
  await page.locator('label.choice', { hasText: 'Focused' }).click();
  await until(async () => (await stored())['yt.home.feedMode'] === 'hide');

  const pause = page.locator('#pause');
  await pause.locator('.row-label', { hasText: 'Pause before opening YouTube' }).click();
  await until(async () => (await stored())['pause.enabled'] === true);
  assert.equal(await page.locator('input[name="preset"]:checked').inputValue(), 'focused', 'the pause is its own choice: step 01 still says Focused');
  assert.equal(await pause.locator('input[type="number"]').isDisabled(), false);
  assert.equal(await pause.locator('input[type="number"]').inputValue(), '6', 'the default breath is 6 seconds');
  await pause.locator('input[type="number"]').fill('9');
  await pause.locator('input[type="number"]').press('Tab');
  await until(async () => (await stored())['pause.breathSeconds'] === 9);
  await pause.locator('select').selectOption('30');
  await until(async () => (await stored())['pause.sessionMinutes'] === '30');
  await pause.locator('input[type="number"]').fill('99'); // out of range: refused inline, nothing stored
  await pause.locator('input[type="number"]').press('Tab');
  assert.match(await pause.locator('.row[data-id="pause.breathSeconds"] .row-error').textContent(), /from 3 to 30/);
  assert.equal((await stored())['pause.breathSeconds'], 9);
  await pause.locator('input[type="number"]').fill('9');
  await pause.locator('input[type="number"]').press('Tab');

  await page.screenshot({ path: join(SHOTS, 'welcome-light.png'), fullPage: true });

  assert.notEqual((await meta()).onboarded, true);
  await page.getByRole('button', { name: 'Finish' }).click();
  await page.locator('#open-youtube').waitFor();
  assert.equal((await meta()).onboarded, true);
  assert.equal(await page.locator('#open-youtube').getAttribute('href'), 'https://www.youtube.com/');
  assert.match(await page.locator('#finish').textContent(), /You are all set/);
  await page.screenshot({ path: join(SHOTS, 'welcome-done-light.png'), fullPage: true });

  // The browser opens its settings tab, or brings forward the one that is already open (the test's helper page).
  await page.getByRole('button', { name: 'See all settings' }).click();
  await until(() => getContext().pages().some((p) => p.url().includes('/src/pages/options/options.html')));

  // the settings the person chose are the ones in force
  const final = await stored();
  assert.equal(final['pause.enabled'], true);
  assert.equal(final['pause.breathSeconds'], 9);
  assert.equal(final['pause.sessionMinutes'], '30');
  assert.equal(final['yt.home.feedMode'], 'hide');
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('while the settings are locked a loosening choice is refused calmly and the radio goes back', async () => {
  const lock = { mode: 'friction', waitSeconds: 10 };
  const page = await openWelcome({ seed: { settings: { 'advanced.lock': lock, 'yt.home.feedMode': 'hide', 'yt.general.hideAds': true, 'yt.comments.hideAll': true } } });
  await page.locator('label.choice', { hasText: 'Untouched' }).click();
  await page.locator('dialog[open] button[value="confirm"]').click(); // a hand-made mix: the question comes first
  await page.locator('.toast.is-visible').waitFor();
  assert.match(await page.locator('.toast').textContent(), /Locked/);
  assert.equal((await stored())['yt.home.feedMode'], 'hide');
  assert.equal(await page.locator('input[name="preset"]:checked').count(), 0);
  // the pause switch: on is fine, off again is refused
  await page.locator('#pause .row-label', { hasText: 'Pause before opening YouTube' }).click();
  await until(async () => (await stored())['pause.enabled'] === true);
  await page.locator('#pause .row-label', { hasText: 'Pause before opening YouTube' }).click();
  await page.locator('.toast.is-visible').waitFor();
  await sleep(200);
  assert.equal((await stored())['pause.enabled'], true);
  assert.equal(await page.locator('#pause input.switch').isChecked(), true);
  await page.close();
});

test('dark: welcome before and after Finish', async () => {
  const page = await openWelcome({ seed: { settings: { 'general.theme': 'dark', 'yt.general.hideAds': true } } });
  await page.locator('label.choice', { hasText: 'Focused' }).click();
  await page.locator('dialog[open] button[value="confirm"]').click();
  await until(async () => (await stored())['yt.home.feedMode'] === 'hide');
  await page.screenshot({ path: join(SHOTS, 'welcome-dark.png'), fullPage: true });
  await page.getByRole('button', { name: 'Finish' }).click();
  await page.locator('#open-youtube').waitFor();
  await page.screenshot({ path: join(SHOTS, 'welcome-done-dark.png'), fullPage: true });
  // narrow window: one column, nothing scrolls sideways
  await page.setViewportSize({ width: 420, height: 900 });
  await page.reload();
  await page.waitForSelector('body[data-ready="true"]');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, 'no horizontal scroll at phone width');
  await page.screenshot({ path: join(SHOTS, 'welcome-narrow-dark.png'), fullPage: true });
  assert.deepEqual(page.errors, []);
  await page.close();
});
