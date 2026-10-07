// Accessibility of the extension's own pages (popup, options, welcome, pause, blocked), Chromium.
//
//   * axe-core (a devDependency, tests only) on each page and state, with the WCAG 2.x A/AA rules and its
//     best-practice rules. Colour contrast is NOT run here: it depends on the visual design, and the tokens'
//     contrast is checked as numbers in tests/unit/contrast.test.mjs.
//   * a keyboard-only walk: every stop of the Tab order has an accessible name, none uses a positive
//     tabindex, focus never falls back to <body> in the middle of a page, and Shift+Tab walks the same way back.
//   * prefers-reduced-motion: nothing keeps animating.
//
// Nothing here looks at pixels, so a new visual design does not break it; a real regression (a missing label,
// a control no keyboard can reach) does. youtube.com is stubbed (no traffic to Google).
/* global axe */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { launch, close, extUrl, trackErrors } from './harness.mjs';
import { send, resetStorage, configure, newTab, stubYouTube, waitPauseState } from './_mindful.mjs';

const AXE = readFileSync(createRequire(import.meta.url).resolve('axe-core/axe.min.js'), 'utf8');
const TARGET = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';

before(async () => {
  await launch();
  await stubYouTube();
  await resetStorage();
});
after(async () => {
  await close();
});

/** axe violations for the page as it is now (no colour contrast, see the header). */
async function violations(page) {
  await page.evaluate(AXE); // evaluated through the protocol: the extension pages' CSP does not apply
  const result = await page.evaluate(() =>
    axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice'] },
      // colour contrast and target size are about the visual design (see the header); their findings are reported by hand
      rules: { 'color-contrast': { enabled: false }, 'target-size': { enabled: false } },
    }),
  );
  return result.violations.map((v) => `${v.id} [${v.impact}]: ${v.help}: ${v.nodes.map((n) => n.target.join(' ')).slice(0, 4).join(' | ')}`);
}

/** Opens an extension page in a fresh tab, waits for `ready`, and returns the tab. */
async function openPage(path, ready = () => true) {
  const page = await newTab();
  await page.goto(extUrl(path));
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(ready, null, { timeout: 10_000 });
  await page.waitForTimeout(400); // rows and dialogs finish building
  return page;
}

const names = {
  popup: ['src/pages/popup/popup.html', () => document.querySelector('#content:not([aria-busy="true"])') !== null],
  options: ['src/pages/options/options.html', () => document.querySelectorAll('.row').length > 50],
  welcome: ['src/pages/welcome/welcome.html', () => document.querySelectorAll('.step').length === 3],
};

test('axe: popup, options (basic and advanced) and welcome have no violations', async () => {
  await resetStorage();
  for (const [label, [path, ready]] of Object.entries(names)) {
    const page = await openPage(path, ready);
    assert.deepEqual(await violations(page), [], `${label}`);
    if (label === 'options') {
      await page.locator('#show-advanced').evaluate((el) => el.click());
      await page.waitForTimeout(300);
      assert.deepEqual(await violations(page), [], 'options with "Show advanced"');
      await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
      assert.deepEqual(await violations(page), [], 'options in the dark theme');
    }
    await page.close();
  }
});

test('axe: the pause page while breathing and when it asks, and the blocked page', async () => {
  await resetStorage();
  await configure({ 'pause.enabled': true, 'pause.breathSeconds': 3 });
  const pause = await newTab();
  await pause.goto(`${extUrl('src/pages/pause/pause.html')}#${TARGET}`);
  await waitPauseState(pause, 'breathing');
  assert.deepEqual(await violations(pause), [], 'pause, breathing');
  await waitPauseState(pause, 'choosing');
  assert.deepEqual(await violations(pause), [], 'pause, choosing');
  await pause.close();

  assert.equal((await send('FOCUS_START', { minutes: 25 })).ok, true);
  const blocked = await newTab();
  await blocked.goto(`${extUrl('src/pages/blocked/blocked.html')}?reason=focus#${TARGET}`);
  await blocked.waitForFunction(() => document.body.dataset.state === 'blocked', null, { timeout: 10_000 });
  assert.deepEqual(await violations(blocked), [], 'blocked');
  await blocked.close();
  await send('FOCUS_END');
});

