// Phase 4a, Chromium: the element picker and the custom-rules editor, end to end.
//
// YouTube is OFFLINE here: pages are rebuilt from the Phase 1 research snapshots
// (tests/e2e/artifacts/research/*.dom.json, local only) and served by context.route at
// https://www.youtube.com/..., so the real content scripts inject exactly as on the live site while
// nothing goes to Google (whose captcha rate-limits this machine). Without the snapshots (fresh
// clone) every test here is skipped, not failed. See _yt-fixture.mjs for what the pages look like.
//
// The picker's panel is in a closed shadow root: _picker.mjs reads and clicks it through the Chrome
// DevTools Protocol, with real mouse events.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { launch, close, getContext, openExtPage, evalInExtension, setStorage } from './harness.mjs';
import { ARTIFACTS } from './harness.mjs';
import { send, resetStorage, newTab, ourErrors } from './_mindful.mjs';
import { fixturesAvailable, installYouTubeFixtures } from './_yt-fixture.mjs';
import {
  startPicker, phase, waitPhase, readPanel, clickInPanel, clickOnlyThisOne, windowListenerCount, waitEngine, allHidden, noneHidden, storedRules, displays,
} from './_picker.mjs';

const SHOTS = join(ARTIFACTS, 'picker');
const WATCH = 'https://www.youtube.com/watch?v=abc';
const SEARCH = 'https://www.youtube.com/results?search_query=lofi';
const PLAYLIST = 'https://www.youtube.com/playlist?list=PL1';
const CHANNEL = 'https://www.youtube.com/@x/videos';
const HAVE = fixturesAvailable();
const skip = HAVE ? false : 'research snapshots are absent (tests/e2e/artifacts/research is local only)';

before(async () => {
  if (!HAVE) return;
  await launch();
  await installYouTubeFixtures(getContext());
  await mkdir(SHOTS, { recursive: true });
});
after(async () => {
  if (HAVE) await close();
});
beforeEach(async () => {
  if (HAVE) await resetStorage();
});

// ---------------------------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------------------------

async function open(url) {
  const page = await newTab();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await waitEngine(page);
  return page;
}

const shot = (page, name) => page.screenshot({ path: join(SHOTS, `${name}.png`) });

async function until(fn, what, timeout = 6000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  throw new Error(`timed out waiting for ${what}`);
}

/** The middle of an element's box, in viewport coordinates. */
async function centerOf(page, selector, nth = 0) {
  const box = await page.locator(selector).nth(nth).boundingBox();
  assert.ok(box, `${selector} has a box`);
  return { x: box.x + box.width / 2, y: box.y + box.height / 2, box };
}

/** Starts the picker and clicks the thumbnail of the first related card. */
async function pickFirstRelatedThumbnail(page) {
  assert.deepEqual(await startPicker(page), { ok: true });
  await waitPhase(page, 'pick');
  const { x, y } = await centerOf(page, '#related yt-lockup-view-model yt-thumbnail-view-model');
  await page.mouse.move(x, y);
  await until(async () => (await readPanel(page))?.target, 'the hover box');
  await page.mouse.click(x, y);
  await waitPhase(page, 'review');
  return readPanel(page);
}

/** Presses ArrowUp until the selector is `wanted`; returns the panel then. */
async function growTo(page, wanted) {
  for (let i = 0; i < 8; i++) {
    const panel = await readPanel(page);
    if (panel.selector === wanted) return panel;
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(80);
  }
  throw new Error(`never reached ${wanted}; at ${(await readPanel(page)).selector}`);
}

// ---------------------------------------------------------------------------------------------
// starting, blocking, leaving
// ---------------------------------------------------------------------------------------------

