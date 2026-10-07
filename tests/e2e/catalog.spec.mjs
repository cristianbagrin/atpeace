// Phase 2b catalog E2E (Chromium, live youtube.com, logged out): turns catalog settings on through
// storage and checks, on the real page, that
//   * the targeted elements really are hidden (computed style), and
//   * the things that must stay (player, title, search box, playlist panel, the other tabs…) stay.
// Settings are flipped live (the engine reacts to storage changes), so each page is loaded once.
// Screenshots go to tests/e2e/artifacts/catalog/ (git-ignored): look at them, the assertions only
// prove what they were written to prove.
//
// Not covered here, on purpose (see the "coverage" test for the live list):
//   * settings that depend on the page bridge (`feature: 'bridgeTags'`, Phase 3b),
//   * JS-driven settings (feed redirects, autoplay, filters …: their own phases test them),
//   * signed-in-only UI (Create button, signed-in sidebar, the home feed, the subscriptions feed).
//     For two feed rules a SYNTHETIC card is added to the live page, which proves page scoping and
//     selector logic but not that YouTube renders such a card.
//
// Google rate-limits automated loads with a /sorry/ captcha: pages are loaded one at a time with a
// pause (CATALOG_PAUSE_MS, default 12 s); a captcha skips the rest of that group.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { launch, close, getContext, setStorage, trackErrors, ARTIFACTS } from './harness.mjs';
import { watchGate, liveSkipReason, gate } from './_live.mjs';

const SHOTS = join(ARTIFACTS, 'catalog');
const PAUSE_MS = Number(process.env.CATALOG_PAUSE_MS ?? 12_000);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Ids of settings these tests exercised, for the coverage report. */
const covered = new Set();
/** Groups skipped because Google served its captcha: the coverage check cannot judge an incomplete run. */
const skippedGroups = [];

let page;
let previous = new Set(); // toggle/select tokens set by the last apply()
let lastLoad = 0;

before(async () => {
  await launch();
  await mkdir(SHOTS, { recursive: true });
  page = watchGate(trackErrors(await getContext().newPage()));
  await page.setViewportSize({ width: 1440, height: 900 });
});

after(async () => {
  await close();
});

// ---------------------------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------------------------

/** Runs in the page: what each selector matches and how it is displayed. */
function probe(selectors) {
  return selectors.map((sel) => {
    let els;
    try {
      els = [...document.querySelectorAll(sel)];
    } catch (err) {
      return { sel, error: String(err) };
    }
    const info = els.map((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return { display: cs.display, visibility: cs.visibility, w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), y: Math.round(r.y) };
    });
    const gone = (i) => i.display === 'none' || i.visibility === 'hidden';
    return {
      sel,
      count: els.length,
      allGone: els.length > 0 && info.every(gone),
      someShown: info.some((i) => !gone(i) && i.w > 0 && i.h > 0),
      info: info.slice(0, 3),
    };
  });
}

/** Loads a page and waits for the engine. Throws { code: 'YT_SORRY' } when Google serves its captcha. */
async function open(url, { ready = 'ytd-masthead' } = {}) {
  const wait = lastLoad + PAUSE_MS - Date.now();
  if (wait > 0) await sleep(wait);
  await setStorage({ settings: {} });
  previous = new Set();
  await page.bringToFront(); // a background tab gets throttled timers
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  lastLoad = Date.now();
  if (page.url().includes('/sorry/')) throw Object.assign(new Error('Google served its captcha page (/sorry/)'), { code: 'YT_SORRY' });
  await page.waitForFunction(() => document.documentElement.getAttribute('data-at-peace') !== null, null, { timeout: 20_000 });
  await page.waitForSelector(ready, { state: 'attached', timeout: 20_000 });
  await page.mouse.move(2, 2); // the pointer stays where the last test left it: keep it off the cards (hover reveals thumbnails)
  await sleep(4000); // let the first render settle
}

/** Replaces all stored settings and waits until the engine has applied them. */
async function apply(settings) {
  await setStorage({ settings });
  await page.bringToFront();
  const want = Object.entries(settings).map(([id, v]) => (v === true ? id : typeof v === 'string' ? `${id}=${v}` : null)).filter(Boolean);
  const drop = [...previous].filter((tok) => !want.includes(tok) && !tok.includes('='));
  await page.waitForFunction(
    ({ want, drop }) => {
      const tokens = (document.documentElement.getAttribute('data-at-peace') ?? '').split(' ');
      return want.every((t) => tokens.includes(t)) && drop.every((t) => !tokens.includes(t));
    },
    { want, drop },
    { timeout: 10_000 },
  );
  previous = new Set(want);
  for (const id of Object.keys(settings)) covered.add(id);
  await sleep(350); // rules apply on the next frame; transitions (0.15 s) finish
}

async function look(selectors) {
  const list = await page.evaluate(probe, selectors);
  return Object.fromEntries(list.map((r) => [r.sel, r]));
}

/** Every match of every selector is display:none (or visibility:hidden). `optional`: no match is fine (content varies). */
async function expectHidden(label, selectors, { optional = false } = {}) {
  const found = await look(selectors);
  for (const sel of selectors) {
    const r = found[sel];
    assert.ok(!r.error, `${label}: invalid selector ${sel}: ${r.error}`);
    if (r.count === 0) {
      assert.ok(optional, `${label}: nothing on the page matches ${sel}`);
      continue;
    }
    assert.ok(r.allGone, `${label}: ${sel} should be hidden but is displayed: ${JSON.stringify(r.info)}`);
  }
}

/** At least one match is really displayed (non-zero box). */
async function expectShown(label, selectors) {
  const found = await look(selectors);
  for (const sel of selectors) {
    const r = found[sel];
    assert.ok(!r.error, `${label}: invalid selector ${sel}: ${r.error}`);
    assert.ok(r.count > 0 && r.someShown, `${label}: ${sel} should still be visible (${r.count} found): ${JSON.stringify(r.info)}`);
  }
}

const rect = (selector) =>
  page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  }, selector);