// ---------------------------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------------------------

/** Runs in the page: the accessible name of the focused element (a good-enough computation for our own markup), and its role. */
function focusedStop() {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const text = (node) => (node?.textContent ?? '').replace(/\s+/g, ' ').trim();
  const byIds = (ids) => ids.split(/\s+/).map((id) => text(document.getElementById(id))).filter(Boolean).join(' ');
  const labelled = el.getAttribute('aria-labelledby') ? byIds(el.getAttribute('aria-labelledby')) : '';
  const labels = el.labels ? [...el.labels].map(text).join(' ') : '';
  const name = el.getAttribute('aria-label') || labelled || labels || (el.matches('input[type="button"], input[type="submit"]') ? el.value : '') || text(el) || el.getAttribute('title') || '';
  return { tag: el.localName, role: el.getAttribute('role'), type: el.getAttribute('type'), name, tabindex: el.getAttribute('tabindex'), inDialog: Boolean(el.closest('dialog[open]')) };
}

/** Tabs through a page (up to `max` stops) and returns what had focus at each stop. */
async function tabThrough(page, max = 400) {
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    // Start from the top of the document: blur() alone keeps the "sequential focus starting point" at the old
    // element (the pause page focuses its main button when it opens), so the walk would begin after it.
    document.body.setAttribute('tabindex', '-1');
    document.body.focus();
    document.body.removeAttribute('tabindex');
  });
  const stops = [];
  for (let i = 0; i < max; i++) {
    await page.keyboard.press('Tab');
    const stop = await page.evaluate(focusedStop);
    if (stop === null) break; // focus left the page (the browser's own UI) or fell to <body>: the walk is over
    stops.push(stop);
  }
  return stops;
}

const PAGES = {
  popup: [names.popup[0], names.popup[1]],
  options: [names.options[0], names.options[1]],
  welcome: [names.welcome[0], names.welcome[1]],
};

for (const [label, [path, ready]] of Object.entries(PAGES)) {
  test(`keyboard: ${label}: every Tab stop has a name and a role it can be understood by; no positive tabindex; the way back mirrors the way there`, async () => {
    await resetStorage();
    const page = await openPage(path, ready);
    const stops = await tabThrough(page);
    assert.ok(stops.length >= 3, `${label} has several keyboard stops (${stops.length})`);
    const unnamed = stops.filter((s) => s.name === '');
    assert.deepEqual(unnamed, [], `${label}: every stop is named`);
    assert.deepEqual(stops.filter((s) => Number(s.tabindex) > 0), [], 'no positive tabindex');
    const interactive = stops.filter((s) => ['button', 'input', 'select', 'textarea', 'a', 'summary'].includes(s.tag) || s.role);
    assert.equal(interactive.length, stops.length, 'only interactive things take focus');

    // The walk ended when focus left the page, so one Shift+Tab comes back to the last stop; then the same stops in reverse.
    await page.keyboard.press('Shift+Tab');
    assert.equal((await page.evaluate(focusedStop))?.name, stops.at(-1).name, 'Shift+Tab re-enters the page at its last stop');
    const back = [];
    for (let i = 0; i < stops.length - 1; i++) {
      await page.keyboard.press('Shift+Tab');
      back.push(await page.evaluate(focusedStop));
    }
    assert.deepEqual(back.map((s) => s?.name), stops.slice(0, -1).reverse().map((s) => s.name), 'Shift+Tab walks the same stops backwards');
    await page.close();
  });
}

