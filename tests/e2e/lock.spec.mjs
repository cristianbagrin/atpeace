// Settings lock E2E in Chromium (Phase 4b): set up a password lock in the options page, see a
// loosening refused with a calm note, tighten freely, unlock (wrong password, then right one),
// loosen, relock; friction unlock with a short wait; the locked popup; the blocked page; backup
// and history actions behind the lock; follow-ups (requires "id=value", short popup labels, clear
// usage history). Light + dark screenshots go to tests/e2e/artifacts/lock/.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { launch, close, getContext, extUrl, trackErrors, setStorage, getStorage, evalInExtension, ARTIFACTS } from './harness.mjs';

const SHOTS = join(ARTIFACTS, 'lock');
const OPTIONS = 'src/pages/options/options.html';
const POPUP = 'src/pages/popup/popup.html';
const BLOCKED = 'src/pages/blocked/blocked.html';
const PASSWORD = 'correct horse';
const HIDE_ADS = 'yt.general.hideAds';
const HIDE_COMMENTS = 'yt.comments.hideAll';

before(async () => {
  mkdirSync(SHOTS, { recursive: true });
  await launch();
});
after(async () => {
  await close();
});
beforeEach(async () => {
  await evalInExtension(() => chrome.storage.local.clear());
  await new Promise((resolve) => setTimeout(resolve, 150)); // let the background settle after the wipe
});

async function openPage(path, { seed, width = 1200, height = 900, hash = '', clock = false } = {}) {
  if (seed) await setStorage(seed);
  const page = trackErrors(await getContext().newPage());
  await page.setViewportSize({ width, height });
  if (clock) await page.clock.install();
  await page.goto(`${extUrl(path)}${hash}`);
  return page;
}
const openOptions = async (opts) => {
  const page = await openPage(OPTIONS, opts);
  await page.waitForSelector('body[data-ready="true"]');
  return page;
};
const openPopup = async (opts) => {
  const page = await openPage(POPUP, { width: 360, height: 760, ...opts });
  await page.waitForSelector('#content:not([aria-busy])');
  return page;
};

const stored = async () => (await getStorage('settings')).settings ?? {};
const unlockedUntil = async () => (await getStorage('state')).state?.lockUnlockedUntil ?? 0;
const row = (page, id) => page.locator(`.row[data-id="${id}"]`);
const flip = (page, id) => row(page, id).locator('.row-label').click();
const switchOf = (page, id) => row(page, id).locator('input.switch');
const dialog = (page) => page.locator('dialog[open]');
const lockBar = (page) => page.locator('.lock-bar');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Polls an async condition (page.waitForFunction does not wait for a promise-returning predicate). */
async function until(check, timeout = 8000) {
  const start = Date.now();
  while (!(await check())) {
    if (Date.now() - start > timeout) throw new Error(`condition not met within ${timeout} ms: ${check}`);
    await sleep(50);
  }
}

/** A real password lock, made the way the page makes it. */
async function passwordLock(password = PASSWORD) {
  return evalInExtension((p) => globalThis.AtPeace.lock.createPasswordLock(p), password);
}
const theme = (name) => ({ 'general.theme': name });

// ---------------------------------------------------------------------------------------------
// The whole story, through the options page
// ---------------------------------------------------------------------------------------------