const computed = (selector, prop, pseudo = null) =>
  page.evaluate(([sel, p, ps]) => {
    const el = document.querySelector(sel);
    return el ? getComputedStyle(el, ps)[p] : null;
  }, [selector, prop, pseudo]);

/** Waits (up to 4 s) until a computed property matches: filters animate over 0.15 s and headless frames are slow. */
async function expectComputed(label, selector, prop, expected, pseudo = null) {
  const test = typeof expected === 'string' ? (v) => v === expected : (v) => expected.test(v ?? '');
  let last = null;
  for (let i = 0; i < 40; i++) {
    last = await computed(selector, prop, pseudo);
    if (test(last)) return;
    await sleep(100);
  }
  const diag = await page.evaluate(() => ({ visibility: document.visibilityState, focus: document.hasFocus(), tokens: document.documentElement.getAttribute('data-at-peace'), hovered: [...document.querySelectorAll(':hover')].map((e) => e.tagName.toLowerCase() + (e.id ? '#' + e.id : '')).slice(-5), y: window.scrollY }));
  assert.fail(`${label}: ${selector} ${prop} is ${JSON.stringify(last)}, expected ${expected} (page ${JSON.stringify(diag)})`);
}

const shot = (name) => page.screenshot({ path: join(SHOTS, `${name}.png`) });

/** Wraps a group so a Google captcha skips it instead of failing the run. */
function group(name, fn) {
  test(name, async (t) => {
    try {
      await fn(t);
    } catch (err) {
      const why = await liveSkipReason(err, page);
      if (why) {
        skippedGroups.push(name);
        return t.skip(why);
      }
      throw err;
    }
  });
}

/**
 * Adds a synthetic element to the live page (never innerHTML: built with the DOM API). YouTube's
 * components upgrade synchronously on insertion and re-stamp their children, so the children are
 * added after the element is in the document.
 */
function inject(parentSelector, tag, attrs, children = []) {
  return page.evaluate(
    ([parent, tagName, attributes, kids]) => {
      const build = (spec) => {
        const el = document.createElement(spec.tag);
        for (const [k, v] of Object.entries(spec.attrs ?? {})) el.setAttribute(k, v);
        return el;
      };
      const host = document.querySelector(parent);
      if (!host) return false;
      const el = build({ tag: tagName, attrs: attributes });
      el.setAttribute('data-test-synthetic', '1');
      host.appendChild(el);
      const fill = (target, specs) => {
        for (const spec of specs) {
          const child = build(spec);
          target.appendChild(child);
          fill(child, spec.children ?? []);
        }
      };
      fill(el, kids);
      return true;
    },
    [parentSelector, tag, attrs, children],
  );
}

// ---------------------------------------------------------------------------------------------
// Home (logged out: an empty feed with the "try searching" card, the whole masthead and guide)
// ---------------------------------------------------------------------------------------------

group('home: top bar and sidebar settings hide exactly their targets', async () => {
  await open('https://www.youtube.com/');
  // Live YouTube sometimes serves the home page with no sidebar entries in the DOM at all (a page variant): the
  // sidebar settings cannot be judged on it, and that says nothing about the settings.
  await page.waitForFunction(() => document.querySelectorAll('ytd-guide-entry-renderer').length >= 5, null, { timeout: 15_000 }).catch(() => {
    throw gate('Live YouTube served the home page without its sidebar entries');
  });
  await shot('home-before');

  // Only the suggestions list goes; the search box itself must stay (and stay usable).
  await apply({ 'yt.masthead.hideSearchSuggestions': true });
  await expectHidden('suggestions', ['yt-searchbox .ytSearchboxComponentSuggestionsContainer']);
  await expectShown('search box with suggestions hidden', ['ytd-masthead yt-searchbox', 'ytd-masthead input[name="search_query"]']);

  await apply({ 'yt.masthead.hideVoiceSearch': true, 'yt.masthead.hideCountryCode': true, 'yt.masthead.hideGuideButton': true, 'yt.masthead.hideAICompanion': true });
  await expectHidden('masthead bits', ['ytd-masthead #voice-search-button', 'ytd-topbar-logo-renderer #country-code', 'ytd-masthead #guide-button', 'ytd-masthead #ai-companion-button']);
  await expectShown('masthead keeps logo and search', ['ytd-topbar-logo-renderer a#logo', 'ytd-masthead yt-searchbox']);

  await apply({ 'yt.masthead.hideSearchBar': true });
  await expectHidden('search bar', ['ytd-masthead #center', 'ytd-masthead yt-searchbox']);
  await expectShown('masthead keeps the logo and the buttons at the end', ['ytd-topbar-logo-renderer a#logo', 'ytd-masthead #end']);

  await apply({ 'yt.masthead.hideDoodle': true });
  await expectShown('logo with seasonal logos hidden', ['ytd-topbar-logo-renderer a#logo ytd-logo']);

  // Entries by link: exactly the five primary entries vanish; Explore entries and the footer stay.
  await apply({ 'yt.guide.hideHome': true, 'yt.guide.hideShorts': true, 'yt.guide.hideSubscriptionsEntry': true, 'yt.guide.hideYouEntry': true, 'yt.guide.hideHistory': true });
  const firstSection = 'tp-yt-app-drawer#guide ytd-guide-section-renderer:first-of-type ytd-guide-entry-renderer';
  await expectHidden('five primary entries', [firstSection]);
  const all = await look(['tp-yt-app-drawer#guide ytd-guide-section-renderer:first-of-type ytd-guide-entry-renderer']);
  assert.equal(all['tp-yt-app-drawer#guide ytd-guide-section-renderer:first-of-type ytd-guide-entry-renderer'].count, 5, 'the Shorts rule hid the Shorts entry and nothing else of the primary section');
  await expectShown('other guide entries stay', ['ytd-guide-entry-renderer:has(> a#endpoint[href="/reporthistory"])', 'ytd-guide-entry-renderer:has(> a#endpoint[href="/channel/UC-9-kyTW8ZkZNDHQJ6FgpwQ"])']);

  // Sections: each goes whole (title and divider included); the other sections stay.
  await apply({ 'yt.guide.hideExploreSection': true });
  await expectHidden('explore section', ['ytd-guide-section-renderer:has(a#endpoint[href="/channel/UC-9-kyTW8ZkZNDHQJ6FgpwQ"])']);
  await expectShown('home entry stays when Explore goes', ['ytd-guide-entry-renderer:has(> a#endpoint[href="/"])', 'ytd-guide-entry-renderer:has(> a#endpoint[href="/reporthistory"])']);
  await apply({ 'yt.guide.hideMoreFromYouTube': true, 'yt.guide.hideSettingsSection': true, 'yt.guide.hideFooter': true, 'yt.guide.hideSignInPromo': true });
  await expectHidden('guide sections', ['ytd-guide-section-renderer:has(a#endpoint[href*="youtubekids.com"])', 'ytd-guide-section-renderer:has(a#endpoint[href="/reporthistory"])', 'ytd-guide-renderer #footer', 'ytd-guide-signin-promo-renderer']);
  await expectShown('Explore and the primary entries stay', ['ytd-guide-section-renderer:has(a#endpoint[href="/channel/UC-9-kyTW8ZkZNDHQJ6FgpwQ"])', 'ytd-guide-entry-renderer:has(> a#endpoint[href="/"])']);
  await shot('home-guide-trimmed');
});