test('START_PICKER starts it; Esc leaves without a trace (no host, no style, no listeners left)', { skip }, async () => {
  const page = await open(WATCH);
  const before = await page.evaluate(() => ({ attrs: [...document.documentElement.attributes].map((a) => `${a.name}=${a.value}`).sort(), kids: document.documentElement.children.length }));
  const listenersBefore = await windowListenerCount(page);

  assert.deepEqual(await startPicker(page), { ok: true });
  await waitPhase(page, 'pick');
  assert.equal(await page.locator('style[data-at-peace-picker-style]').count(), 1, 'crosshair style while picking');
  assert.ok((await windowListenerCount(page)) > listenersBefore, 'listeners are on while picking');
  const panel = await readPanel(page);
  assert.match(panel.text, /Point at something and click it/);
  assert.deepEqual(panel.buttons.map((b) => b.label), ['Cancel']);
  assert.equal(await startPicker(page).then((r) => r.already), true, 'starting twice changes nothing');

  await page.keyboard.press('Escape');
  await until(async () => (await phase(page)) === null, 'the host to go');
  assert.equal(await page.locator('[data-at-peace-picker]').count(), 0);
  assert.equal(await page.locator('style[data-at-peace-picker-style]').count(), 0);
  assert.equal(await windowListenerCount(page), listenersBefore, 'every listener is removed');
  const after = await page.evaluate(() => ({ attrs: [...document.documentElement.attributes].map((a) => `${a.name}=${a.value}`).sort(), kids: document.documentElement.children.length }));
  assert.deepEqual(after, before, '<html> is exactly as it was');
  assert.deepEqual(await storedRules(), []);
  assert.deepEqual(ourErrors(page), []);
  await page.close();
});

test("while picking YouTube's own hover/click/key handling is off, and it comes back afterwards", { skip }, async () => {
  const page = await open(WATCH);
  await page.evaluate(() => {
    window.__seen = [];
    for (const type of ['click', 'mousedown', 'mouseup', 'mouseover', 'pointerdown', 'keydown']) document.addEventListener(type, () => window.__seen.push(type), true);
    window.__linkHits = 0;
    document.querySelector('#related a').addEventListener('click', (e) => { e.preventDefault(); window.__linkHits++; });
  });
  await startPicker(page);
  await waitPhase(page, 'pick');
  const { x, y } = await centerOf(page, '#related yt-lockup-view-model yt-thumbnail-view-model');
  await page.mouse.move(x - 5, y - 5);
  await page.mouse.move(x, y);
  await page.keyboard.press('k'); // YouTube's play/pause shortcut
  await page.mouse.click(x, y); // would follow the video link
  await waitPhase(page, 'review');
  assert.deepEqual(await page.evaluate(() => window.__seen), [], 'nothing reached the page');
  assert.equal(await page.evaluate(() => window.__linkHits), 0);
  await page.keyboard.press('Escape');
  await until(async () => (await phase(page)) === null, 'the host to go');

  await page.mouse.move(300, 300);
  await page.mouse.move(x, y);
  await page.mouse.click(x, y);
  const seen = await page.evaluate(() => window.__seen);
  assert.ok(seen.includes('mouseover') && seen.includes('click') && seen.includes('mousedown'), `the page sees events again: ${seen}`);
  assert.equal(await page.evaluate(() => window.__linkHits), 1);
  await page.close();
});

test('hover: a box follows the pointer; the panel says what to do; Cancel works with the mouse', { skip }, async () => {
  const page = await open(WATCH);
  await startPicker(page);
  await waitPhase(page, 'pick');
  const { x, y, box } = await centerOf(page, '#related yt-lockup-view-model yt-thumbnail-view-model');
  await page.mouse.move(x, y);
  const info = await until(async () => {
    const p = await readPanel(page);
    return p?.target ? p : null;
  }, 'the hover box');
  // The box hugs something under the pointer (here: the thumbnail), is not "refused", and is inside its card.
  assert.equal(info.target.refused, false);
  assert.ok(info.target.x <= x && x <= info.target.x + info.target.width && info.target.y <= y && y <= info.target.y + info.target.height, 'box contains the pointer');
  assert.ok(info.target.width <= box.width + 2, 'and is no bigger than the thumbnail');
  await shot(page, 'picker-hover');
  // Moving away from anything pickable (the panel itself) keeps the picker calm.
  await clickInPanel(page, 'Cancel');
  await until(async () => (await phase(page)) === null, 'the host to go');
  assert.deepEqual(await storedRules(), []);
  await page.close();
});

// ---------------------------------------------------------------------------------------------
// the main flow
// ---------------------------------------------------------------------------------------------