test('options: set a password lock, loosening is refused calmly, tightening is not, unlock, loosen, relock', async () => {
  const page = await openOptions({ seed: { settings: { [HIDE_ADS]: true } }, hash: '#section=advanced' });
  assert.equal(await lockBar(page).isHidden(), true, 'no lock yet: no bar');

  // --- set up (screenshots: the setup renderer) ---
  const lockRow = row(page, 'advanced.lock');
  await lockRow.scrollIntoViewIfNeeded();
  assert.match(await lockRow.textContent(), /A password/);
  assert.match(await lockRow.textContent(), /A moment of friction/);
  await page.screenshot({ path: join(SHOTS, 'lock-setup-light.png') });

  await lockRow.locator('#lock-password').fill(PASSWORD);
  await lockRow.locator('#lock-password-again').fill('something else');
  await lockRow.getByRole('button', { name: 'Turn on the lock' }).click();
  assert.match(await lockRow.locator('.field-error').textContent(), /not the same/);
  assert.equal((await stored())['advanced.lock'], undefined, 'nothing was saved');
  await lockRow.locator('#lock-password').fill('ab');
  await lockRow.locator('#lock-password-again').fill('ab');
  await lockRow.getByRole('button', { name: 'Turn on the lock' }).click();
  assert.match(await lockRow.locator('.field-error').textContent(), /at least 4/i);

  await lockRow.locator('#lock-password').fill(PASSWORD);
  await lockRow.locator('#lock-password-again').fill(PASSWORD);
  await lockRow.getByRole('button', { name: 'Turn on the lock' }).click();
  await until(async () => (await stored())['advanced.lock']?.mode === 'password');
  const lock = (await stored())['advanced.lock'];
  assert.deepEqual(Object.keys(lock).sort(), ['hash', 'iterations', 'mode', 'salt']);
  assert.ok(lock.iterations >= 200_000);
  assert.ok(!JSON.stringify(await getStorage()).includes(PASSWORD), 'the password is stored nowhere');
  assert.match(await lockRow.locator('.lock-state').textContent(), /A password holds these settings/);

  // the bar says it, and the new lock holds right away
  await lockBar(page).waitFor();
  assert.match(await lockBar(page).textContent(), /Locked\./);
  assert.equal(await unlockedUntil(), 0);

  // --- loosening is refused: the switch goes back, a calm note appears ---
  await flip(page, HIDE_ADS);
  const note = row(page, HIDE_ADS).locator('.row-lock');
  await note.waitFor();
  assert.match(await note.textContent(), /Locked\. Showing something again needs an unlock first\./);
  assert.equal(await switchOf(page, HIDE_ADS).isChecked(), true, 'the switch is back where it was');
  assert.equal((await stored())[HIDE_ADS], true, 'nothing changed in storage');
  assert.equal(await row(page, HIDE_ADS).locator('.row-error').isHidden(), true, 'not an error, a note');

  // --- tightening is not ---
  await flip(page, HIDE_COMMENTS);
  await until(async () => (await stored())[HIDE_COMMENTS] === true);
  assert.equal(await row(page, HIDE_COMMENTS).locator('.row-lock').isHidden(), true);

  // --- the unlock: a wrong password, then the right one ---
  await page.evaluate(() => window.scrollTo(0, 0));
  await note.scrollIntoViewIfNeeded();
  await note.getByRole('button', { name: 'Unlock…' }).click();
  await dialog(page).waitFor();
  assert.match(await dialog(page).textContent(), /Enter your password to change settings for the next 10 minutes/);
  await page.screenshot({ path: join(SHOTS, 'unlock-dialog-password-light.png') });
  await dialog(page).locator('input[type="password"]').fill('wrong');
  await dialog(page).getByRole('button', { name: 'Unlock', exact: true }).click();
  await dialog(page).locator('.unlock-error').waitFor();
  assert.match(await dialog(page).locator('.unlock-error').textContent(), /not the password/);
  assert.equal(await unlockedUntil(), 0);
  await dialog(page).locator('input[type="password"]').fill(PASSWORD);
  await page.keyboard.press('Enter');
  await dialog(page).waitFor({ state: 'detached' });
  const expiry = await unlockedUntil();
  assert.ok(expiry > Date.now() + 9 * 60_000 && expiry <= Date.now() + 10 * 60_000 + 2000, 'ten minutes');
  await lockBar(page).getByText(/Unlocked until/).waitFor();
  assert.equal(await note.isHidden(), true, 'the note goes away with the lock');

  // --- unlocked: loosening works ---
  await flip(page, HIDE_ADS);
  await until(async () => (await stored())[HIDE_ADS] === false);
  await page.screenshot({ path: join(SHOTS, 'options-unlocked-light.png') });

  // --- lock now ---
  await lockBar(page).getByRole('button', { name: 'Lock now' }).click();
  await lockBar(page).getByText(/^Locked\./).waitFor();
  assert.equal(await unlockedUntil(), 0);
  await flip(page, HIDE_COMMENTS);
  await row(page, HIDE_COMMENTS).locator('.row-lock').waitFor();
  assert.equal((await stored())[HIDE_COMMENTS], true);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('options: the lock itself cannot be changed or removed without an unlock; removing it frees everything', async () => {
  const lock = await passwordLock();
  const page = await openOptions({ seed: { settings: { 'advanced.lock': lock, [HIDE_ADS]: true } }, hash: '#section=advanced' });
  const lockRow = row(page, 'advanced.lock');
  await lockRow.scrollIntoViewIfNeeded();
  assert.match(await lockRow.locator('.lock-state').textContent(), /A password holds these settings/);
  await page.screenshot({ path: join(SHOTS, 'lock-summary-light.png') });

  // "Remove lock…" asks for the unlock first; cancelling leaves the lock alone
  await lockRow.getByRole('button', { name: 'Remove lock…' }).click();
  await dialog(page).waitFor();
  await dialog(page).getByRole('button', { name: 'Cancel' }).click();
  await dialog(page).waitFor({ state: 'detached' });
  assert.equal((await stored())['advanced.lock'].mode, 'password');

  await lockRow.getByRole('button', { name: 'Remove lock…' }).click();
  await dialog(page).locator('input[type="password"]').fill(PASSWORD);
  await dialog(page).getByRole('button', { name: 'Unlock', exact: true }).click();
  await dialog(page).locator('h2', { hasText: 'Remove the lock?' }).waitFor();
  await dialog(page).getByRole('button', { name: 'Remove lock' }).click();
  await until(async () => (await stored())['advanced.lock']?.mode === 'none');
  await lockRow.getByRole('button', { name: 'Turn on the lock' }).waitFor();
  await lockBar(page).waitFor({ state: 'hidden' });
  await flip(page, HIDE_ADS); // no lock: free
  await until(async () => (await stored())[HIDE_ADS] === false);
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('options: friction lock set up with a wait of 10 seconds; unlocking waits, then asks for the sentence', async () => {
  const page = await openOptions({ seed: { settings: { [HIDE_ADS]: true } }, hash: '#section=advanced' });
  const lockRow = row(page, 'advanced.lock');
  await lockRow.locator('label.lock-choice', { hasText: 'A moment of friction' }).click();
  await lockRow.locator('#lock-wait').fill('3');
  await lockRow.getByRole('button', { name: 'Turn on the lock' }).click();
  assert.match(await lockRow.locator('.field-error').textContent(), /from 10 to 600/);
  await lockRow.locator('#lock-wait').fill('10');
  await lockRow.getByRole('button', { name: 'Turn on the lock' }).click();
  await until(async () => (await stored())['advanced.lock']?.mode === 'friction');
  assert.deepEqual((await stored())['advanced.lock'], { mode: 'friction', waitSeconds: 10 });
  await page.close();

  // a fresh page with a controllable clock: the wait is 10 s, we do not sit through it
  const p2 = await openOptions({ clock: true, hash: '#section=advanced' });
  await flip(p2, HIDE_ADS);
  await row(p2, HIDE_ADS).locator('.row-lock').waitFor();
  await row(p2, HIDE_ADS).getByRole('button', { name: 'Unlock…' }).click();
  await dialog(p2).waitFor();
  const sentence = (await dialog(p2).locator('.unlock-sentence').textContent()).trim();
  assert.ok(sentence.endsWith('.') && sentence.length > 15);
  const field = dialog(p2).locator('input[type="text"]');
  assert.equal(await field.isDisabled(), true, 'the field stays shut during the wait');
  assert.match(await dialog(p2).locator('.unlock-wait').textContent(), /You can type it in \d+ s/);
  assert.equal(await dialog(p2).getByRole('button', { name: 'Unlock', exact: true }).isDisabled(), true);
  await p2.screenshot({ path: join(SHOTS, 'unlock-dialog-friction-wait-light.png') });

  await p2.clock.fastForward(4000);
  assert.equal(await field.isDisabled(), true, 'still waiting after 4 s');
  await p2.clock.fastForward(7000);
  await p2.waitForFunction(() => !document.querySelector('dialog[open] input[type="text"]').disabled);
  assert.match(await dialog(p2).locator('.unlock-wait').textContent(), /Now type the sentence/);
  await field.fill('I am rushing');
  assert.equal(await dialog(p2).getByRole('button', { name: 'Unlock', exact: true }).isDisabled(), true, 'only the sentence opens it');
  await field.fill(sentence.toLowerCase().replace(/\.$/, '')); // case and the full stop do not matter
  await p2.screenshot({ path: join(SHOTS, 'unlock-dialog-friction-typed-light.png') });
  await dialog(p2).getByRole('button', { name: 'Unlock', exact: true }).click();
  await dialog(p2).waitFor({ state: 'detached' });
  assert.ok((await unlockedUntil()) > Date.now());
  await flip(p2, HIDE_ADS);
  await until(async () => (await stored())[HIDE_ADS] === false);
  assert.deepEqual(p2.errors, []);
  await p2.close();
});

test('options: bulk chips and presets that would show things again need the unlock; ones that hide more do not', async () => {
  const lock = { mode: 'friction', waitSeconds: 10 };
  const page = await openOptions({ seed: { settings: { 'advanced.lock': lock } } });
  // "Hide all Shorts" tightens: no prompt
  await page.locator('.chip', { hasText: 'Shorts' }).click();
  await until(async () => (await stored())['yt.shorts.mode'] === 'block');
  assert.equal(await dialog(page).count(), 0);
  // pressing it again would turn everything off: the unlock dialog opens; cancelling changes nothing
  await page.locator('.chip', { hasText: 'Shorts' }).click();
  await dialog(page).waitFor();
  assert.match(await dialog(page).textContent(), /Showing something again is a choice/);
  await dialog(page).getByRole('button', { name: 'Cancel' }).click();
  await dialog(page).waitFor({ state: 'detached' });
  assert.equal((await stored())['yt.shorts.mode'], 'block');
  // a preset that hides more goes through; one that shows more is refused until unlocked
  await page.getByRole('button', { name: 'Presets' }).click();
  const preset = (name) => dialog(page).locator('.preset').filter({ has: page.locator('.preset-name', { hasText: new RegExp(`^${name}`) }) });
  await preset('Deep work').getByRole('button', { name: 'Apply' }).click();
  await dialog(page).getByRole('button', { name: 'Apply preset' }).click();
  await until(async () => (await stored())['yt.home.feedMode'] === 'subscriptions');
  assert.equal(await dialog(page).count(), 0);
  await page.getByRole('button', { name: 'Presets' }).click();
  await preset('Untouched').getByRole('button', { name: 'Apply' }).click();
  await dialog(page).getByRole('button', { name: 'Apply preset' }).click();
  await dialog(page).locator('.unlock-sentence').waitFor();
  await dialog(page).getByRole('button', { name: 'Cancel' }).click();
  await dialog(page).waitFor({ state: 'detached' });
  assert.equal((await stored())['yt.home.feedMode'], 'subscriptions', 'not applied');
  await page.close();
});

test('options: import and reset ask for the unlock while locked', async () => {
  const page = await openOptions({ seed: { settings: { 'advanced.lock': { mode: 'friction', waitSeconds: 10 }, [HIDE_ADS]: true } }, hash: '#section=backup' });
  await page.getByRole('button', { name: 'Reset…' }).click();
  await dialog(page).getByRole('button', { name: 'Reset settings' }).click();
  await dialog(page).locator('.unlock-sentence').waitFor();
  await dialog(page).getByRole('button', { name: 'Cancel' }).click();
  await dialog(page).waitFor({ state: 'detached' });
  assert.equal((await stored())[HIDE_ADS], true, 'nothing was reset');
  assert.deepEqual((await stored())['advanced.lock'], { mode: 'friction', waitSeconds: 10 });
  await page.close();
});

// ---------------------------------------------------------------------------------------------
// The popup and the blocked page
// ---------------------------------------------------------------------------------------------

test('popup: locked, a loosening is refused with a note, tightening works, the unlock is inline', async () => {
  const lock = await passwordLock();
  const page = await openPopup({ seed: { settings: { 'advanced.lock': lock, 'yt.general.hideAds': true, 'yt.watch.hideRelated': false } } });
  const bar = lockBar(page);
  await bar.waitFor();
  assert.match(await bar.textContent(), /Locked/);
  await page.screenshot({ path: join(SHOTS, 'popup-locked-light.png') });

  // the master switch off would loosen: refused, the switch stays on
  const master = page.locator('#master input.switch');
  await master.click();
  await page.waitForFunction(() => /That would show something again/.test(document.querySelector('.lock-bar').textContent));
  assert.equal(await master.isChecked(), true);
  assert.equal((await stored())['general.enabled'], undefined);
  await page.screenshot({ path: join(SHOTS, 'popup-locked-refused-light.png') });

  // a quick toggle that is on: refused; one that is off: allowed
  const quickToggles = await page.evaluate(() => globalThis.AtPeace.ui.quickSettings().filter((d) => d.type === 'toggle' && d.id.startsWith('yt.')).map((d) => d.id));
  const on = 'yt.general.hideAds';
  assert.ok(quickToggles.includes(on));
  await page.locator(`.row[data-id="${on}"] .row-label`).click();
  await sleep(150);
  assert.equal((await stored())[on], true);
  assert.equal(await page.locator(`.row[data-id="${on}"] input.switch`).isChecked(), true);
  const current = await stored();
  const off = quickToggles.find((id) => id !== on && !current[id]);
  await page.locator(`.row[data-id="${off}"] .row-label`).click();
  await until(async () => (await stored())[off] === true);

  // unlock inline with the password
  await bar.getByRole('button', { name: 'Unlock…' }).click();
  const inline = page.locator('.unlock-inline');
  await inline.locator('input[type="password"]').fill('wrong');
  await inline.getByRole('button', { name: 'Unlock', exact: true }).click();
  await inline.locator('.unlock-error').waitFor();
  await page.screenshot({ path: join(SHOTS, 'popup-unlock-inline-light.png') });
  await inline.locator('input[type="password"]').fill(PASSWORD);
  await inline.getByRole('button', { name: 'Unlock', exact: true }).click();
  await bar.getByText(/Unlocked until/).waitFor();
  assert.equal(await inline.isHidden(), true);
  await master.click();
  await until(async () => (await stored())['general.enabled'] === false);
  await page.screenshot({ path: join(SHOTS, 'popup-unlocked-light.png') });
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('popup: ending a focus block early needs the unlock while locked', async () => {
  const lock = { mode: 'friction', waitSeconds: 10 };
  const page = await openPopup({ seed: { settings: { 'advanced.lock': lock, 'focus.unlockFriction': 'none' } }, clock: true });
  await page.getByRole('button', { name: '25 min' }).click();
  await page.getByRole('button', { name: 'End early' }).waitFor();
  await page.getByRole('button', { name: 'End early' }).click();
  await page.locator('.unlock-inline .unlock-sentence').waitFor();
  assert.match(await lockBar(page).textContent(), /Ending a block early needs an unlock first/);
  assert.ok((await getStorage('state')).state.blocks.some((b) => b.reason === 'focus'));
  await page.screenshot({ path: join(SHOTS, 'popup-focus-locked-light.png') });
  await page.close();
});

test('popup: selects show short labels (no truncated "Show the home f…"), the full label is the tooltip', async () => {
  const page = await openPopup();
  const options = await page.locator('.row[data-id="yt.home.feedMode"] option').evaluateAll((os) => os.map((o) => ({ text: o.textContent, title: o.title })));
  assert.deepEqual(options.map((o) => o.text), ['Show feed', 'Calm page', 'Subscriptions', 'Watch later', 'Playlists', 'My own page']);
  assert.equal(options[0].title, 'Show the home feed');
  const fits = await page.locator('.row[data-id="yt.home.feedMode"] select').evaluate((s) => s.scrollWidth <= s.clientWidth + 1);
  assert.equal(fits, true);
  await page.close();
});

test('blocked page: "End early" says it is locked and offers the unlock; the background refuses too', async () => {
  const until = Date.now() + 20 * 60_000;
  const lock = { mode: 'friction', waitSeconds: 10 };
  const state = { blocks: [{ reason: 'focus', until, siteKeys: ['youtube'] }], block: { reason: 'focus', until, siteKeys: ['youtube'] }, sessions: {}, extraTime: {}, scheduleOverride: null };
  const page = await openPage(BLOCKED, { seed: { settings: { 'advanced.lock': lock, 'focus.unlockFriction': 'none' }, state }, hash: '#https://www.youtube.com/watch?v=x', width: 1000, height: 700 });
  await page.locator('.unlock').getByText(/settings are locked/).waitFor();
  assert.equal(await page.getByRole('button', { name: /End focus/ }).count(), 0, 'no way to end it while locked');
  const refused = await evalInExtension(() => chrome.runtime.sendMessage({ type: 'FOCUS_END', payload: { frictionDone: true } }));
  assert.deepEqual(refused, { ok: false, error: 'locked' });
  await page.screenshot({ path: join(SHOTS, 'blocked-locked-light.png') });
  await page.getByRole('button', { name: 'Unlock…' }).click();
  await dialog(page).locator('.unlock-sentence').waitFor();
  await dialog(page).getByRole('button', { name: 'Cancel' }).click();
  await page.close();
});

// ---------------------------------------------------------------------------------------------
// Follow-ups that landed with this phase
// ---------------------------------------------------------------------------------------------

test('requires "id=value": the home redirect row is only usable for "Go to my own page"', async () => {
  const page = await openOptions({ seed: { settings: { 'yt.home.feedMode': 'hide' } }, hash: '#setting=yt.home.redirectUrl' });
  const url = row(page, 'yt.home.redirectUrl');
  assert.equal(await url.evaluate((r) => r.classList.contains('is-disabled')), true, 'a calm empty page is not "my own page"');
  assert.match(await url.locator('.row-hint').textContent(), /Applies when “When I open YouTube” is set to “Go to my own page”\./);
  assert.equal(await url.locator('input[type="text"]').isDisabled(), true);
  await row(page, 'yt.home.feedMode').locator('select').selectOption('custom');
  await page.waitForFunction(() => !document.querySelector('.row[data-id="yt.home.redirectUrl"]').classList.contains('is-disabled'));
  assert.equal(await url.locator('input[type="text"]').isDisabled(), false);
  await row(page, 'yt.home.feedMode').locator('select').selectOption('subscriptions');
  await page.waitForFunction(() => document.querySelector('.row[data-id="yt.home.redirectUrl"]').classList.contains('is-disabled'));
  assert.deepEqual(page.errors, []);
  await page.close();
});

test('your week: "Clear usage history" asks, then forgets every day (and asks for the unlock while locked)', async () => {
  const today = new Date();
  const key = (back) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const stats = { [key(0)]: { youtube: { activeSec: 1500, opens: 4, turnedBack: 1, continued: 3, blockedHits: 0 } }, [key(40)]: { youtube: { activeSec: 60, opens: 1, turnedBack: 0, continued: 1, blockedHits: 0 } } };
  const page = await openOptions({ seed: { stats, settings: { 'advanced.lock': { mode: 'friction', waitSeconds: 10 } } }, hash: '#section=week' });
  const button = page.getByRole('button', { name: 'Clear usage history…' });
  await button.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(SHOTS, 'week-clear-light.png') });
  await button.click();
  await dialog(page).getByRole('button', { name: 'Cancel' }).click();
  assert.equal(Object.keys((await getStorage('stats')).stats).length, 2, 'cancel keeps everything');

  // locked: the unlock is asked for (the daily limit would restart from zero)
  await button.click();
  await dialog(page).getByRole('button', { name: 'Clear history' }).click();
  await dialog(page).locator('.unlock-sentence').waitFor();
  await dialog(page).getByRole('button', { name: 'Cancel' }).click();
  await dialog(page).waitFor({ state: 'detached' });
  assert.equal(Object.keys((await getStorage('stats')).stats).length, 2);

  // unlocked: it goes through
  await evalInExtension(() => chrome.runtime.sendMessage({ type: 'LOCK_UNLOCK', payload: { frictionDone: true } }));
  await button.click();
  await dialog(page).getByRole('button', { name: 'Clear history' }).click();
  await until(async () => Object.keys((await getStorage('stats')).stats ?? {}).length === 0);
  await page.getByText(/Nothing to show yet/).waitFor();
  assert.equal(await button.count(), 0, 'nothing left to clear');
  assert.deepEqual(page.errors, []);
  await page.close();
});

// ---------------------------------------------------------------------------------------------
// Dark screenshots
// ---------------------------------------------------------------------------------------------

test('screenshots in dark: setup, locked row, unlock dialogs, locked popup', async () => {
  const lock = await passwordLock();
  let page = await openOptions({ seed: { settings: { ...theme('dark'), [HIDE_ADS]: true } }, hash: '#section=advanced' });
  await row(page, 'advanced.lock').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(SHOTS, 'lock-setup-dark.png') });
  await page.close();

  await evalInExtension(() => chrome.storage.local.clear());
  page = await openOptions({ seed: { settings: { ...theme('dark'), 'advanced.lock': lock, [HIDE_ADS]: true } }, hash: '#section=advanced' });
  await page.screenshot({ path: join(SHOTS, 'lock-summary-dark.png') });
  await page.goto(`${extUrl(OPTIONS)}#setting=${HIDE_ADS}`);
  await page.waitForSelector('body[data-ready="true"]');
  await flip(page, HIDE_ADS);
  await row(page, HIDE_ADS).locator('.row-lock').waitFor();
  await page.screenshot({ path: join(SHOTS, 'options-locked-refused-dark.png') });
  await row(page, HIDE_ADS).getByRole('button', { name: 'Unlock…' }).click();
  await dialog(page).waitFor();
  await page.screenshot({ path: join(SHOTS, 'unlock-dialog-password-dark.png') });
  await page.close();

  const popup = await openPopup({ seed: { settings: { ...theme('dark'), 'advanced.lock': lock, [HIDE_ADS]: true } } });
  await lockBar(popup).waitFor();
  await popup.locator('#master input.switch').click();
  await popup.waitForFunction(() => /That would show something again/.test(document.querySelector('.lock-bar').textContent));
  await popup.screenshot({ path: join(SHOTS, 'popup-locked-refused-dark.png') });
  await lockBar(popup).getByRole('button', { name: 'Unlock…' }).click();
  await popup.locator('.unlock-inline').waitFor();
  await popup.screenshot({ path: join(SHOTS, 'popup-unlock-inline-dark.png') });
  await popup.close();
});