group('home: hiding the sidebar leaves no gutter; the nudge and the feed hide cleanly', async () => {
  await open('https://www.youtube.com/');
  const beforeX = (await rect('ytd-page-manager')).x;
  assert.equal(beforeX, 240, 'precondition: the guide is docked at 1440 px');
  const nudgeBefore = await rect('ytd-feed-nudge-renderer');

  await apply({ 'yt.guide.hideAll': true });
  await expectHidden('guide', ['tp-yt-app-drawer#guide', 'ytd-mini-guide-renderer', 'ytd-masthead #guide-button']);
  const pm = await rect('ytd-page-manager');
  assert.equal(pm.x, 0, 'the page starts at the left edge (no 240 px gutter)');
  assert.equal(pm.w, 1440, 'and uses the full width');
  const nudge = await rect('ytd-feed-nudge-renderer');
  assert.ok(Math.abs(nudge.x + nudge.w / 2 - 720) <= 24, `the content is centred in the window, not in what is left of it (centre ${nudge.x + nudge.w / 2})`);
  assert.ok(nudge.x < nudgeBefore.x, 'the content moved left');
  await shot('home-guide-hidden');

  await apply({ 'yt.home.hideFeedNudge': true });
  await expectHidden('feed nudge', ['ytd-feed-nudge-renderer']);
  const heightWith = (await rect('ytd-browse[page-subtype="home"]')).h;
  await apply({});
  const heightWithout = (await rect('ytd-browse[page-subtype="home"]')).h;
  assert.ok(heightWith < heightWithout - 20, `hiding the nudge shrinks the page instead of leaving a hole (${heightWith} vs ${heightWithout})`);

  // Feed modes: the whole feed column goes for "hide" and for every redirect mode (no flash before a redirect).
  await apply({ 'yt.home.feedMode': 'hide' });
  await expectHidden('feed column (hide)', ['ytd-browse[page-subtype="home"] #primary']);
  await expectShown('masthead stays on an empty home', ['ytd-masthead']);
  await apply({ 'yt.home.feedMode': 'show' });
  await expectShown('feed column (show)', ['ytd-browse[page-subtype="home"] #primary']);
  await shot('home-after');

  // Narrow window: YouTube collapses the guide to the icon strip (page starts at x = 72). Hiding the strip must
  // give that width back, with the strip's own setting and with "hide the whole sidebar".
  await apply({});
  await page.setViewportSize({ width: 1100, height: 800 });
  try {
    await page.waitForFunction(() => document.querySelector('ytd-app')?.hasAttribute('mini-guide-visible'), null, { timeout: 10_000 });
    await sleep(800);
    assert.equal((await rect('ytd-page-manager')).x, 72, 'precondition: the icon strip is docked at 1100 px');
    await shot('home-narrow-before');
    await apply({ 'yt.guide.hideMini': true });
    await expectHidden('icon strip', ['ytd-mini-guide-renderer']);
    assert.equal((await rect('ytd-page-manager')).x, 0, 'the page starts at the left edge once the strip is hidden');
    await shot('home-narrow-mini-hidden');
    await apply({ 'yt.guide.hideAll': true });
    assert.equal((await rect('ytd-page-manager')).x, 0, 'and with the whole sidebar hidden');
    await apply({});
  } finally {
    await page.setViewportSize({ width: 1440, height: 900 });
  }
});