test('keyboard: the pause page can be finished with the keyboard alone (the choice buttons are reachable and named)', async () => {
  await resetStorage();
  await configure({ 'pause.enabled': true, 'pause.breathSeconds': 3 });
  const page = await newTab();
  await page.goto(`${extUrl('src/pages/pause/pause.html')}#${TARGET}`);
  await waitPauseState(page, 'choosing');
  const stops = await tabThrough(page, 12);
  assert.ok(stops.length >= 2, 'the choice has at least two stops');
  assert.deepEqual(stops.filter((s) => s.name === ''), [], 'every stop is named');
  assert.ok(stops.some((s) => /^Close /.test(s.name)), `a "Close …" button is reachable: ${stops.map((s) => s.name).join(' | ')}`);
  assert.ok(stops.some((s) => /Continue/.test(s.name)), 'a "Continue…" control is reachable');
  await page.close();
});

test('keyboard: the options page opens a dialog with focus inside it, keeps Tab inside, and Escape gives focus back', async () => {
  await resetStorage();
  const page = await openPage(...names.options);
  const opener = page.getByRole('button', { name: /preset/i }).first();
  assert.ok((await opener.count()) > 0, 'there is a presets button');
  await opener.focus();
  await page.keyboard.press('Enter');
  await page.waitForSelector('dialog[open]', { timeout: 5000 });
  assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('dialog[open]'))), true, 'focus moved into the dialog');
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    // A modal dialog makes the page behind it inert: focus is inside the dialog, or on nothing (the browser's own UI).
    const where = await page.evaluate(() => (document.activeElement === document.body ? 'nothing' : document.activeElement?.closest('dialog[open]') ? 'dialog' : `outside: ${document.activeElement?.localName}`));
    assert.ok(where === 'dialog' || where === 'nothing', `Tab ${i + 1}: focus is ${where}`);
  }
  assert.equal(await page.evaluate(() => document.querySelector('dialog[open]') !== null), true, 'the dialog is still open');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('dialog[open]') === null, null, { timeout: 5000 });
  assert.equal(await opener.evaluate((el) => el === document.activeElement), true, 'focus went back to the button that opened it');
  await page.close();
});

// ---------------------------------------------------------------------------------------------
// Motion
// ---------------------------------------------------------------------------------------------

test('prefers-reduced-motion: nothing keeps animating on the pause page, the blocked page or the options page', async () => {
  await resetStorage();
  await configure({ 'pause.enabled': true, 'pause.breathSeconds': 3 });
  const running = (page) => page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && (a.effect?.getComputedTiming().iterations ?? 1) > 1).map((a) => a.animationName ?? a.transitionProperty ?? 'animation'));

  const pause = await newTab();
  await pause.emulateMedia({ reducedMotion: 'no-preference' });
  await pause.goto(`${extUrl('src/pages/pause/pause.html')}#${TARGET}`);
  await waitPauseState(pause, 'breathing');
  await pause.waitForTimeout(300);
  const withMotion = await running(pause);
  await pause.emulateMedia({ reducedMotion: 'reduce' });
  await pause.waitForTimeout(300);
  assert.deepEqual(await running(pause), [], `with reduced motion no repeating animation runs (with motion: ${withMotion.length} did)`);
  await pause.close();

  assert.equal((await send('FOCUS_START', { minutes: 25 })).ok, true);
  const blocked = await newTab();
  await blocked.emulateMedia({ reducedMotion: 'reduce' });
  await blocked.goto(`${extUrl('src/pages/blocked/blocked.html')}?reason=focus#${TARGET}`);
  await blocked.waitForFunction(() => document.body.dataset.state === 'blocked', null, { timeout: 10_000 });
  assert.deepEqual(await running(blocked), []);
  await blocked.close();
  await send('FOCUS_END');

  const options = await newTab();
  await options.emulateMedia({ reducedMotion: 'reduce' });
  await options.goto(extUrl(names.options[0]));
  await options.waitForFunction(names.options[1], null, { timeout: 10_000 });
  assert.deepEqual(await running(options), []);
  await options.close();
});

test('no errors from our code on any of the pages above', async () => {
  const page = trackErrors(await newTab());
  for (const [path] of Object.values(names)) await page.goto(extUrl(path));
  assert.deepEqual(page.errors, []);
  await page.close();
});