test('pick a card on a watch page, Bigger/Smaller, Hide: rule stored, hidden at once, still hidden after reload', { skip }, async () => {
  const page = await open(WATCH);
  const first = await pickFirstRelatedThumbnail(page);
  // The first choice is the smallest thing with a steady name: the thumbnail image box. 26 of them in this list.
  assert.match(first.selector, /^\.ytThumbnailViewModelImage$|^yt-thumbnail-view-model/);
  assert.match(first.count, /^\d+ similar items on this page$/);
  assert.equal(first.buttons.find((b) => b.label === 'Smaller').disabled, true, 'nothing smaller than the first choice');
  assert.equal(first.buttons.find((b) => b.label === 'Bigger').disabled, false);
  assert.deepEqual(first.radios.map((r) => [r.label, r.checked]), [['This kind of page (watch)', true], ['Everywhere', false]]);
  assert.ok(first.similarBoxes > 3, 'the other matches are outlined too');
  await shot(page, 'picker-review-small');

  // Bigger (button) → the thumbnail's wrapper, then the card.
  await clickInPanel(page, 'Bigger');
  await until(async () => (await readPanel(page)).selector !== first.selector, 'the choice to change');
  const card = await growTo(page, 'yt-lockup-view-model');
  assert.equal(card.buttons.find((b) => b.label === 'Smaller').disabled, false);
  // Smaller (arrow down) and back up again.
  await page.keyboard.press('ArrowDown');
  await until(async () => (await readPanel(page)).selector !== 'yt-lockup-view-model', 'Smaller');
  await page.keyboard.press('ArrowUp');
  await until(async () => (await readPanel(page)).selector === 'yt-lockup-view-model', 'Bigger again');
  const panel = await readPanel(page);
  assert.match(panel.count, /^26 similar items on this page$/);
  assert.equal(panel.target.refused, false);
  await shot(page, 'picker-review-card');

  // Hide with Enter.
  await page.keyboard.press('Enter');
  await waitPhase(page, 'done');
  const rules = await until(async () => {
    const r = await storedRules();
    return r.length ? r : null;
  }, 'the rule in storage');
  assert.equal(rules.length, 1);
  const [rule] = rules;
  assert.match(rule.id, /^rule_[0-9a-f]{12}$/);
  assert.equal(rule.selector, 'yt-lockup-view-model');
  assert.equal(rule.page, 'watch');
  assert.equal(rule.note, 'Hid yt-lockup-view-model on watch pages');
  assert.equal(typeof rule.createdAt, 'number');
  assert.ok(Math.abs(Date.now() - rule.createdAt) < 30_000);

  // Hidden immediately (the engine's dynamic stylesheet), all 26 of them.
  await until(() => allHidden(page, 'yt-lockup-view-model'), 'the cards to disappear');
  assert.equal((await displays(page, 'yt-lockup-view-model')).length, 26);
  const done = await readPanel(page);
  assert.match(done.text, /Hidden: 26 items on watch pages/);
  assert.ok(done.buttons.some((b) => b.label === 'Undo'));
  await shot(page, 'picker-done');

  // The panel leaves by itself after ~6 s and takes everything with it.
  await until(async () => (await phase(page)) === null, 'the panel to leave on its own', 9000);
  assert.equal(await page.locator('style[data-at-peace-picker-style]').count(), 0);
  assert.equal(await allHidden(page, 'yt-lockup-view-model'), true, 'still hidden after the panel is gone');

  // And after a reload.
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitEngine(page);
  await until(() => allHidden(page, 'yt-lockup-view-model'), 'hidden after reload');
  assert.deepEqual(ourErrors(page), []);
  await page.close();
});

test('Undo (button) brings it back and removes the rule; the panel then leaves', { skip }, async () => {
  const page = await open(WATCH);
  await pickFirstRelatedThumbnail(page);
  await growTo(page, 'yt-lockup-view-model');
  await clickInPanel(page, 'Hide');
  await waitPhase(page, 'done');
  await until(() => allHidden(page, 'yt-lockup-view-model'), 'hidden');
  await clickInPanel(page, 'Undo');
  await until(async () => (await storedRules()).length === 0, 'the rule to be removed');
  await until(() => noneHidden(page, 'yt-lockup-view-model'), 'the cards to come back');
  assert.match((await readPanel(page)).text, /Brought back/);
  await until(async () => (await phase(page)) === null, 'the panel to leave', 5000);
  await page.close();
});

