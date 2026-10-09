// Performance and robustness (Chromium, offline YouTube snapshots: no traffic to Google, deterministic).
// The numbers are printed as diagnostics and written to tests/e2e/artifacts/perf.json; docs/PERFORMANCE.md
// quotes them. The assertions are budgets with a wide margin (they catch a regression of an order of
// magnitude, not noise) and exact checks for leaks.
//
//   1. Startup: from document_start to the tokens being on <html>, and what compiling the stylesheet costs.
//   2. The mutation bus: the CPU time spent in OUR scripts (V8 sampling profiler, filtered to the extension's
//      files) while a long search page keeps growing and scrolling, with every observing feature switched on
//      and with none.
//   3. Leaks: listeners, observers and intervals that the extension's isolated world holds after 20 SPA
//      navigations and after switching every feature off and on again (tests/helpers/instrument.js counts them).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launch, close, getContext, getExtensionId, setStorage, evalInExtension, openExtPage, trackErrors, ARTIFACTS } from './harness.mjs';
import { fixturesAvailable, installYouTubeFixtures } from './_yt-fixture.mjs';
import { until, sleep } from '../helpers/wait.mjs';

const HAVE = fixturesAvailable(['home', 'search-lofi', 'watch-chapters', 'channel-videos']);
const skip = HAVE ? false : 'research snapshots are absent (tests/e2e/artifacts/research is local only; tools/yt-probe.mjs writes them)';

const results = {};
let page;

before(async () => {
  if (!HAVE) return;
  await launch({ instrument: true });
  await installYouTubeFixtures(getContext());
  await mkdir(ARTIFACTS, { recursive: true });
  page = trackErrors(await getContext().newPage());
  await page.setViewportSize({ width: 1440, height: 900 });
});

after(async () => {
  if (HAVE) await writeFile(join(ARTIFACTS, 'perf.json'), JSON.stringify(results, null, 2));
  await close();
});

const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
const round = (n, digits = 1) => Math.round(n * 10 ** digits) / 10 ** digits;

/** Every observing feature, and the ones with listeners, switched on (nothing that would redirect the page). */
const HEAVY = {
  'yt.general.disableHoverPreview': true,
  'yt.general.hideViewCounts': true,
  'yt.general.thumbnails': 'blur',
  'yt.home.feedMode': 'hide',
  'yt.shorts.mode': 'watch',
  'yt.channel.openVideosTab': true,
  'yt.channel.hideTrailer': true,
  'yt.channel.hideShortsTab': true,
  'yt.guide.hideWatchLater': true,
  'yt.guide.hideShorts': true,
  'yt.watch.disableAutoplay': true,
  'yt.watch.noAutoStart': true,
  'yt.watch.autoTheater': true,
  'yt.watch.defaultSpeed': '1.5',
  'yt.watch.dismissStillWatching': true,
  'yt.watch.hideRelated': true,
  'yt.watch.hideClip': true,
  'yt.masthead.hideSearchSuggestions': true,
};

/** The background rewrites its redirect rules a moment after a settings change; a page load before that is sent to the pause page. */
const pauseRuleGone = () => until(() => evalInExtension(async () => !(await chrome.declarativeNetRequest.getDynamicRules()).some((r) => String(r.action.redirect?.regexSubstitution).includes('/pause/'))), { what: 'the pause rule to go' });

async function configure(settings) {
  await setStorage({ settings });
  await pauseRuleGone();
  await page.bringToFront();
}

/** The extension's own files are the only ones whose time counts as ours. */
const ours = (url) => url.startsWith(`chrome-extension://${getExtensionId()}/`);

// ---------------------------------------------------------------------------------------------
// 1. Startup
// ---------------------------------------------------------------------------------------------

/** Runs in the page before any script: stamps when <html> first exists, when our style and tokens appear. */
function stampInPage() {
  const stamps = (window.__apStamps = { init: performance.now() });
  const check = () => {
    const html = document.documentElement;
    if (!html) return;
    stamps.loaded ??= html.hasAttribute('data-at-peace-loaded') ? performance.now() : undefined;
    stamps.style ??= document.getElementById('at-peace-style') ? performance.now() : undefined;
    stamps.tokens ??= html.getAttribute('data-at-peace') !== null ? performance.now() : undefined;
  };
  new MutationObserver(check).observe(document, { subtree: true, childList: true, attributes: true });
  check();
}