group('home: shelves, Shorts cards and posts hide as whole grid items (synthetic cards)', async () => {
  await open('https://www.youtube.com/');
  const grid = 'ytd-browse[page-subtype="home"] ytd-rich-grid-renderer > #contents';
  const card = (id, href) => inject(grid, 'ytd-rich-item-renderer', { 'data-test-id': id }, [{ tag: 'a', attrs: { href, id: 'thumbnail' } }]);
  assert.ok(await card('short', '/shorts/abcdefghijk'));
  assert.ok(await card('video', '/watch?v=abcdefghijk'));
  assert.ok(await inject(grid, 'ytd-rich-section-renderer', { 'data-test-id': 'shelf' }, [{ tag: 'ytd-rich-shelf-renderer', attrs: { 'is-shorts': '' } }]));
  assert.ok(await inject(grid, 'ytd-rich-section-renderer', { 'data-test-id': 'posts' }, [{ tag: 'ytd-rich-item-renderer', attrs: { 'is-post': '' } }]));
  assert.ok(await inject(grid, 'ytd-rich-section-renderer', { 'data-test-id': 'other' }, [{ tag: 'div' }]));

  const state = (id) => page.evaluate((i) => getComputedStyle(document.querySelector(`[data-test-id="${i}"]`)).display, id);
  await apply({});
  for (const id of ['short', 'video', 'shelf', 'posts', 'other']) assert.notEqual(await state(id), 'none', `${id} is shown with everything off`);

  await apply({ 'yt.home.hideShortsShelf': true });
  assert.equal(await state('short'), 'none', 'a Shorts card');
  assert.equal(await state('shelf'), 'none', 'a Shorts shelf (its section, so no gap stays)');
  assert.notEqual(await state('video'), 'none', 'an ordinary video card stays');
  assert.notEqual(await state('posts'), 'none', 'a posts shelf stays');
  assert.notEqual(await state('other'), 'none', 'an unrelated shelf stays');

  await apply({ 'yt.home.hidePostsShelf': true });
  assert.equal(await state('posts'), 'none');
  assert.notEqual(await state('video'), 'none');
  assert.notEqual(await state('short'), 'none', 'the Shorts setting is independent');

  await apply({ 'yt.home.hideOtherShelves': true });
  assert.equal(await state('other'), 'none', 'every extra row goes');
  assert.equal(await state('shelf'), 'none');
  assert.notEqual(await state('video'), 'none', 'but never a video card');

  // Category bar: no chips are served logged out, so give the page one. The translucent backdrop behind the top
  // bar grows to cover a chip bar (112 px) and must shrink back to the bar's own height (56 px) when the chips go.
  await apply({});
  await page.evaluate(() => {
    const header = document.querySelector('ytd-browse[page-subtype="home"] ytd-rich-grid-renderer > #header');
    header.removeAttribute('hidden');
    header.appendChild(document.createElement('ytd-feed-filter-chip-bar-renderer')).setAttribute('data-test-id', 'chips');
    const glass = document.querySelector('#frosted-glass');
    glass.classList.remove('without-chipbar');
    glass.classList.add('with-chipbar');
  });
  assert.notEqual(await state('chips'), 'none', 'precondition: the synthetic chip bar is shown');
  assert.equal((await rect('#frosted-glass')).h, 112, 'precondition: the backdrop covers the chip bar');
  await apply({ 'yt.home.hideChips': true });
  assert.equal(await state('chips'), 'none', 'the chip bar goes');
  assert.equal((await rect('#frosted-glass')).h, 56, 'and the backdrop shrinks back to the top bar: no frosted strip is left behind');
  assert.notEqual(await state('video'), 'none');
});

// ---------------------------------------------------------------------------------------------
// Search results
// ---------------------------------------------------------------------------------------------

group('search: extras between results, card details and thumbnail modes', async (t) => {
  await open('https://www.youtube.com/results?search_query=lofi', { ready: 'ytd-search ytd-video-renderer' });
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot('search-before');
  const results = 'ytd-search ytd-video-renderer';
  const baseline = (await look([results]))[results].count;
  assert.ok(baseline >= 8, `precondition: ${baseline} results`);

  await apply({ 'yt.search.hideShorts': true });
  await expectHidden('Shorts shelves', ['ytd-search grid-shelf-view-model:has(ytm-shorts-lockup-view-model)'], { optional: true });
  await expectShown('results stay with Shorts hidden', [results]);
  const afterShorts = (await look([results]))[results];
  assert.ok(afterShorts.someShown);

  await apply({ 'yt.search.hideShelves': true, 'yt.search.hideChannelResults': true });
  await expectHidden('shelves and channel cards', ['ytd-search ytd-shelf-renderer', 'ytd-search ytd-channel-renderer'], { optional: true });
  await expectShown('results stay with shelves hidden', [results]);

  await apply({ 'yt.search.hideSnippets': true, 'yt.search.hideFilterChips': true });
  await expectHidden('snippets and chips', ['ytd-search ytd-video-renderer .metadata-snippet-container', 'ytd-search ytd-search-header-renderer #chip-bar'], { optional: true });
  await expectShown('titles and the Filters button stay', ['ytd-search ytd-video-renderer a#video-title', 'ytd-search ytd-search-header-renderer #filter-button']);

  await apply({ 'yt.search.hideAISummary': true });
  await expectHidden('AI summary', ['ytd-search ytd-expandable-metadata-renderer:has(video-summary-content-view-model)'], { optional: true });

  // Card details.
  await apply({ 'yt.general.hideViewCounts': true });
  await expectHidden('view counts', ['ytd-search ytd-video-meta-block #metadata-line > span.inline-metadata-item:nth-of-type(1)']);
  await expectShown('dates stay when only views go', ['ytd-search ytd-video-meta-block #metadata-line > span.inline-metadata-item:nth-of-type(2)']);
  assert.equal(await computed('ytd-search ytd-video-meta-block #metadata-line > span.inline-metadata-item:nth-of-type(2)', 'display', '::before'), 'none', 'no stray bullet before the date');
  await apply({ 'yt.general.hideUploadDates': true });
  await expectHidden('dates', ['ytd-search ytd-video-meta-block #metadata-line > span.inline-metadata-item:nth-of-type(2)']);
  await expectShown('views stay when only dates go', ['ytd-search ytd-video-meta-block #metadata-line > span.inline-metadata-item:nth-of-type(1)']);
  await apply({ 'yt.general.hideDurations': true, 'yt.general.hideChannelAvatars': true, 'yt.general.hideBadges': true });
  await expectHidden('durations, avatars, badges', ['ytd-search ytd-thumbnail-overlay-time-status-renderer', 'ytd-search ytd-video-renderer #channel-info > a#channel-thumbnail', 'ytd-search ytd-video-renderer #badges']);
  await expectShown('titles, thumbnails and channel names stay', ['ytd-search ytd-video-renderer a#video-title', 'ytd-search ytd-video-renderer ytd-thumbnail img', 'ytd-search ytd-video-renderer ytd-channel-name']);

  // Everything at once, for the screenshot.
  await apply({
    'yt.search.hideShorts': true, 'yt.search.hideShelves': true, 'yt.search.hideSnippets': true, 'yt.search.hideFilterChips': true, 'yt.search.hideChannelResults': true,
    'yt.general.hideViewCounts': true, 'yt.general.hideUploadDates': true, 'yt.general.hideDurations': true, 'yt.general.hideChannelAvatars': true, 'yt.general.hideBadges': true,
  });
  await expectShown('titles still stay', ['ytd-search ytd-video-renderer a#video-title']);
  await shot('search-after');

  // Thumbnail modes: blur / grayscale until the card is hovered; hide keeps the box.
  const img = 'ytd-search ytd-video-renderer ytd-thumbnail img';
  await apply({ 'yt.general.thumbnails': 'blur' });
  const box = await rect('ytd-search ytd-video-renderer ytd-thumbnail');
  await expectComputed('blurred', img, 'filter', /^blur\(14px\)/);
  assert.equal(await computed('ytd-search ytd-video-renderer ytd-thumbnail-overlay-time-status-renderer', 'filter'), 'none', 'the duration badge stays crisp');
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot('search-thumbnails-blur');
  // YouTube's hover preview is a separate element drawn over the card: once it appears the pointer is no
  // longer "on the card". Switch it off so the reveal can be observed on its own (the preview itself is unblurred).
  await apply({ 'yt.general.thumbnails': 'blur', 'yt.general.disableHoverPreview': true });
  await expectHidden('hover preview host', ['ytd-app #video-preview']);
  await page.hover('ytd-search ytd-video-renderer ytd-thumbnail');
  await expectComputed('revealed while the pointer is on the card', img, 'filter', 'none');
  await page.mouse.move(2, 2);
  await expectComputed('blurred again after the pointer leaves', img, 'filter', /^blur/);

  await apply({ 'yt.general.thumbnails': 'grayscale' });
  await expectComputed('grey', img, 'filter', /^grayscale\(1\)/);
  await apply({ 'yt.general.thumbnails': 'hide' });
  await expectComputed('hidden', img, 'visibility', 'hidden');
  const boxHidden = await rect('ytd-search ytd-video-renderer ytd-thumbnail');
  assert.deepEqual([boxHidden.w, boxHidden.h], [box.w, box.h], 'the thumbnail keeps its size, so the list does not jump');
  await shot('search-thumbnails-hide');
  await apply({ 'yt.general.thumbnails': 'show' });
  await expectComputed('filter off', img, 'filter', 'none');
  await expectComputed('visible again', img, 'visibility', 'visible');

  // Grayscale on <html> must not detach the fixed masthead when scrolling.
  await apply({ 'yt.general.grayscale': true });
  await expectComputed('grayscale on the page root', 'html', 'filter', 'grayscale(1)');
  await page.evaluate(() => window.scrollTo(0, 900));
  await sleep(600);
  const masthead = await rect('ytd-masthead');
  assert.equal(masthead.y, 0, 'the masthead is still fixed to the top of the window after scrolling');
  assert.ok(await page.evaluate(() => window.scrollY) > 300, 'the page did scroll');
  await shot('search-grayscale');
  await page.evaluate(() => window.scrollTo(0, 0));
  t.diagnostic('grayscale + position:fixed verified in Chromium (Firefox: tests/firefox, see report)');
});