test('Ctrl+Z is Undo while the confirmation is up; the page is usable meanwhile', { skip }, async () => {
  const page = await open(WATCH);
  await pickFirstRelatedThumbnail(page);
  await growTo(page, 'yt-lockup-view-model');
  await page.keyboard.press('Enter');
  await waitPhase(page, 'done');
  await until(() => allHidden(page, 'yt-lockup-view-model'), 'hidden');
  // The page is the person's again: its own handlers work during the 6 seconds.
  await page.evaluate(() => {
    window.__clicks = 0;
    document.addEventListener('click', () => window.__clicks++, true);
  });
  await page.mouse.click(5, 400);
  assert.equal(await page.evaluate(() => window.__clicks), 1);
  await page.keyboard.press('Control+z');
  await until(async () => (await storedRules()).length === 0, 'the rule to be removed');
  await until(() => noneHidden(page, 'yt-lockup-view-model'), 'the cards to come back');
  await page.close();
});

test('scope: "This kind of page" does not apply on other page types; "Everywhere" does', { skip }, async () => {
  // This kind of page (watch): the playlist page has yt-lockup-view-model too, and keeps them.
  const page = await open(WATCH);
  await pickFirstRelatedThumbnail(page);
  await growTo(page, 'yt-lockup-view-model');
  await page.keyboard.press('Enter');
  await waitPhase(page, 'done');
  const [watchRule] = await until(async () => {
    const r = await storedRules();
    return r.length ? r : null;
  }, 'the rule');
  assert.equal(watchRule.page, 'watch');
  await until(() => allHidden(page, 'yt-lockup-view-model'), 'hidden on the watch page');
  await page.goto(PLAYLIST, { waitUntil: 'domcontentloaded' });
  await waitEngine(page);
  assert.ok((await displays(page, 'yt-lockup-view-model')).length > 10, 'the playlist page has lockups');
  assert.equal(await noneHidden(page, 'yt-lockup-view-model'), true, 'the watch-page rule leaves them alone');

  // Everywhere: replace the rule with a global one made through the panel.
  await setStorage({ settings: {} });
  await page.goto(WATCH, { waitUntil: 'domcontentloaded' });
  await waitEngine(page);
  await pickFirstRelatedThumbnail(page);
  await growTo(page, 'yt-lockup-view-model');
  await clickInPanel(page, 'Everywhere');
  await until(async () => (await readPanel(page)).radios.find((r) => r.label === 'Everywhere').checked, 'the radio');
  await page.keyboard.press('Enter');
  await waitPhase(page, 'done');
  const [globalRule] = await until(async () => {
    const r = await storedRules();
    return r.length ? r : null;
  }, 'the global rule');
  assert.equal(globalRule.page, null);
  assert.equal(globalRule.note, 'Hid yt-lockup-view-model');
  await page.goto(PLAYLIST, { waitUntil: 'domcontentloaded' });
  await waitEngine(page);
  await until(() => allHidden(page, 'yt-lockup-view-model'), 'hidden everywhere');
  await page.close();
});

test('on a search page: pick a result, the selector is the component, the count is what is on screen', { skip }, async () => {
  const page = await open(SEARCH);
  await startPicker(page);
  await waitPhase(page, 'pick');
  // A result that is not inside a shelf, then its title text.
  const target = await page.evaluate(() => {
    const card = [...document.querySelectorAll('ytd-video-renderer')].find((c) => !c.closest('ytd-shelf-renderer'));
    card.scrollIntoView({ block: 'center' });
    const r = card.querySelector('#video-title').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  });
  await page.mouse.move(target.x, target.y);
  await until(async () => (await readPanel(page))?.target, 'the hover box');
  await page.mouse.click(target.x, target.y);
  await waitPhase(page, 'review');
  const card = await growTo(page, 'ytd-video-renderer');
  assert.match(card.count, /^\d+ similar items on this page$/);
  await shot(page, 'picker-search-result');
  await page.keyboard.press('Enter');
  await waitPhase(page, 'done');
  await until(async () => (await storedRules()).length === 1, 'the rule');
  const [rule] = await storedRules();
  assert.equal(rule.selector, 'ytd-video-renderer');
  assert.equal(rule.page, 'search');
  assert.equal(rule.note, 'Hid ytd-video-renderer on search pages');
  await until(() => allHidden(page, 'ytd-video-renderer'), 'results hidden');
  await page.close();
});

test('the same on a channel page (view-model cards)', { skip }, async () => {
  const page = await open(CHANNEL);
  await startPicker(page);
  await waitPhase(page, 'pick');
  const { x, y } = await centerOf(page, 'ytd-rich-item-renderer yt-thumbnail-view-model');
  await page.mouse.move(x, y);
  await until(async () => (await readPanel(page))?.target, 'the hover box');
  await page.mouse.click(x, y);
  await waitPhase(page, 'review');
  const card = await growTo(page, 'yt-lockup-view-model');
  assert.match(card.count, /^30 similar items on this page$/);
  await page.keyboard.press('Enter');
  await waitPhase(page, 'done');
  await until(() => allHidden(page, 'yt-lockup-view-model'), 'hidden');
  const [rule] = await storedRules();
  assert.equal(rule.page, 'channel');
  await page.close();
});