test('startup: tokens are on <html> a few milliseconds after document_start; the stylesheet compiles in milliseconds', { skip }, async (t) => {
  // The biggest preset, minus its home redirect (the snapshot server has no Subscriptions page to answer it).
  await evalInExtension(async () => {
    const { settings } = globalThis.AtPeace;
    await settings.applyPreset('deep-work');
    await settings.save({ 'yt.home.feedMode': 'hide', 'pause.enabled': false }); // the preset also turns Mindful Pause on
  });
  await pauseRuleGone();
  await page.addInitScript(stampInPage);
  const rows = [];
  for (const url of ['https://www.youtube.com/', 'https://www.youtube.com/results?search_query=lofi', 'https://www.youtube.com/watch?v=abc']) {
    const samples = [];
    for (let i = 0; i < 7; i++) {
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      await until(() => page.evaluate(() => window.__apStamps?.tokens !== undefined), { what: `tokens on ${url}` });
      samples.push(await page.evaluate(() => window.__apStamps));
    }
    const delta = (key) => median(samples.map((s) => s[key] - s.init));
    // The wall time above includes the snapshot's own inline script (up to 1.7 MB of JSON to parse on the same
    // thread), so also measure how much CPU OUR scripts use between the navigation and the tokens.
    const cpu = [];
    let top = [];
    for (let i = 0; i < 5; i++) {
      const profile = await profileOurs(async () => {
        await page.goto(url, { waitUntil: 'domcontentloaded' });
        await until(() => page.evaluate(() => window.__apStamps?.tokens !== undefined), { what: `tokens on ${url} (profiled)` }).catch(async (err) => {
          throw new Error(`${err.message}: ${page.url()} ${JSON.stringify(await page.evaluate(() => [window.__apStamps, document.documentElement.getAttribute('data-at-peace')]))}`);
        });
      });
      cpu.push(profile.ourMs);
      top = profile.top;
    }
    rows.push({ url: new URL(url).pathname, styleMs: round(delta('style')), tokensMs: round(delta('tokens')), loadedMs: round(delta('loaded')), ourCpuMs: round(median(cpu)), top });
  }
  results.startup = rows;
  await configure({});

  // The compile itself, cold (first call in a fresh context) and warm (median of 30).
  const ext = await openExtPage('src/pages/options/options.html');
  const compile = await ext.evaluate(() => {
    const AP = globalThis.AtPeace;
    const time = () => {
      const t0 = performance.now();
      const css = AP.schema.compileCss('youtube');
      return { ms: performance.now() - t0, bytes: css.length, rules: css.split('\n').filter((l) => l.includes('{')).length };
    };
    const first = time();
    const warm = Array.from({ length: 30 }, () => time().ms).sort((a, b) => a - b);
    const t0 = performance.now();
    AP.schema.tokensFor(AP.schema.defaults(), 'youtube');
    return { firstMs: first.ms, warmMs: warm[15], bytes: first.bytes, rules: first.rules, tokensMs: performance.now() - t0 };
  });
  await ext.close();
  results.compile = { firstMs: round(compile.firstMs), warmMedianMs: round(compile.warmMs), kib: round(compile.bytes / 1024, 0), rulesApprox: compile.rules };

  for (const r of rows) t.diagnostic(`${r.url}: style in <head> +${r.styleMs} ms, tokens +${r.tokensMs} ms (median of 7); our CPU ${r.ourCpuMs} ms (median of 5): ${r.top.join('; ')}`);
  t.diagnostic(`compileCss('youtube'): first call ${results.compile.firstMs} ms, warm ${results.compile.warmMedianMs} ms, ${results.compile.kib} KiB`);
  for (const r of rows) assert.ok(r.tokensMs < 500, `${r.url}: tokens applied within 500 ms of document_start (was ${r.tokensMs})`);
  assert.ok(results.compile.firstMs < 250, `a cold compile is under 250 ms (was ${results.compile.firstMs})`);
});

// ---------------------------------------------------------------------------------------------
// 2. The mutation bus
// ---------------------------------------------------------------------------------------------