// ---------------------------------------------------------------------------------------------
// Watch page
// ---------------------------------------------------------------------------------------------

group('watch: related videos, buttons, details, comments and player controls', async () => {
  await open('https://www.youtube.com/watch?v=CFGLoQIhmow', { ready: 'ytd-watch-metadata' });
  await shot('watch-before');
  const player = await rect('#player');
  const title = 'ytd-watch-metadata #title h1';
  await expectShown('baseline', [title, '#movie_player', '#related', '#secondary']);

  // Related videos: the column goes with them, the player grows, the rest stays.
  await apply({ 'yt.watch.hideRelated': true });
  await expectHidden('related', ['ytd-watch-flexy #related', 'ytd-watch-flexy ytd-watch-next-secondary-results-renderer', '#secondary']);
  await expectShown('video, title and comments stay', ['#movie_player', title, 'ytd-watch-metadata #owner']);
  const wide = await rect('#player');
  assert.ok(wide.w > player.w + 250, `the player takes over the empty column (${player.w} -> ${wide.w})`);
  await shot('watch-related-hidden');
  await apply({});
  assert.equal((await rect('#player')).w, player.w, 'and goes back when the setting is off');

  // The buttons under the video: each hides exactly itself.
  const like = 'ytd-watch-metadata segmented-like-dislike-button-view-model';
  const share = 'ytd-watch-metadata #top-level-buttons-computed > yt-button-view-model:has(path[d^="M10 3.158V7.51"])';
  const save = 'ytd-watch-metadata #flexible-item-buttons > yt-button-view-model:has(path[d^="M19 2H5a2 2 0 00-2 2v16"])';
  const download = 'ytd-watch-metadata ytd-download-button-renderer';
  const more = 'ytd-watch-metadata ytd-menu-renderer > yt-button-shape#button-shape';
  await expectShown('buttons on the page', [like, share, save]);

  await apply({ 'yt.watch.hideLikeCounts': true });
  await expectHidden('like count', ['ytd-watch-metadata like-button-view-model .ytSpecButtonShapeNextButtonTextContent']);
  await expectShown('like buttons stay when only the count goes', [like, 'ytd-watch-metadata like-button-view-model button', share]);
  await apply({ 'yt.watch.hideLikeButtons': true });
  await expectHidden('like and dislike', [like]);
  await expectShown('share and save stay', [share, save]);
  await apply({ 'yt.watch.hideShare': true });
  await expectHidden('share', [share]);
  await expectShown('like and save stay', [like, save]);
  await apply({ 'yt.watch.hideSave': true });
  await expectHidden('save', [save]);
  await expectShown('like and share stay', [like, share]);
  await apply({ 'yt.watch.hideDownload': true, 'yt.watch.hideMoreActions': true });
  await expectHidden('download and more', [download, more]);
  await expectShown('like, share, save stay', [like, share, save]);
  // All button settings at once, for the screenshot: the row closes up, nothing else moves.
  await apply({ 'yt.watch.hideLikeCounts': true, 'yt.watch.hideShare': true, 'yt.watch.hideSave': true, 'yt.watch.hideDownload': true, 'yt.watch.hideMoreActions': true });
  await expectShown('like buttons stay in the all-buttons case', [like, 'ytd-watch-metadata #subscribe-button']);
  await shot('watch-buttons-hidden');

  // Channel row.
  await apply({ 'yt.watch.hideOwnerAvatar': true, 'yt.watch.hideSubscriberCount': true, 'yt.watch.hideJoinButton': true });
  await expectHidden('owner bits', ['ytd-watch-metadata ytd-video-owner-renderer #avatar', 'ytd-watch-metadata #owner-sub-count', 'ytd-watch-metadata #sponsor-button']);
  await expectShown('channel name and Subscribe stay', ['ytd-watch-metadata ytd-video-owner-renderer ytd-channel-name', 'ytd-watch-metadata #subscribe-button']);

  // View count and date in the info line: independent of each other.
  const views = 'ytd-watch-metadata ytd-watch-info-text #info > span:nth-child(1)';
  const date = 'ytd-watch-metadata ytd-watch-info-text #info > span:nth-child(3)';
  await apply({ 'yt.watch.hideViewCount': true });
  await expectHidden('view count', [views]);
  await expectShown('date stays', [date]);
  await apply({ 'yt.watch.hideUploadDate': true });
  await expectHidden('upload date', [date]);
  await expectShown('views stay', [views]);

  // Description box and comments.
  await apply({ 'yt.watch.hideDescription': true });
  await expectHidden('description', ['ytd-watch-metadata ytd-text-inline-expander', 'ytd-watch-metadata #bottom-row > #description']);
  await expectShown('title and channel row stay', [title, 'ytd-watch-metadata #owner']);
  await shot('watch-description-hidden');
  // Channel row and info line trimmed together, for the screenshot.
  await apply({ 'yt.watch.hideOwnerAvatar': true, 'yt.watch.hideSubscriberCount': true, 'yt.watch.hideViewCount': true, 'yt.watch.hideUploadDate': true, 'yt.watch.hideHashtags': true });
  await shot('watch-details-hidden');
  await apply({});

  await page.evaluate(() => window.scrollTo(0, 700));
  await page.waitForSelector('ytd-comment-thread-renderer', { state: 'attached', timeout: 20_000 }).catch(() => {});
  const haveComments = (await look(['ytd-comment-thread-renderer']))['ytd-comment-thread-renderer'].count > 0;
  if (haveComments) {
    const thread = 'ytd-comment-thread-renderer';
    await apply({ 'yt.comments.hideAvatars': true, 'yt.comments.hideLikeCounts': true, 'yt.comments.hideCreatorHearts': true, 'yt.comments.hideReplies': true });
    await expectHidden('comment details', ['ytd-comment-view-model #author-thumbnail', 'ytd-comment-engagement-bar #vote-count-middle', 'ytd-comment-thread-renderer #replies']);
    await expectShown('comment text and author stay', ['ytd-comment-thread-renderer #content-text', 'ytd-comment-thread-renderer #author-text', thread]);
    await apply({ 'yt.comments.hideCount': true });
    await expectHidden('comment count', ['ytd-comments-header-renderer #count']);
    await expectShown('comments stay when only the count goes', [thread, 'ytd-comments-header-renderer']);
  }
  const belowBefore = (await rect('#below'))?.h ?? 0;
  await apply({ 'yt.comments.hideAll': true, 'yt.comments.hideTeaser': true });
  await expectHidden('comments', ['ytd-comments#comments', '#comment-teaser']);
  await expectShown('video and description stay', ['#movie_player', title]);
  if (haveComments) assert.ok((await rect('#below')).h < belowBefore - 300, 'the comments take their space with them');
  await page.evaluate(() => window.scrollTo(0, 0));

  // Player controls and overlays: matched elements exist (hidden) on every page; each rule must reach them.
  await apply({
    'yt.player.hideAutoplayToggle': true, 'yt.player.hideNextButton': true, 'yt.player.hideSubtitlesButton': true, 'yt.player.hideCastButton': true,
    'yt.player.hideChapterTitle': true, 'yt.player.hideInfoCards': true, 'yt.player.hidePaidPromotion': true, 'yt.player.hideProgressPreviews': true, 'yt.player.hideEndscreenWall': true,
  });
  await expectHidden('player controls', ['.ytp-autonav-toggle', '.ytp-next-button', '.ytp-subtitles-button', '.ytp-remote-button', '.ytp-chapter-container', '.ytp-cards-button', '.ytp-cards-teaser', '.ytp-paid-content-overlay', '.ytp-tooltip-image', '.ytp-fullscreen-grid']);
  await expectShown('the player itself stays', ['#movie_player', '#player']);
  assert.ok((await rect('#movie_player')).w > 500, 'player size unchanged by control rules');

  // Panels and shelves under/next to the video: empty hosts exist; each rule must reach them.
  await apply({ 'yt.watch.hideLiveChat': true, 'yt.watch.hideShoppingShelf': true, 'yt.watch.hideTickets': true, 'yt.watch.hideMerch': true, 'yt.watch.hideFundraiser': true, 'yt.watch.hideInfoPanels': true, 'yt.watch.hidePlayerAds': true, 'yt.watch.hideAmbientMode': true });
  await expectHidden('panels and shelves', ['ytd-watch-flexy #chat-container', '#shopping-timely-shelf', 'ytd-watch-flexy #ticket-shelf', 'ytd-watch-flexy #donation-shelf', 'ytd-watch-flexy #clarify-box', '#player-ads', 'ytd-watch-flexy #cinematics-container'], { optional: true });
  await expectShown('related videos and player stay', ['#related', '#movie_player']);
  await apply({ 'yt.general.hideAds': true });
  await expectHidden('ad slots', ['#player-ads']);
  await expectShown('related videos stay with ads hidden', ['#related ytd-item-section-renderer, #related yt-lockup-view-model']);

  // Everything off again: the page is as it was.
  await apply({});
  await expectShown('everything back', ['#related', '#secondary', title]);
  await shot('watch-after');
});

