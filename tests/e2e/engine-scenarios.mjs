// The engine scenarios, written once and run in BOTH browsers: tests/e2e/engine.spec.mjs
// (Chromium via Playwright) and tests/firefox/engine.mjs (real Firefox via Selenium). Each
// browser supplies an adapter `b`:
//
//   b.goto(url)                  navigate and wait for DOMContentLoaded; throws { code: 'YT_SORRY' } on Google's captcha
//   b.evaluate(fn, arg)          run a self-contained function in the page (main world), JSON result
//   b.setStorage(obj)            storage.local.set through an extension page
//   b.search(text)               type into YouTube's search box and press Enter (SPA navigation)
//   b.clickFirstResult()         click the first video in the search results (SPA navigation)
//   b.back()                     history back
//   b.ourErrors()                errors raised by OUR code so far (strings)
//   b.name                       'chromium' | 'firefox'
//
// The page is live YouTube, logged out: the home feed is empty (just a "try searching" nudge),
// which is fine; the engine does not care what is on the page, only which page it is.
import assert from 'node:assert/strict';
import { engineState, elementInfo, setReloadMarker, getReloadMarker, startRecording, stopRecording } from './_page-fns.mjs';
import { until } from '../helpers/wait.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const HOME = 'https://www.youtube.com/';
const SEARCH = 'https://www.youtube.com/results?search_query=lofi';

export function waitFor(b, fn, arg, { timeout = 20_000, interval = 100, what = 'condition' } = {}) {
  return until(() => b.evaluate(fn, arg), { timeout, interval, what });
}

const state = (b) => b.evaluate(engineState);

/** Opens a page and waits until the engine has applied the first settings. */
async function open(b, url = HOME) {
  await b.goto(url);
  await waitFor(b, () => document.documentElement.getAttribute('data-at-peace') !== null, null, { what: 'the engine to apply settings' });
  await waitFor(b, () => Boolean(document.querySelector('ytd-masthead')), null, { what: 'the masthead' });
}