/** CPU time in the extension's files while `work` runs, from V8's sampling profiler. */
async function profileOurs(work) {
  const cdp = await getContext().newCDPSession(page);
  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 100 }); // µs
  await cdp.send('Profiler.start');
  const started = Date.now();
  await work();
  const seconds = (Date.now() - started) / 1000;
  const { profile } = await cdp.send('Profiler.stop');
  await cdp.detach();

  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  let ourMicros = 0;
  const perFunction = new Map();
  profile.samples.forEach((id, i) => {
    const node = byId.get(id);
    const micros = profile.timeDeltas[i] ?? 0;
    if (!node || !ours(node.callFrame.url)) return;
    ourMicros += micros;
    const key = `${node.callFrame.functionName || '(anonymous)'} ${node.callFrame.url.split('/').slice(-1)[0]}:${node.callFrame.lineNumber + 1}`;
    perFunction.set(key, (perFunction.get(key) ?? 0) + micros);
  });
  const top = [...perFunction].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, micros]) => `${name} ${round(micros / 1000)} ms`);
  return { seconds, ourMs: ourMicros / 1000, top };
}

/** Grows a search page the way infinite scroll does: `batches` batches of `size` cards, `gap` ms apart, scrolling with them. */
async function growSearchPage({ batches, size, gap }) {
  for (let i = 0; i < batches; i++) {
    await page.evaluate(
      ({ n, size: count }) => {
        const first = document.querySelector('ytd-search ytd-video-renderer');
        const list = first.parentElement;
        for (let k = 0; k < count; k++) {
          const card = first.cloneNode(true);
          const title = card.querySelector('a#video-title, #video-title');
          if (title) title.textContent = `Card ${n}-${k} THIS IS ABSOLUTELY AMAZING and NASA agrees`;
          list.appendChild(card);
        }
        window.scrollBy(0, 600);
      },
      { n: i, size },
    );
    await sleep(gap);
  }
}

async function openSearch() {
  await page.goto('https://www.youtube.com/results?search_query=lofi', { waitUntil: 'domcontentloaded' });
  await until(() => page.evaluate(() => document.documentElement.getAttribute('data-fixture-ready') === '1' && document.documentElement.getAttribute('data-at-peace') !== null), { what: 'the search snapshot and the engine' });
}

test('mutation bus: our scripts cost a few percent of one core on a growing search page, and nothing when no feature needs it', { skip }, async (t) => {
  const load = { batches: 24, size: 10, gap: 250 }; // 240 cards in 6 s, about 40 cards a second, scrolling all the while
  const run = async (label, settings) => {
    await configure(settings);
    await openSearch();
    const before = await page.evaluate(() => document.querySelectorAll('ytd-video-renderer').length);
    const profile = await profileOurs(() => growSearchPage(load));
    const added = (await page.evaluate(() => document.querySelectorAll('ytd-video-renderer').length)) - before;
    const row = { label, cards: added, seconds: round(profile.seconds), ourMs: round(profile.ourMs), msPerSecond: round(profile.ourMs / profile.seconds), top: profile.top };
    t.diagnostic(`${label}: ${row.ourMs} ms of our code in ${row.seconds} s (${row.msPerSecond} ms/s) for ${added} cards; top: ${profile.top.join('; ')}`);
    return row;
  };
  const quiet = await run('no observing feature', {});
  const heavy = await run('every feature on', HEAVY);
  results.mutationBus = { load, quiet, heavy };
  assert.ok(heavy.cards >= 200, 'the page really grew');
  assert.ok(quiet.msPerSecond < 25, `with nothing to do our scripts stay near idle (${quiet.msPerSecond} ms/s)`);
  assert.ok(heavy.msPerSecond < 250, `with every feature on we use under a quarter of one core (${heavy.msPerSecond} ms/s)`);
});

// ---------------------------------------------------------------------------------------------
// 3. Leaks
// ---------------------------------------------------------------------------------------------

const sample = async () => {
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('ap-instr-sample')));
  return JSON.parse(await page.evaluate(() => document.documentElement.getAttribute('data-ap-instr')));
};

/** An in-app navigation as YouTube's router performs it (events and history, no new document). */
async function spaNavigate(path, expectedPage) {
  await page.evaluate((to) => {
    window.dispatchEvent(new CustomEvent('yt-navigate-start', { detail: { url: to } }));
    history.pushState({}, '', to);
    window.dispatchEvent(new CustomEvent('yt-navigate-finish'));
    window.dispatchEvent(new CustomEvent('yt-page-data-updated'));
  }, path);
  await until(() => page.evaluate((want) => document.documentElement.getAttribute('data-at-peace-page') === want && !document.documentElement.hasAttribute('data-at-peace-next'), expectedPage), { what: `page=${expectedPage}` });
}