group('watch: hiding related videos keeps the playlist panel and its column', async () => {
  await open('https://www.youtube.com/watch?v=LxQBJdyOvfc&list=PLsyeobzWxl7omDoEYrrf3oXvXxa6MPgek', { ready: 'ytd-watch-metadata' });
  await page.waitForSelector('ytd-playlist-panel-renderer#playlist:not([hidden])', { state: 'attached', timeout: 20_000 });
  await shot('watch-playlist-before');
  await expectShown('playlist panel and related before', ['ytd-playlist-panel-renderer#playlist', '#related', '#secondary']);
  await apply({ 'yt.watch.hideRelated': true });
  await expectHidden('related', ['ytd-watch-flexy #related']);
  await expectShown('the playlist panel stays, and so does its column', ['ytd-playlist-panel-renderer#playlist', '#secondary', '#movie_player']);
  await shot('watch-playlist-related-hidden');
  await apply({});
});

// ---------------------------------------------------------------------------------------------
// Channel
// ---------------------------------------------------------------------------------------------

group('channel: trailer, banner, header counts and Home rows hide; other tabs are untouched', async () => {
  await open('https://www.youtube.com/@MrBeast', { ready: 'yt-tab-shape' });
  await shot('channel-before');
  const channel = 'ytd-browse[page-subtype="channels"]';

  await apply({ 'yt.channel.hideBanner': true });
  await expectHidden('banner', [`${channel} #page-header-banner`]);
  await expectShown('channel name stays', [`${channel} h1`]);

  await apply({ 'yt.channel.hideSubscriberCount': true });
  await expectHidden('subscriber count', [`${channel} .ytPageHeaderViewModelContentMetadata .ytContentMetadataViewModelMetadataText:has(+ .ytContentMetadataViewModelDelimiter + .ytContentMetadataViewModelMetadataText:nth-last-child(1 of .ytContentMetadataViewModelMetadataText))`]);
  await expectShown('handle stays', [`${channel} .ytPageHeaderViewModelContentMetadata`]);

  const primary = `${channel} #primary`;
  const before = (await rect(primary)).h;
  await apply({ 'yt.channel.hideTrailer': true });
  await expectHidden('trailer', [`${channel} ytd-channel-video-player-renderer`], { optional: true });
  const afterTrailer = (await rect(primary)).h;
  assert.ok(afterTrailer <= before, 'hiding the trailer never makes the page taller');

  await apply({ 'yt.channel.hideHomeShelves': true });
  await expectHidden('home shelves', [`${channel} ytd-item-section-renderer`]);
  assert.ok((await rect(primary)).h < before - 200, 'the rows take their space with them');
  await expectShown('header and tabs stay', [`${channel} yt-tab-shape`, `${channel} h1`]);
  await shot('channel-after');

  // The same sections hold other tabs' content: with the setting on, the Videos tab must still show its videos.
  await page.locator(`${channel} yt-tab-shape[role="tab"]`).nth(1).click();
  await page.waitForURL(/\/videos/, { timeout: 15_000 });
  await page.waitForSelector(`${channel} ytd-rich-item-renderer`, { state: 'attached', timeout: 20_000 });
  await sleep(1500);
  await expectShown('the Videos tab keeps its videos', [`${channel} ytd-rich-item-renderer`]);
  await shot('channel-videos-with-home-rows-hidden');
  // Posts tab: its content lives in an item section, the very element the Home rule hides on the Home tab.
  await page.locator(`${channel} yt-tab-shape[role="tab"]`).nth(4).click();
  await page.waitForURL(/\/posts/, { timeout: 15_000 });
  await page.waitForSelector(`${channel} ytd-backstage-post-thread-renderer`, { state: 'attached', timeout: 20_000 }).catch(() => {});
  await sleep(1500);
  const posts = (await look([`${channel} ytd-backstage-post-thread-renderer`]))[`${channel} ytd-backstage-post-thread-renderer`];
  if (posts.count > 0) assert.ok(posts.someShown, 'the Posts tab keeps its posts');
  await apply({});
});