// ---------------------------------------------------------------------------------------------
// refusals and limits
// ---------------------------------------------------------------------------------------------

test('the page frame is refused with a calm sentence, and Hide stays off', { skip }, async () => {
  const page = await open(WATCH);
  await startPicker(page);
  await waitPhase(page, 'pick');
  await page.mouse.click(5, 400); // the left gutter: nothing but the page itself
  await waitPhase(page, 'review');
  const panel = await readPanel(page);
  assert.match(panel.text, /page itself/);
  assert.equal(panel.selector, null);
  assert.equal(panel.buttons.find((b) => b.label === 'Hide').disabled, true);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  assert.equal(await phase(page), 'review', 'Enter does nothing');
  assert.deepEqual(await storedRules(), []);
  await page.keyboard.press('Escape');
  await page.close();
});

test('Bigger stops before most of the page, says why, and Hide cannot be used on a too-big choice', { skip }, async () => {
  const page = await open(WATCH);
  await pickFirstRelatedThumbnail(page);
  // Walk up as far as it goes.
  for (let i = 0; i < 10; i++) await page.keyboard.press('ArrowUp');
  await page.waitForTimeout(200);
  const top = await readPanel(page);
  assert.ok(top.selector, 'still on a valid choice');
  assert.notEqual(top.selector, 'ytd-watch-flexy', 'never the whole watch page');
  assert.equal(top.buttons.find((b) => b.label === 'Bigger').disabled, true);
  assert.match(top.text, /as big as it goes/);
  await shot(page, 'picker-biggest-allowed');
  // Whatever it settled on is within the 60% rule.
  const share = await page.evaluate((sel) => {
    const out = [];
    for (const el of document.querySelectorAll(sel)) {
      const r = el.getBoundingClientRect();
      out.push((Math.min(1, r.width / innerWidth)) * (Math.min(1, r.height / innerHeight)));
    }
    return Math.max(...out);
  }, top.selector);
  assert.ok(share <= 0.6, `share ${share}`);
  await page.keyboard.press('Escape');
  await page.close();
});

test('"Only this one": a position-based rule for one of several alike, with an honest warning', { skip }, async () => {
  const page = await open(WATCH);
  await pickFirstRelatedThumbnail(page);
  await growTo(page, 'yt-lockup-view-model');
  await clickOnlyThisOne(page);
  await until(async () => (await readPanel(page)).count === 'Just this one.', 'unique mode');
  const panel = await readPanel(page);
  assert.match(panel.selector, /:nth-child\(\d+\)$/);
  assert.ok(panel.notes.some((n) => /position/.test(n)));
  await page.keyboard.press('Enter');
  await waitPhase(page, 'done');
  await until(async () => (await storedRules()).length === 1, 'the rule');
  const hidden = await page.evaluate(() => [...document.querySelectorAll('yt-lockup-view-model')].map((e) => getComputedStyle(e).display === 'none'));
  assert.equal(hidden.filter(Boolean).length, 1, 'exactly one card is gone');
  assert.equal(hidden.length, 26);
  await page.close();
});

test('at the 500-rule limit it says so and saves nothing', { skip }, async () => {
  const rules = Array.from({ length: 500 }, (_, i) => ({ id: `r${i}`, selector: `ytd-nothing-${i}`, page: null, note: '', createdAt: 1 }));
  await setStorage({ settings: { 'advanced.customRules': rules } });
  const page = await open(WATCH);
  await pickFirstRelatedThumbnail(page);
  await growTo(page, 'yt-lockup-view-model');
  await page.keyboard.press('Enter');
  await until(async () => /already hide 500/.test((await readPanel(page))?.text ?? ''), 'the limit message');
  assert.equal(await phase(page), 'review');
  assert.equal((await storedRules()).length, 500);
  await page.keyboard.press('Escape');
  await page.close();
});