const TOUR = [
  ['/results?search_query=lofi', 'search'],
  ['/watch?v=abcdefghijk', 'watch'],
  ['/@MrBeast/videos', 'channel'],
  ['/', 'home'],
  ['/feed/history', 'history'],
];

test('leaks: 20 SPA navigations and 10 rounds of every feature off and on leave no listener, observer or interval behind', { skip }, async (t) => {
  await configure(HEAVY);
  await page.goto('https://www.youtube.com/', { waitUntil: 'domcontentloaded' });
  await until(() => page.evaluate(() => document.documentElement.getAttribute('data-fixture-ready') === '1' && document.documentElement.getAttribute('data-at-peace') !== null), { what: 'the home snapshot and the engine' });
  await sleep(400);
  const start = await sample();

  const afterTour = [];
  for (let i = 0; i < 20; i++) {
    const [path, pageName] = TOUR[i % TOUR.length];
    await spaNavigate(path, pageName);
    if (i % TOUR.length === TOUR.length - 1) {
      await sleep(150);
      afterTour.push(await sample());
    }
  }
  const summary = (s) => `${s.listeners} listeners ${JSON.stringify(s.observers)} observers ${s.intervals} intervals`;
  t.diagnostic(`at start: ${summary(start)}`);
  afterTour.forEach((s, i) => t.diagnostic(`after ${(i + 1) * TOUR.length} navigations: ${summary(s)}`));
  const [firstTour, ...laterTours] = afterTour;
  for (const later of laterTours) {
    assert.equal(later.listeners, firstTour.listeners, `listeners did not grow between tours: ${JSON.stringify(later.byType)} vs ${JSON.stringify(firstTour.byType)}`);
    assert.deepEqual(later.observers, firstTour.observers, 'observers did not grow between tours');
    assert.equal(later.intervals, firstTour.intervals, 'intervals did not grow between tours');
  }

  // Every feature off, then on, ten times: back to exactly the same counts each time.
  await spaNavigate('/watch?v=abcdefghijk', 'watch');
  await sleep(150);
  const onBefore = await sample();
  await configure({});
  await sleep(300);
  const offBefore = await sample();
  for (let round_ = 0; round_ < 10; round_++) {
    await configure(HEAVY);
    await sleep(250);
    await configure({});
    await sleep(250);
  }
  const offAfter = await sample();
  await configure(HEAVY);
  await sleep(400);
  const onAfter = await sample();
  t.diagnostic(`features off: ${summary(offBefore)} → after 10 rounds: ${summary(offAfter)}; on: ${summary(onBefore)} → ${summary(onAfter)}`);
  assert.equal(offAfter.listeners, offBefore.listeners, `listeners with every feature off did not grow: ${JSON.stringify(offAfter.byType)} vs ${JSON.stringify(offBefore.byType)}`);
  assert.deepEqual(offAfter.observers, offBefore.observers, 'observers with every feature off did not grow');
  assert.equal(offAfter.intervals, offBefore.intervals, 'intervals with every feature off did not grow');
  assert.equal(onAfter.listeners, onBefore.listeners, `listeners with every feature on did not grow: ${JSON.stringify(onAfter.byType)} vs ${JSON.stringify(onBefore.byType)}`);
  assert.deepEqual(onAfter.observers, onBefore.observers, 'observers with every feature on did not grow');
  assert.equal(onAfter.intervals, onBefore.intervals, 'intervals with every feature on did not grow');
  assert.ok((offBefore.observers.MutationObserver ?? 0) <= 1, `with every feature off only the engine's own style guard observes (${JSON.stringify(offBefore.observers)})`);
  results.leaks = { start, afterTours: afterTour, featuresOff: { before: offBefore, after: offAfter }, featuresOn: { before: onBefore, after: onAfter } };

  const diagnostics = await page.evaluate(() => document.documentElement.getAttribute('data-ap-instr') !== null);
  assert.ok(diagnostics);
  assert.deepEqual(page.errors.filter((e) => e.includes('[At Peace]') || e.includes('chrome-extension://')), [], 'no errors from our code');
});