// ---------------------------------------------------------------------------------------------
// Shorts
// ---------------------------------------------------------------------------------------------

group('shorts: the player is shown when allowed, its small settings trim it', async () => {
  await open('https://www.youtube.com/shorts/C0STkNVChLI', { ready: 'ytd-shorts' });
  await apply({ 'yt.shorts.mode': 'allow' });
  await expectShown('Shorts player when allowed', ['ytd-shorts']);
  await shot('shorts-allowed');
  // Modes "block" and "watch" are not tried here: since the Phase 3b redirects they send the page somewhere else the
  // moment they are switched on (the blocked page, /watch), so the player cannot be observed hidden. The redirects are
  // checked in features.spec.mjs / tests/firefox/features.mjs, the hiding rule itself in tests/unit/youtube-schema.test.mjs.
  await apply({ 'yt.shorts.mode': 'allow', 'yt.shorts.hideComments': true, 'yt.shorts.hideLikeCounts': true, 'yt.shorts.hideSubscribe': true, 'yt.shorts.hideRemix': true });
  await expectShown('Shorts player stays with its buttons trimmed', ['ytd-shorts']);
  await expectHidden('Shorts buttons', ['ytd-shorts reel-action-bar-view-model > button-view-model:nth-of-type(1)', 'ytd-shorts yt-reel-channel-bar-view-model .ytReelChannelBarViewModelReelSubscribeButton', 'ytd-shorts reel-action-bar-view-model like-button-view-model .ytSpecButtonShapeWithLabelLabel'], { optional: true });
  const likeBtn = (await look(['ytd-shorts reel-action-bar-view-model like-button-view-model']))['ytd-shorts reel-action-bar-view-model like-button-view-model'];
  if (likeBtn.count > 0) assert.ok(likeBtn.someShown, 'the like button stays when only its count is hidden');
  await apply({ 'yt.comments.hideAll': true });
  await expectHidden('Shorts comments panel', ['ytd-shorts ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-comments-section"]']);
  await apply({});
});

// ---------------------------------------------------------------------------------------------
// Subscriptions (signed-out page: synthetic cards on the live page)
// ---------------------------------------------------------------------------------------------