test('picking the same thing twice does not stack rules', { skip }, async () => {
  await setStorage({ settings: { 'advanced.customRules': [{ id: 'rule_aaaaaaaaaaaa', selector: 'ytd-merch-shelf-renderer', page: 'watch', note: 'x', createdAt: 1 }] } });
  const page = await open(WATCH);
  // Make the page have such a shelf, visible, and pick it: it is hidden by the rule, so pick a lookalike through a second rule target instead.
  await pickFirstRelatedThumbnail(page);
  await growTo(page, 'yt-lockup-view-model');
  await page.keyboard.press('Enter');
  await waitPhase(page, 'done');
  await until(async () => (await storedRules()).length === 2, 'the second rule');
  assert.deepEqual((await storedRules()).map((r) => r.selector), ['ytd-merch-shelf-renderer', 'yt-lockup-view-model']);
  await page.close();
});

// ---------------------------------------------------------------------------------------------
// entry points
// ---------------------------------------------------------------------------------------------

test('the background forwards START_PICKER (popup button / Alt+Shift+H) to the active tab', { skip }, async () => {
  const page = await open(WATCH);
  await page.bringToFront();
  const reply = await send('START_PICKER');
  assert.equal(reply.ok, true, JSON.stringify(reply));
  await waitPhase(page, 'pick');
  await page.keyboard.press('Escape');
  await until(async () => (await phase(page)) === null, 'the host to go');
  await page.close();
});

test('the panel follows the theme setting', { skip }, async () => {
  await setStorage({ settings: { 'general.theme': 'dark' } });
  const page = await open(WATCH);
  await startPicker(page);
  await waitPhase(page, 'pick');
  await until(async () => (await readPanel(page)).theme === 'dark', 'the dark theme');
  await shot(page, 'picker-dark');
  await page.keyboard.press('Escape');
  await page.close();
});

// ---------------------------------------------------------------------------------------------
// the editor in Settings (src/pages/options/renderers/custom-rules.js)
// ---------------------------------------------------------------------------------------------

const RULES = [
  { id: 'rule_aaaaaaaaaaaa', selector: 'ytd-merch-shelf-renderer', page: 'watch', note: 'Hid ytd-merch-shelf-renderer on watch pages', createdAt: 1_700_000_000_000 },
  { id: 'rule_bbbbbbbbbbbb', selector: '#related yt-lockup-view-model', page: null, note: 'Hid the related cards', createdAt: 1_700_000_100_000 },
];

async function openRules() {
  const page = await openExtPage('src/pages/options/options.html#advanced');
  await page.setViewportSize({ width: 1180, height: 900 });
  await page.waitForSelector('.custom-rules', { timeout: 10_000 });
  return page;
}

test('settings: empty state explains the picker; manual form is there', { skip }, async () => {
  const page = await openRules();
  const text = await page.locator('.custom-rules').textContent();
  assert.match(text, /Hide an element/);
  assert.match(text, /Alt\+Shift\+H/);
  assert.equal(await page.locator('.custom-rules .rule').count(), 0);
  assert.equal(await page.locator('.custom-rules details.adder, .custom-rules .adder').count() > 0, true);
  await page.locator('.custom-rules').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(SHOTS, 'options-rules-empty.png') });
  assert.deepEqual(ourErrors(page), []);
  await page.close();
});

test('settings: rules are listed, the note is editable, scope is changeable, delete has Undo', { skip }, async () => {
  await setStorage({ settings: { 'advanced.customRules': RULES } });
  const page = await openRules();
  const rows = page.locator('.custom-rules .rule');
  assert.equal(await rows.count(), 2);
  assert.equal(await rows.nth(0).locator('.rule-selector').textContent(), 'ytd-merch-shelf-renderer');
  assert.equal(await rows.nth(0).locator('select').inputValue(), 'watch');
  assert.equal(await rows.nth(1).locator('select').inputValue(), '');
  assert.equal(await rows.nth(1).locator('input.rule-note').inputValue(), 'Hid the related cards');
  await page.locator('.custom-rules').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(SHOTS, 'options-rules.png') });

  // Edit the note: saved when you leave the field.
  const note = rows.nth(1).locator('input.rule-note');
  await note.fill('The cards I never click');
  await note.blur();
  await until(async () => (await storedRules())[1].note === 'The cards I never click', 'the note to be saved');
  // Change the scope.
  await rows.nth(1).locator('select').selectOption('watch');
  await until(async () => (await storedRules())[1].page === 'watch', 'the scope to be saved');
  await rows.nth(1).locator('select').selectOption('');
  await until(async () => (await storedRules())[1].page === null, 'back to everywhere');

  // Delete → gone, with an Undo that puts it back in the same place.
  await rows.nth(0).locator('button.rule-delete').click();
  await until(async () => (await storedRules()).length === 1, 'the delete');
  assert.equal(await page.locator('.custom-rules .rule').count(), 1);
  await page.locator('.custom-rules .undo button').click();
  await until(async () => (await storedRules()).length === 2, 'the undo');
  assert.deepEqual((await storedRules()).map((r) => r.id), ['rule_aaaaaaaaaaaa', 'rule_bbbbbbbbbbbb']);
  assert.equal(await page.locator('.custom-rules .rule').count(), 2);
  assert.deepEqual(ourErrors(page), []);
  await page.close();
});