/** A toggle id and a select (id, default value, other value) found in the compiled sheet. */
function discoverTokens(css) {
  const tokens = [...css.matchAll(/html\[data-at-peace~="([^"]+)"\]/g)].map((m) => m[1]);
  const toggle = tokens.find((t) => !t.includes('=') && t !== 'general.enabled') ?? null;
  const selects = new Map();
  for (const t of tokens) {
    if (!t.includes('=')) continue;
    const [id, value] = t.split('=');
    selects.set(id, [...(selects.get(id) ?? []), value]);
  }
  const [selectId, values] = [...selects.entries()][0] ?? [null, []];
  return { toggle, selectId, selectValue: values[0] ?? null };
}

/**
 * Searches through YouTube's own search box (an SPA navigation). Waits for the box to be hydrated
 * first, and if Enter did not submit (typed before YouTube's handlers were attached) clicks the
 * search button instead.
 */
async function searchFor(b, text) {
  await sleep(1500);
  await b.search(text);
  for (let attempt = 0; attempt < 2; attempt++) {
    const end = Date.now() + 8000;
    while (Date.now() < end) {
      if (await b.evaluate(() => location.pathname === '/results')) return;
      await sleep(200);
    }
    await b.evaluate(() => document.querySelector('#search-icon-legacy')?.click());
  }
}

const rule = (id, selector, page = null) => ({ id, selector, page, note: '', createdAt: 1 });

export const SCENARIOS = [
  {
    name: 'injects the style sheet, the tokens and the page attribute on the home page',
    async run(b, t) {
      await open(b);
      const s = await state(b);
      assert.equal(s.loaded, '1', 'content script ran');
      assert.ok(s.styleInDocument, '<style id="at-peace-style"> is a child of <html>');
      assert.ok(s.dynamicInDocument, '<style id="at-peace-dynamic"> is there too');
      assert.ok(Number(s.rules) >= 1, `data-rules=${s.rules}`);
      assert.ok(s.css.includes('html[data-at-peace~="general.enabled"] [data-at-peace-filtered] { display: none !important; }'), 'always-on filter rule');
      assert.ok(s.tokens.split(' ').includes('general.enabled'), `tokens: ${s.tokens}`);
      assert.equal(s.page, 'home');
      assert.equal(s.next, null);
      assert.equal(s.leakedNamespace, false, 'AtPeace must not be visible to the page');
      if (typeof s.parsedRules === 'number') assert.equal(s.parsedRules, Number(s.rules), 'every compiled rule parsed (no invalid selector voided a rule)');
      else t.diagnostic(`${b.name}: the page cannot read our sheet's cssRules (${s.parsedRules}); parse check skipped`);
      t.diagnostic(`${b.name}: ${s.rules} compiled rules, tokens: ${s.tokens}`);
    },
  },

  {
    name: 'toggling settings changes the tokens live, without reloading the page',
    async run(b, t) {
      await open(b);
      const marker = await b.evaluate(setReloadMarker);
      const { css } = await state(b);
      const { toggle, selectId, selectValue } = discoverTokens(css);
      assert.ok(toggle, 'the catalog has at least one toggle with CSS');
      t.diagnostic(`${b.name}: toggle=${toggle} select=${selectId}=${selectValue}`);

      await b.setStorage({ settings: { [toggle]: true } });
      await waitFor(b, (id) => document.documentElement.getAttribute('data-at-peace').split(' ').includes(id), toggle, { what: `token ${toggle} on` });
      await b.setStorage({ settings: { [toggle]: false } });
      await waitFor(b, (id) => !document.documentElement.getAttribute('data-at-peace').split(' ').includes(id), toggle, { what: `token ${toggle} off` });

      if (selectId) {
        const before = (await state(b)).tokens.split(' ').find((x) => x.startsWith(`${selectId}=`));
        assert.ok(before, `a select always has a token (default included): ${selectId}`);
        await b.setStorage({ settings: { [selectId]: selectValue } });
        await waitFor(b, (tok) => document.documentElement.getAttribute('data-at-peace').split(' ').includes(tok), `${selectId}=${selectValue}`, { what: 'select token' });
        const after = (await state(b)).tokens.split(' ').filter((x) => x.startsWith(`${selectId}=`));
        assert.deepEqual(after, [`${selectId}=${selectValue}`], 'exactly one token per select');
      }
      assert.equal(await b.evaluate(getReloadMarker), marker, 'the page was not reloaded');
    },
  },

  {
    name: 'a compiled static rule really applies in the browser (the page does not block the injected <style>)',
    async run(b) {
      // Start from the untouched baseline: a fresh install applies the Gentle preset, which
      // already hides the button this scenario toggles.
      await b.setStorage({ settings: {} });
      await open(b);
      // A real catalog setting whose element exists on every logged-out page.
      const id = 'yt.masthead.hideVoiceSearch';
      const button = 'ytd-masthead #voice-search-button';
      const { css } = await state(b);
      assert.ok(css.includes(id), `the compiled sheet contains rules for ${id}`);
      await waitFor(b, (sel) => Boolean(document.querySelector(sel)), button, { what: 'the voice search button' });
      await waitFor(b, (sel) => getComputedStyle(document.querySelector(sel)).display !== 'none', button, { what: 'the button to be visible at baseline' });
      await b.setStorage({ settings: { [id]: true } });
      await waitFor(b, (sel) => getComputedStyle(document.querySelector(sel)).display === 'none', button, { what: 'the button to disappear' });
      await b.setStorage({ settings: {} });
      await waitFor(b, (sel) => getComputedStyle(document.querySelector(sel)).display !== 'none', button, { what: 'the button to come back' });
    },
  },

  {
    name: 'a picker rule hides an element live, only on its page, and removing it brings the element back',
    async run(b) {
      await open(b);
      const masthead = 'ytd-masthead';
      assert.notEqual((await b.evaluate(elementInfo, masthead)).display, 'none');

      await b.setStorage({ settings: { 'advanced.customRules': [rule('r1', 'ytd-masthead', 'watch')] } });
      await waitFor(b, () => document.getElementById('at-peace-dynamic').textContent.includes('ytd-masthead'), null, { what: 'the dynamic sheet' });
      await sleep(300);
      assert.notEqual((await b.evaluate(elementInfo, masthead)).display, 'none', 'a watch-only rule does not apply on the home page');

      await b.setStorage({ settings: { 'advanced.customRules': [rule('r1', 'ytd-masthead', 'home')] } });
      await waitFor(b, (sel) => getComputedStyle(document.querySelector(sel)).display === 'none', masthead, { what: 'the masthead to hide' });

      await b.setStorage({ settings: { 'advanced.customRules': [rule('r1', 'ytd-masthead')] } });
      await sleep(300);
      assert.equal((await b.evaluate(elementInfo, masthead)).display, 'none', 'a rule without a page applies everywhere');

      await b.setStorage({ settings: { 'advanced.customRules': [] } });
      await waitFor(b, (sel) => getComputedStyle(document.querySelector(sel)).display !== 'none', masthead, { what: 'the masthead to return' });
      assert.equal((await state(b)).dynamic, '');
    },
  },

  {
    name: 'custom CSS applies live and its @import / remote url() are stripped',
    async run(b) {
      await open(b);
      const css = '@import url(https://evil.example/x.css);\nytd-masthead { outline: 3px solid red !important; background: url(https://evil.example/x.png) }';
      await b.setStorage({ settings: { 'advanced.customCss': css } });
      await waitFor(b, (sel) => getComputedStyle(document.querySelector(sel)).outlineStyle === 'solid', 'ytd-masthead', { what: 'the outline' });
      const dynamic = (await state(b)).dynamic;
      assert.ok(!dynamic.includes('@import'), dynamic);
      assert.ok(!dynamic.includes('evil.example'), dynamic);
    },
  },

  {
    name: 'master switch off: tokens and the dynamic sheet are empty and YouTube is untouched; on restores them',
    async run(b) {
      await open(b);
      const toggle = discoverTokens((await state(b)).css).toggle;
      await b.setStorage({ settings: { 'advanced.customRules': [rule('r1', 'ytd-masthead')], ...(toggle ? { [toggle]: true } : {}) } });
      await waitFor(b, (sel) => getComputedStyle(document.querySelector(sel)).display === 'none', 'ytd-masthead', { what: 'the masthead to hide' });

      await b.setStorage({ settings: { 'general.enabled': false, 'advanced.customRules': [rule('r1', 'ytd-masthead')], ...(toggle ? { [toggle]: true } : {}) } });
      await waitFor(b, () => document.documentElement.getAttribute('data-at-peace') === '', null, { what: 'tokens to empty' });
      const off = await state(b);
      assert.equal(off.tokens, '');
      assert.equal(off.dynamic, '');
      assert.notEqual((await b.evaluate(elementInfo, 'ytd-masthead')).display, 'none');
      assert.equal(off.page, 'home', 'the page attribute stays correct while disabled');

      await b.setStorage({ settings: { 'advanced.customRules': [rule('r1', 'ytd-masthead')], ...(toggle ? { [toggle]: true } : {}) } });
      await waitFor(b, (sel) => getComputedStyle(document.querySelector(sel)).display === 'none', 'ytd-masthead', { what: 'the masthead to hide again' });
      assert.ok((await state(b)).tokens.split(' ').includes('general.enabled'));
    },
  },

  {
    name: 'SPA navigation keeps data-at-peace-page right: home → search → watch → back, announcing each target first',
    async run(b, t) {
      await open(b);
      assert.equal((await state(b)).page, 'home');
      await b.evaluate(startRecording, 'ytd-video-renderer');

      await searchFor(b, 'lofi');
      await waitFor(b, () => document.documentElement.getAttribute('data-at-peace-page') === 'search', null, { what: 'page=search' });
      await waitFor(b, () => document.documentElement.getAttribute('data-at-peace-next') === null, null, { what: 'next cleared' });
      assert.match((await state(b)).path, /^\/results\?search_query=lofi/);

      await b.clickFirstResult();
      await waitFor(b, () => document.documentElement.getAttribute('data-at-peace-page') === 'watch', null, { what: 'page=watch' });
      await waitFor(b, () => document.documentElement.getAttribute('data-at-peace-next') === null, null, { what: 'next cleared' });

      await b.back();
      await waitFor(b, () => document.documentElement.getAttribute('data-at-peace-page') === 'search', null, { what: 'page=search after back' });
      await waitFor(b, () => document.documentElement.getAttribute('data-at-peace-next') === null, null, { what: 'next cleared after back' });
      assert.match((await state(b)).path, /^\/results/);

      const rec = await b.evaluate(stopRecording);
      t.diagnostic(`${b.name}: attribute states: ${rec.states.map((s) => `${s.page}|${s.next}@${s.t}`).join(' → ')}`);
      const has = (page, next) => rec.states.some((s) => s.page === page && s.next === next);
      assert.ok(has('home', 'search'), 'while on home, the search target was announced before the page committed');
      assert.ok(has('search', 'watch'), 'while on search, the watch target was announced');
      assert.ok(has('search', null) && has('watch', null), 'each page committed with nothing pending');
    },
  },

  {
    name: 'anti-flicker, going TO a page: a rule scoped to it never lets its elements paint',
    async run(b, t) {
      // search → watch: YouTube un-hides the watch page ~150 ms after navigation starts but only
      // fires yt-navigate-finish ~0.5 s later, so a page attribute that waited for "finish" would
      // let the watch page paint unhidden for dozens of frames.
      const sel = 'ytd-watch-flexy';
      await open(b, SEARCH);
      await waitFor(b, () => document.querySelectorAll('ytd-video-renderer').length > 0, null, { what: 'search results' });

      // Control run, no rule: the element really does paint before yt-navigate-finish in this browser.
      await b.evaluate(startRecording, sel);
      await b.clickFirstResult();
      await waitFor(b, () => document.documentElement.getAttribute('data-at-peace-page') === 'watch', null, { what: 'page=watch' });
      await sleep(1500);
      const control = await b.evaluate(stopRecording);
      assert.notEqual(control.firstPaintedAt, null, 'control: the watch page paints when nothing hides it');
      t.diagnostic(`${b.name}: control (no rule): ${sel} first painted ${control.firstPaintedAt} ms, yt-navigate-start ${control.startAt} ms, yt-navigate-finish ${control.finishAt} ms → ${control.finishAt - control.firstPaintedAt} ms of painting before finish`);

      // Same navigation again, now with a watch-scoped rule that hides the whole page element.
      await b.back();
      await waitFor(b, () => document.documentElement.getAttribute('data-at-peace-page') === 'search' && document.querySelectorAll('ytd-video-renderer').length > 0, null, { what: 'back on search' });
      await b.setStorage({ settings: { 'advanced.customRules': [rule('r1', sel, 'watch')] } });
      await waitFor(b, () => document.getElementById('at-peace-dynamic').textContent.includes('ytd-watch-flexy'), null, { what: 'the rule' });
      await b.evaluate(startRecording, sel);
      await b.clickFirstResult();
      await waitFor(b, () => document.documentElement.getAttribute('data-at-peace-page') === 'watch', null, { what: 'page=watch' });
      await sleep(1500);
      const rec = await b.evaluate(stopRecording);

      t.diagnostic(`${b.name}: with the rule: ${rec.frames} frames sampled, ${rec.framesWithElement} with ${sel} in the DOM, ${rec.paintedFrames} with it painted`);
      assert.ok(rec.framesWithElement > 0, 'the watch page element existed (hidden) during the sampled frames');
      assert.deepEqual(rec.violations, [], 'no frame painted the element the rule hides');
    },
  },

  {
    name: 'anti-flicker, going AWAY from a page: its hidden elements do not pop back into view',
    async run(b, t) {
      await open(b, SEARCH);
      await waitFor(b, () => Boolean(document.querySelector('ytd-search-header-renderer')) && document.documentElement.getAttribute('data-at-peace-page') === 'search', null, { what: 'the search page' });
      const sel = 'ytd-search-header-renderer';
      assert.ok((await b.evaluate(elementInfo, sel)).height > 0, 'control: the header is painted when nothing hides it');

      await b.setStorage({ settings: { 'advanced.customRules': [rule('r1', sel, 'search')] } });
      await waitFor(b, (s) => getComputedStyle(document.querySelector(s)).display === 'none', sel, { what: 'the header to hide' });
      await b.evaluate(startRecording, sel);

      await b.clickFirstResult();
      await waitFor(b, () => document.documentElement.getAttribute('data-at-peace-page') === 'watch', null, { what: 'page=watch' });
      await sleep(1500);
      const rec = await b.evaluate(stopRecording);

      t.diagnostic(`${b.name}: ${rec.frames} frames sampled, ${rec.framesWithElement} with the header in the DOM, ${rec.paintedFrames} with it painted; navigate-start at ${rec.startAt} ms, finish at ${rec.finishAt} ms`);
      assert.ok(rec.framesWithElement > 0, 'the header stayed in the DOM while the old page was still on screen');
      assert.deepEqual(rec.violations, [], 'no frame painted the hidden header');
    },
  },

  {
    name: 'no errors from our code appeared in this browser while doing all of the above',
    async run(b) {
      assert.deepEqual(await b.ourErrors(), []);
    },
  },
];