group('subscriptions: Shorts, posts, live and watched cards hide as whole grid items (synthetic cards)', async () => {
  await open('https://www.youtube.com/feed/subscriptions', { ready: 'ytd-browse[page-subtype="subscriptions"]' });
  const host = 'ytd-browse[page-subtype="subscriptions"]';
  const card = (id, children = [], attrs = {}) => inject(host, 'ytd-rich-item-renderer', { 'data-test-id': id, ...attrs }, children);
  assert.ok(await card('short', [{ tag: 'a', attrs: { href: '/shorts/abcdefghijk' } }]));
  assert.ok(await card('post', [], { 'is-post': '' }));
  assert.ok(await card('live', [{ tag: 'badge-shape', attrs: { class: 'ytBadgeShapeThumbnailLive' } }]));
  assert.ok(await card('watched', [{ tag: 'yt-thumbnail-overlay-progress-bar-view-model' }]));
  assert.ok(await card('video', [{ tag: 'a', attrs: { href: '/watch?v=abcdefghijk' } }]));
  const display = (id) => page.evaluate((i) => getComputedStyle(document.querySelector(`[data-test-id="${i}"]`)).display, id);

  await apply({});
  for (const id of ['short', 'post', 'live', 'watched', 'video']) assert.notEqual(await display(id), 'none', `${id} shown with everything off`);
  for (const [setting, id] of [['yt.subs.hideShorts', 'short'], ['yt.subs.hidePosts', 'post'], ['yt.subs.hideLive', 'live'], ['yt.subs.hideWatched', 'watched']]) {
    await apply({ [setting]: true });
    for (const other of ['short', 'post', 'live', 'watched', 'video']) {
      if (other === id) assert.equal(await display(other), 'none', `${setting} hides the ${other} card`);
      else assert.notEqual(await display(other), 'none', `${setting} must not hide the ${other} card`);
    }
  }
  // General "hide watched" must not touch the subscriptions-only cards of other kinds.
  await apply({ 'yt.general.hideWatched': true });
  assert.equal(await display('watched'), 'none');
  assert.notEqual(await display('video'), 'none');
  await apply({});
});

// ---------------------------------------------------------------------------------------------
// Legacy renderers (hashtag pages still use ytd-rich-grid-media cards)
// ---------------------------------------------------------------------------------------------

group('hashtag page: legacy card renderers get the same card settings and thumbnail modes', async () => {
  await open('https://www.youtube.com/hashtag/cooking', { ready: 'ytd-rich-grid-media' });
  const card = 'ytd-rich-item-renderer ytd-rich-grid-media';
  await expectShown('legacy cards', [card, `${card} a#video-title-link`]);
  await apply({ 'yt.general.hideViewCounts': true, 'yt.general.hideChannelAvatars': true, 'yt.general.hideDurations': true });
  await expectHidden('legacy view counts, avatars, durations', [`${card} #metadata-line > span.inline-metadata-item:nth-of-type(1)`, `${card} #avatar-container`, `${card} ytd-thumbnail-overlay-time-status-renderer`]);
  await expectShown('legacy titles and dates stay', [`${card} a#video-title-link`, `${card} #metadata-line > span.inline-metadata-item:nth-of-type(2)`]);
  await apply({ 'yt.general.thumbnails': 'blur', 'yt.general.disableHoverPreview': true });
  await expectComputed('legacy blur', `${card} ytd-thumbnail img`, 'filter', /^blur/);
  await page.hover(`${card} ytd-thumbnail`);
  await expectComputed('legacy cards reveal on hover as well', `${card} ytd-thumbnail img`, 'filter', 'none');
  await page.mouse.move(5, 500);
  await shot('hashtag-legacy-cards');
  await apply({});
});

// ---------------------------------------------------------------------------------------------
// Coverage
// ---------------------------------------------------------------------------------------------

test('coverage: every section of the catalog was exercised on the live site; the rest is listed', async (t) => {
  if (skippedGroups.length) return t.skip(`incomplete run (captcha skipped: ${skippedGroups.join('; ')})`);
  const registry = await readCatalog();
  const sections = [...new Set(registry.map((d) => d.section))];
  const untestedSections = sections.filter((s) => !registry.some((d) => d.section === s && covered.has(d.id)));
  const skipped = registry.filter((d) => !covered.has(d.id));
  const bridge = skipped.filter((d) => d.feature === 'bridgeTags').map((d) => d.id);
  const js = skipped.filter((d) => d.feature && d.feature !== 'bridgeTags' && d.hide === undefined && d.rules === undefined && d.variants === undefined).map((d) => d.id);
  const rest = skipped.filter((d) => !bridge.includes(d.id) && !js.includes(d.id)).map((d) => d.id);
  t.diagnostic(`${covered.size} of ${registry.length} settings exercised live`);
  t.diagnostic(`bridge-tag settings (Phase 3b): ${bridge.length}`);
  t.diagnostic(`JS-only settings (their own phases): ${js.length}`);
  t.diagnostic(`CSS settings not hit by this run (signed-in only or absent from the sample pages): ${rest.join(', ')}`);
  // Sections that only hold JS/bridge settings (Filters) are exempt.
  const exempt = new Set(['yt.filters']);
  assert.deepEqual(untestedSections.filter((s) => !exempt.has(s)), [], 'every section with CSS must have at least one live check');
});

/** The catalog, read through the same loader the unit tests use (Node side; the page never sees it). */
async function readCatalog() {
  const { loadAtPeace, installFakeBrowser, uninstallFakeBrowser, CORE_SCRIPTS, SCHEMA_SCRIPTS, YOUTUBE_SCRIPTS } = await import('../unit/_load.mjs');
  installFakeBrowser();
  try {
    const AP = await loadAtPeace([...CORE_SCRIPTS, ...SCHEMA_SCRIPTS, YOUTUBE_SCRIPTS[1]]);
    return AP.schema.all().filter((d) => AP.schema.siteOf(d.id) === 'youtube' && !d.id.startsWith('yt.general.temp'));
  } finally {
    uninstallFakeBrowser();
  }
}