test('settings: a rule made by the picker shows up in the editor, live', { skip }, async () => {
  const options = await openRules();
  const yt = await open(WATCH);
  await pickFirstRelatedThumbnail(yt);
  await growTo(yt, 'yt-lockup-view-model');
  await yt.keyboard.press('Enter');
  await waitPhase(yt, 'done');
  await until(async () => (await options.locator('.custom-rules .rule').count()) === 1, 'the rule to appear in Settings');
  assert.equal(await options.locator('.custom-rules .rule-selector').first().textContent(), 'yt-lockup-view-model');
  assert.equal(await options.locator('.custom-rules input.rule-note').first().inputValue(), 'Hid yt-lockup-view-model on watch pages');
  await yt.close();
  await options.close();
});

test('settings: adding a selector by hand is checked (one valid selector, same safety rules)', { skip }, async () => {
  const page = await openRules();
  const adder = page.locator('.custom-rules .adder');
  if (await page.locator('.custom-rules details.adder:not([open])').count()) await page.locator('.custom-rules details.adder summary').click();
  const input = adder.locator('input.adder-selector');
  const add = adder.locator('button.adder-add');
  const error = page.locator('.custom-rules .field-error');

  for (const [typed, message] of [
    ['', /Type a selector/],
    ['ytd-foo, ytd-bar', /one selector/i],
    ['div[', /not a valid selector/i],
    ['ytd-foo { display: none }', /not a valid selector|unsafe|one selector/i],
    ['body', /page itself/],
    ['ytd-app', /page itself/],
    ['#content', /page itself/],
    ['div', /too much/],
    ['*', /too much/],
  ]) {
    await input.fill(typed);
    await add.click();
    await page.waitForFunction(() => !document.querySelector('.custom-rules .field-error')?.hidden, null, { timeout: 3000 });
    assert.match(await error.textContent(), message, typed);
    assert.deepEqual(await storedRules(), [], `${typed} stored nothing`);
  }

  await input.fill('  ytd-merch-shelf-renderer ');
  await adder.locator('select').selectOption('watch');
  await adder.locator('input.adder-note').fill('Merch shelf');
  await add.click();
  await until(async () => (await storedRules()).length === 1, 'the manual rule');
  const [rule] = await storedRules();
  assert.equal(rule.selector, 'ytd-merch-shelf-renderer');
  assert.equal(rule.page, 'watch');
  assert.equal(rule.note, 'Merch shelf');
  assert.match(rule.id, /^rule_[0-9a-f]{12}$/);
  assert.equal(await input.inputValue(), '', 'the form clears');
  assert.equal(await page.locator('.custom-rules .rule').count(), 1);
  // The same one again is refused, not duplicated.
  await input.fill('ytd-merch-shelf-renderer');
  await adder.locator('select').selectOption('watch');
  await add.click();
  await page.waitForFunction(() => /already/i.test(document.querySelector('.custom-rules .field-error')?.textContent ?? ''), null, { timeout: 3000 });
  assert.equal((await storedRules()).length, 1);
  assert.deepEqual(ourErrors(page), []);
  await page.close();
});

test('settings: an old rule list with a broken entry still renders (the editor never throws)', { skip }, async () => {
  await evalInExtension(() => chrome.storage.local.set({ settings: { 'advanced.customRules': [{ id: 'ok_1', selector: 'ytd-x-y', page: null, note: 'fine', createdAt: 5 }, 42, { id: '', selector: '' }] } }));
  const page = await openRules();
  assert.equal(await page.locator('.custom-rules .rule').count(), 1);
  assert.deepEqual(ourErrors(page), []);
  await page.close();
});
