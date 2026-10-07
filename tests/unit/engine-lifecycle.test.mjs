// The engine end to end on a fake DOM: styles, attributes, live settings, navigation (including the
// anti-flicker `data-at-peace-next` handshake), feature lifecycle and the mutation bus.
import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { uninstallFakeBrowser } from './_load.mjs';
import { freshWorld } from './_fixtures.mjs';
import { createEnv, navEvent, flush, FakeMutationObserver } from './_fake-dom.mjs';

let AP;
let fake;
let running = null; // the engine under test, stopped in afterEach

beforeEach(async () => {
  ({ AP, fake } = await freshWorld({ engine: true }));
  mock.method(console, 'warn', () => {});
});

afterEach(() => {
  running?.stop();
  running = null;
  AP?.engine.stop();
  mock.restoreAll();
  mock.timers.reset();
  uninstallFakeBrowser();
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(predicate, ms = 1000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (predicate()) return;
    await sleep(3);
  }
  assert.fail('timed out waiting for condition');
}

/** Starts an engine on a fake DOM and waits until the first settings have been applied. */
async function boot({ href = 'https://www.youtube.com/', stored, features = [], config = {} } = {}) {
  const { doc, win, env } = createEnv(href);
  if (stored) await fake.storage.local.set({ settings: stored });
  running = AP.engine.start({
    site: 'youtube',
    detectPage: AP.yt.page.detect,
    features,
    navStartEvents: ['yt-navigate-start'],
    navEvents: ['yt-navigate-finish', 'yt-page-data-updated'],
    targetUrl: AP.yt.page.urlFromNavigateEvent,
    env,
    ...config,
  });
  await waitFor(() => running.ctx.settings !== null);
  const html = doc.documentElement;
  const attr = (name) => html.getAttribute(name);
  return { doc, win, html, attr, engine: running, ctx: running.ctx, inspect: () => running.inspect() };
}

/** Saves settings through the real API and waits for the engine to have applied them. */
async function change(world, patch) {
  const before = world.ctx.settings;
  await AP.settings.save(patch);
  await waitFor(() => world.ctx.settings !== before);
}

/** Simulates YouTube's SPA navigation: start (target known) → pushState → finish. */
function startNavigation(world, targetUrl) {
  world.win.dispatchEvent(navEvent('yt-navigate-start', { url: targetUrl }));
}
function finishNavigation(world, targetUrl) {
  world.win.pushState(targetUrl);
  world.win.dispatchEvent(navEvent('yt-navigate-finish', { url: targetUrl }));
}

function recorder(id, settings, extra = {}) {
  const calls = [];
  const feature = {
    id,
    settings,
    calls,
    init: (ctx) => calls.push(['init', ctx.page]),
    onSettings: (ctx, ids) => calls.push(['onSettings', ids]),
    onNavigate: (ctx) => calls.push(['onNavigate', ctx.page, ctx.navEvent]),
    onMutations: (ctx, roots) => calls.push(['onMutations', roots.map((r) => r.tagName)]),
    destroy: () => calls.push(['destroy']),
    ...extra,
  };
  return feature;
}

describe('styles and attributes', () => {
  test('injects the compiled stylesheet and a dynamic one under <html>, and sets page + tokens', async () => {
    const w = await boot({ href: 'https://www.youtube.com/results?search_query=x', stored: { 'yt.general.hideAds': true } });
    const style = w.doc.getElementById('at-peace-style');
    assert.ok(style?.isConnected);
    assert.equal(style.parentNode, w.html);
    assert.equal(style.textContent, AP.schema.compileCss('youtube'));
    assert.equal(style.getAttribute('data-rules'), String(AP.schema.compileRules('youtube').length));
    assert.ok(style.textContent.includes('html[data-at-peace~="yt.general.hideAds"] .ad-slot'));
    const dynamic = w.doc.getElementById('at-peace-dynamic');
    assert.ok(dynamic?.isConnected);
    assert.equal(dynamic.textContent, '');
    assert.equal(w.attr('data-at-peace-page'), 'search');
    const tokens = w.attr('data-at-peace').split(' ');
    assert.equal(tokens[0], 'general.enabled');
    assert.ok(tokens.includes('yt.general.hideAds'));
    assert.ok(tokens.includes('yt.general.thumbnails=show'), 'selects are always listed, default included');
    assert.equal(w.attr('data-at-peace-next'), null);
  });

  test('the page attribute is there before the settings load (page-scoped rules need it at once)', async () => {
    const { doc, win, env } = createEnv('https://www.youtube.com/watch?v=1');
    let resolveGet;
    const realGet = fake.storage.local.get.bind(fake.storage.local);
    fake.storage.local.get = (...args) => new Promise((resolve) => (resolveGet = () => resolve(realGet(...args))));
    running = AP.engine.start({ site: 'youtube', detectPage: AP.yt.page.detect, env });
    assert.equal(doc.documentElement.getAttribute('data-at-peace-page'), 'watch');
    assert.ok(doc.getElementById('at-peace-style'));
    assert.equal(doc.documentElement.getAttribute('data-at-peace'), null, 'no tokens until settings are known');
    resolveGet();
    await waitFor(() => running.ctx.settings !== null);
    assert.ok(doc.documentElement.getAttribute('data-at-peace').startsWith('general.enabled'));
    void win;
  });

  test('master switch off: tokens are empty (attribute present), the dynamic sheet is empty', async () => {
    const rules = [{ id: 'r1', selector: '#x', page: null, note: '', createdAt: 1 }];
    const w = await boot({ stored: { 'general.enabled': false, 'yt.general.hideAds': true, 'advanced.customRules': rules } });
    assert.equal(w.attr('data-at-peace'), '');
    assert.equal(w.doc.getElementById('at-peace-dynamic').textContent, '');
    assert.deepEqual(w.inspect().tokens, []);
    // turning it back on restores everything, live
    await change(w, { 'general.enabled': true });
    assert.ok(w.attr('data-at-peace').startsWith('general.enabled '));
    assert.ok(w.attr('data-at-peace').includes('yt.general.hideAds'));
    assert.ok(w.doc.getElementById('at-peace-dynamic').textContent.includes('#x'));
  });

  test('settings changes update tokens and the dynamic sheet live; an unchanged token list is not rewritten', async () => {
    const w = await boot();
    const writes = [];
    const original = w.html.setAttribute.bind(w.html);
    w.html.setAttribute = (name, value) => {
      writes.push(name);
      original(name, value);
    };
    await change(w, { 'yt.general.hideAds': true, 'yt.general.thumbnails': 'hide' });
    assert.ok(w.attr('data-at-peace').includes('yt.general.hideAds'));
    assert.ok(w.attr('data-at-peace').includes('yt.general.thumbnails=hide'));
    assert.deepEqual(writes, ['data-at-peace']);
    writes.length = 0;
    await change(w, { 'pause.breathSeconds': 10 }); // not a token
    assert.deepEqual(writes, [], 'no attribute write when tokens did not change');

    await change(w, { 'advanced.customRules': [{ id: 'r1', selector: 'ytd-masthead #logo', page: 'home', note: '', createdAt: 1 }] });
    assert.equal(
      w.doc.getElementById('at-peace-dynamic').textContent,
      'html[data-at-peace~="general.enabled"]:is([data-at-peace-page="home"],[data-at-peace-next="home"]) ytd-masthead #logo { display: none !important; }',
    );
    await change(w, { 'advanced.customRules': [] });
    assert.equal(w.doc.getElementById('at-peace-dynamic').textContent, '', 'removing the last rule empties the sheet');
  });

  test('AP.debug follows advanced.debug as settings arrive', async () => {
    const w = await boot();
    assert.equal(AP.debug, false);
    await change(w, { 'advanced.debug': true });
    assert.equal(AP.debug, true);
  });

  test('a stylesheet YouTube removes is put back', async () => {
    const w = await boot();
    const style = w.doc.getElementById('at-peace-style');
    style.remove();
    assert.equal(style.isConnected, false);
    await flush();
    await flush();
    assert.equal(style.isConnected, true, 'static sheet re-inserted');
    const dynamic = w.doc.getElementById('at-peace-dynamic');
    dynamic.remove();
    await flush();
    await flush();
    assert.equal(dynamic.isConnected, true);
    assert.equal(w.inspect().stylesConnected, true);
  });

  test('starting twice replaces the first engine instead of stacking sheets and listeners', async () => {
    const { doc, win, env } = createEnv();
    const config = { site: 'youtube', detectPage: AP.yt.page.detect, navEvents: ['yt-navigate-finish'], env };
    const first = AP.engine.start(config);
    const second = AP.engine.start(config);
    running = second;
    await waitFor(() => second.ctx.settings !== null);
    assert.equal(first.inspect().started, false);
    assert.equal(doc.documentElement.children.filter((c) => c.id === 'at-peace-style').length, 1);
    win.pushState('/results?search_query=x');
    win.dispatchEvent(navEvent('yt-navigate-finish', {}));
    assert.equal(doc.documentElement.getAttribute('data-at-peace-page'), 'search');
  });

  test('an existing style element with our id is reused', async () => {
    const { doc, env } = createEnv();
    const old = doc.createElement('style');
    old.id = 'at-peace-style';
    old.textContent = 'stale';
    doc.documentElement.appendChild(old);
    running = AP.engine.start({ site: 'youtube', detectPage: AP.yt.page.detect, env });
    assert.equal(doc.getElementById('at-peace-style'), old);
    assert.equal(old.textContent, AP.schema.compileCss('youtube'));
  });

  test('the site can add dynamic CSS from settings', async () => {
    const w = await boot({ stored: { 'pause.breathSeconds': 9 }, config: { dynamicCss: (s) => `:root { --breath: ${s['pause.breathSeconds']}s }` } });
    assert.equal(w.doc.getElementById('at-peace-dynamic').textContent, ':root { --breath: 9s }');
  });

  test('if settings cannot be read the engine falls back to defaults and says so', async () => {
    fake.storage.local.get = () => Promise.reject(new Error('Extension context invalidated.'));
    const { env } = createEnv();
    running = AP.engine.start({ site: 'youtube', detectPage: AP.yt.page.detect, env });
    await waitFor(() => running.ctx.settings !== null);
    assert.equal(running.ctx.settings['general.enabled'], true);
    assert.ok(console.warn.mock.calls.some((c) => /could not read settings/.test(String(c.arguments[1]))));
  });

  test('a transient read failure at startup is retried, not mistaken for "no settings"', async () => {
    await fake.storage.local.set({ settings: { 'yt.general.hideAds': true } });
    const real = fake.storage.local.get.bind(fake.storage.local);
    let calls = 0;
    fake.storage.local.get = (...args) => (++calls === 1 ? Promise.reject(new Error('An unexpected error occurred')) : real(...args));
    const { doc, env } = createEnv();
    running = AP.engine.start({ site: 'youtube', detectPage: AP.yt.page.detect, env });
    await waitFor(() => running.ctx.settings !== null);
    assert.equal(running.ctx.settings['yt.general.hideAds'], true);
    assert.ok(doc.documentElement.getAttribute('data-at-peace').includes('yt.general.hideAds'));
  });

  test('inspect() reports a snapshot; AP.engine.inspect() reaches the running engine', async () => {
    const w = await boot({ href: 'https://www.youtube.com/feed/history' });
    const snap = AP.engine.inspect();
    assert.equal(snap.started, true);
    assert.equal(snap.site, 'youtube');
    assert.equal(snap.page, 'history');
    assert.equal(snap.attrPage, 'history');
    assert.equal(snap.nextPage, null);
    assert.equal(snap.url, 'https://www.youtube.com/feed/history');
    assert.equal(snap.ruleCount, AP.schema.compileRules('youtube').length);
    assert.equal(snap.observing, false);
    assert.deepEqual(w.inspect().features, []);
  });
});

describe('navigation and the page attribute', () => {
  test('navigate-start announces the target in data-at-peace-next and leaves the committed page alone; finish commits it', async () => {
    const w = await boot({ href: 'https://www.youtube.com/' });
    assert.equal(w.attr('data-at-peace-page'), 'home');

    startNavigation(w, '/results?search_query=lofi');
    assert.equal(w.attr('data-at-peace-page'), 'home', 'old page keeps its rules until it is gone');
    assert.equal(w.attr('data-at-peace-next'), 'search', 'target page rules are active from the start');
    assert.equal(w.ctx.page, 'home', 'features still see the committed page');

    finishNavigation(w, '/results?search_query=lofi');
    assert.equal(w.attr('data-at-peace-page'), 'search');
    assert.equal(w.attr('data-at-peace-next'), null);
    assert.equal(w.ctx.page, 'search');
    assert.equal(w.ctx.url, 'https://www.youtube.com/results?search_query=lofi');
  });

  test('the whole home → search → watch → home journey', async () => {
    const w = await boot();
    const seen = [];
    for (const [target, expected] of [['/results?search_query=x', 'search'], ['/watch?v=abc', 'watch'], ['/', 'home'], ['/@mkbhd/videos', 'channel'], ['/shorts/xyz', 'shorts']]) {
      startNavigation(w, target);
      assert.equal(w.attr('data-at-peace-next'), expected);
      finishNavigation(w, target);
      seen.push(w.attr('data-at-peace-page'));
      assert.equal(w.attr('data-at-peace-next'), null);
    }
    assert.deepEqual(seen, ['search', 'watch', 'home', 'channel', 'shorts']);
  });

  test('target detail may be absolute or the endpoint metadata; an unreadable detail announces nothing', async () => {
    const w = await boot();
    w.win.dispatchEvent(navEvent('yt-navigate-start', { endpoint: { commandMetadata: { webCommandMetadata: { url: '/feed/subscriptions' } } } }));
    assert.equal(w.attr('data-at-peace-next'), 'subscriptions');
    finishNavigation(w, '/feed/subscriptions');
    w.win.dispatchEvent(navEvent('yt-navigate-start', { url: 'https://www.youtube.com/playlist?list=WL' }));
    assert.equal(w.attr('data-at-peace-next'), 'playlist');
    finishNavigation(w, '/playlist?list=WL');
    w.win.dispatchEvent(navEvent('yt-navigate-start', null));
    assert.equal(w.attr('data-at-peace-next'), null);
  });

  test('navigating to the same page type announces nothing (nothing to pre-arm)', async () => {
    const w = await boot({ href: 'https://www.youtube.com/results?search_query=a' });
    startNavigation(w, '/results?search_query=b');
    assert.equal(w.attr('data-at-peace-next'), null);
  });

  test('a start event for another origin or the current URL is ignored', async () => {
    const w = await boot({ href: 'https://www.youtube.com/watch?v=1' });
    startNavigation(w, 'https://example.com/results?search_query=x');
    assert.equal(w.attr('data-at-peace-next'), null);
    startNavigation(w, 'https://www.youtube.com/watch?v=1');
    assert.equal(w.attr('data-at-peace-next'), null);
  });

  test('a second start before finish retargets', async () => {
    const w = await boot();
    startNavigation(w, '/results?search_query=x');
    startNavigation(w, '/watch?v=1');
    assert.equal(w.attr('data-at-peace-next'), 'watch');
    finishNavigation(w, '/watch?v=1');
    assert.equal(w.attr('data-at-peace-page'), 'watch');
  });

  test('yt-page-data-updated, popstate and persisted pageshow also commit from location', async () => {
    const w = await boot();
    w.win.pushState('/results?search_query=x');
    w.win.dispatchEvent(navEvent('yt-page-data-updated', { pageType: 'search' }));
    assert.equal(w.attr('data-at-peace-page'), 'search');

    startNavigation(w, '/');
    w.win.pushState('/');
    w.win.dispatchEvent(new Event('popstate'));
    assert.equal(w.attr('data-at-peace-page'), 'home');
    assert.equal(w.attr('data-at-peace-next'), null);

    w.win.pushState('/feed/history');
    w.win.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: false }));
    assert.equal(w.attr('data-at-peace-page'), 'home', 'a normal pageshow is not a navigation');
    w.win.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
    assert.equal(w.attr('data-at-peace-page'), 'history');
  });

  describe('Navigation API as a second source for the target', () => {
    const navigate = (w, url, props = {}) =>
      w.win.navigation.dispatchEvent(Object.assign(new Event('navigate'), { destination: { url }, navigationType: 'push', hashChange: false, ...props }));

    test('a push to a different page announces its page', async () => {
      const w = await boot();
      navigate(w, 'https://www.youtube.com/results?search_query=x');
      assert.equal(w.attr('data-at-peace-next'), 'search');
      assert.equal(w.attr('data-at-peace-page'), 'home');
    });

    test('YouTube\'s replaceState to the CURRENT url right after navigate-start must not undo the announcement', async () => {
      const w = await boot();
      startNavigation(w, '/results?search_query=x');
      navigate(w, 'https://www.youtube.com/', { navigationType: 'replace' }); // what Chromium and Firefox both showed
      assert.equal(w.attr('data-at-peace-next'), 'search');
      navigate(w, 'https://www.youtube.com/results?search_query=x');
      assert.equal(w.attr('data-at-peace-next'), 'search');
    });

    test('reloads, hash changes, cross-origin and non-string destinations are ignored', async () => {
      const w = await boot();
      navigate(w, 'https://www.youtube.com/watch?v=1', { navigationType: 'reload' });
      navigate(w, 'https://www.youtube.com/#x', { hashChange: true });
      navigate(w, 'https://example.com/watch?v=1');
      navigate(w, undefined);
      assert.equal(w.attr('data-at-peace-next'), null);
    });

    test('back/forward (traverse) is announced too', async () => {
      const w = await boot({ href: 'https://www.youtube.com/watch?v=1' });
      navigate(w, 'https://www.youtube.com/results?search_query=x', { navigationType: 'traverse' });
      assert.equal(w.attr('data-at-peace-next'), 'search');
    });
  });

  test('without a Navigation API the engine still works', async () => {
    const { doc, win, env } = createEnv();
    win.navigation = undefined;
    running = AP.engine.start({ site: 'youtube', detectPage: AP.yt.page.detect, navStartEvents: ['yt-navigate-start'], navEvents: ['yt-navigate-finish'], targetUrl: AP.yt.page.urlFromNavigateEvent, env });
    win.dispatchEvent(navEvent('yt-navigate-start', { url: '/watch?v=1' }));
    assert.equal(doc.documentElement.getAttribute('data-at-peace-next'), 'watch');
  });

  test('a navigation that never finishes falls back to location after 6 s', async () => {
    const w = await boot();
    mock.timers.enable({ apis: ['setTimeout'] });
    startNavigation(w, '/results?search_query=x'); // cancelled: location never changes, no finish event
    assert.equal(w.attr('data-at-peace-next'), 'search');
    mock.timers.tick(5999);
    assert.equal(w.attr('data-at-peace-next'), 'search');
    mock.timers.tick(1);
    assert.equal(w.attr('data-at-peace-next'), null);
    assert.equal(w.attr('data-at-peace-page'), 'home');
  });

  test('the safety timer also covers a target announced only by the Navigation API (e.g. a redirect)', async () => {
    const w = await boot({ href: 'https://www.youtube.com/feed/trending' });
    assert.equal(w.attr('data-at-peace-page'), 'other');
    mock.timers.enable({ apis: ['setTimeout'] });
    w.win.navigation.dispatchEvent(Object.assign(new Event('navigate'), { destination: { url: 'https://www.youtube.com/' }, navigationType: 'replace', hashChange: false }));
    assert.equal(w.attr('data-at-peace-next'), 'home');
    w.win.pushState('/'); // the redirect happened, but no yt-navigate-* event follows
    mock.timers.tick(6000);
    assert.equal(w.attr('data-at-peace-page'), 'home');
    assert.equal(w.attr('data-at-peace-next'), null);
  });

  test('finishing cancels the safety timer', async () => {
    const w = await boot();
    mock.timers.enable({ apis: ['setTimeout'] });
    startNavigation(w, '/results?search_query=x');
    finishNavigation(w, '/results?search_query=x');
    w.win.pushState('/watch?v=1'); // location moves without any event
    mock.timers.tick(10_000);
    assert.equal(w.attr('data-at-peace-page'), 'search', 'the timer was cleared, nothing re-synced');
  });
});

describe('feature lifecycle', () => {
  test('a feature starts when one of its settings turns on: init, then onNavigate for the current page', async () => {
    const f = recorder('f', ['yt.watch.hideRelated']);
    const w = await boot({ href: 'https://www.youtube.com/watch?v=1', features: [f] });
    assert.deepEqual(f.calls, [], 'off by default');
    await change(w, { 'yt.watch.hideRelated': true });
    assert.deepEqual(f.calls, [['init', 'watch'], ['onNavigate', 'watch', 'init']]);
    assert.deepEqual(w.inspect().features, [{ id: 'f', active: true, broken: false }]);
  });

  test('a feature whose setting is already on at startup is initialized once settings load', async () => {
    const f = recorder('f', ['yt.watch.hideRelated']);
    await boot({ stored: { 'yt.watch.hideRelated': true }, features: [f] });
    assert.deepEqual(f.calls.map((c) => c[0]), ['init', 'onNavigate']);
  });

  test('onSettings only gets the ids that belong to the feature; unrelated changes are silent', async () => {
    const f = recorder('f', ['yt.watch.hideRelated', 'yt.general.thumbnails']);
    const w = await boot({ stored: { 'yt.watch.hideRelated': true }, features: [f] });
    f.calls.length = 0;
    await change(w, { 'yt.general.thumbnails': 'hide', 'pause.breathSeconds': 9, 'yt.guide.hideFooter': true });
    assert.deepEqual(f.calls, [['onSettings', ['yt.general.thumbnails']]]);
    f.calls.length = 0;
    await change(w, { 'pause.breathSeconds': 11 });
    assert.deepEqual(f.calls, []);
  });

  test('turning the last setting off calls destroy; turning it on again calls init again', async () => {
    const f = recorder('f', ['yt.watch.hideRelated']);
    const w = await boot({ stored: { 'yt.watch.hideRelated': true }, features: [f] });
    f.calls.length = 0;
    await change(w, { 'yt.watch.hideRelated': false });
    assert.deepEqual(f.calls, [['destroy']]);
    f.calls.length = 0;
    await change(w, { 'yt.watch.hideRelated': true });
    assert.deepEqual(f.calls.map((c) => c[0]), ['init', 'onNavigate']);
  });

  test('the master switch stops every feature and starts them again', async () => {
    const a = recorder('a', ['yt.watch.hideRelated']);
    const b = recorder('b', ['yt.comments.hideAll']);
    const w = await boot({ stored: { 'yt.watch.hideRelated': true, 'yt.comments.hideAll': true }, features: [a, b] });
    a.calls.length = b.calls.length = 0;
    await change(w, { 'general.enabled': false });
    assert.deepEqual(a.calls, [['destroy']]);
    assert.deepEqual(b.calls, [['destroy']]);
    await change(w, { 'general.enabled': true });
    assert.deepEqual(a.calls.map((c) => c[0]), ['destroy', 'init', 'onNavigate']);
  });

  test('ignoresMaster: a feature that opts out keeps running when the master switch is off', async () => {
    const guard = recorder('guard', [], { ignoresMaster: true, isActive: () => true });
    const hider = recorder('hider', ['yt.watch.hideRelated']);
    const w = await boot({ stored: { 'yt.watch.hideRelated': true }, features: [guard, hider] });
    guard.calls.length = hider.calls.length = 0;
    await change(w, { 'general.enabled': false });
    assert.deepEqual(hider.calls, [['destroy']]);
    assert.ok(!guard.calls.some((c) => c[0] === 'destroy'), 'guard must not be destroyed by the master switch');
  });

  test('a feature can bring its own isActive(); it is re-evaluated on navigation too', async () => {
    const f = recorder('watch-only', ['yt.watch.disableAutoplay'], { isActive: (ctx) => ctx.settings['yt.watch.disableAutoplay'] && ctx.page === 'watch' });
    const w = await boot({ stored: { 'yt.watch.disableAutoplay': true }, features: [f] });
    assert.deepEqual(f.calls, []);

    finishNavigation(w, '/watch?v=1');
    assert.deepEqual(f.calls, [['init', 'watch'], ['onNavigate', 'watch', 'yt-navigate-finish']], 'activated by the navigation: init + ONE onNavigate');
    f.calls.length = 0;

    w.win.dispatchEvent(navEvent('yt-page-data-updated', {}));
    assert.deepEqual(f.calls, [['onNavigate', 'watch', 'yt-page-data-updated']]);
    f.calls.length = 0;

    finishNavigation(w, '/');
    assert.deepEqual(f.calls, [['destroy']]);
  });

  test('onNavigate runs for active features only, after every done event, with ctx.navEvent', async () => {
    const on = recorder('on', ['yt.watch.hideRelated']);
    const off = recorder('off', ['yt.comments.hideAll']);
    const w = await boot({ stored: { 'yt.watch.hideRelated': true }, features: [on, off] });
    on.calls.length = 0;
    finishNavigation(w, '/results?search_query=x');
    w.win.dispatchEvent(navEvent('yt-page-data-updated', {}));
    w.win.pushState('/');
    w.win.dispatchEvent(new Event('popstate'));
    assert.deepEqual(on.calls, [
      ['onNavigate', 'search', 'yt-navigate-finish'],
      ['onNavigate', 'search', 'yt-page-data-updated'],
      ['onNavigate', 'home', 'popstate'],
    ]);
    assert.deepEqual(off.calls, []);
  });

  test('a navigation START does not call features (nothing has changed for them yet)', async () => {
    const f = recorder('f', ['yt.watch.hideRelated']);
    const w = await boot({ stored: { 'yt.watch.hideRelated': true }, features: [f] });
    f.calls.length = 0;
    startNavigation(w, '/watch?v=2');
    assert.deepEqual(f.calls, []);
  });

  test('ctx is one live object: same reference everywhere, updated in place', async () => {
    const refs = [];
    const f = recorder('f', ['yt.watch.hideRelated'], {
      init: (ctx) => refs.push(ctx),
      onNavigate: (ctx) => refs.push(ctx),
      onSettings: (ctx) => refs.push(ctx),
    });
    const w = await boot({ stored: { 'yt.watch.hideRelated': true }, features: [f], config: { bridge: { name: 'bridge' } } });
    finishNavigation(w, '/results?search_query=x');
    await change(w, { 'yt.watch.hideRelated': true, 'yt.guide.hideFooter': true, 'yt.general.thumbnails': 'hide' });
    assert.ok(refs.length >= 2);
    assert.ok(refs.every((r) => r === refs[0]));
    assert.equal(refs[0], w.ctx);
    assert.equal(w.ctx.site, 'youtube');
    assert.equal(w.ctx.page, 'search');
    assert.equal(w.ctx.settings['yt.guide.hideFooter'], true);
    assert.equal(w.ctx.api, AP.api);
    assert.deepEqual(w.ctx.bridge, { name: 'bridge' });
    assert.equal(w.ctx.log, AP.log);
  });

  test('features without settings or isActive stay off; missing hooks are fine', async () => {
    const bare = { id: 'bare' };
    const onlyInit = { id: 'only-init', settings: ['yt.watch.hideRelated'], init: () => {} };
    const w = await boot({ stored: { 'yt.watch.hideRelated': true }, features: [bare, onlyInit] });
    assert.deepEqual(w.inspect().features, [{ id: 'bare', active: false, broken: false }, { id: 'only-init', active: true, broken: false }]);
    finishNavigation(w, '/watch?v=1');
    assert.equal(console.warn.mock.calls.length, 0);
  });

  describe('failures never break the rest', () => {
    test('a feature whose init throws is parked (never retried) while others keep working', async () => {
      const bad = recorder('bad', ['yt.watch.hideRelated'], { init: () => { throw new Error('init bug'); } });
      const good = recorder('good', ['yt.watch.hideRelated']);
      const w = await boot({ stored: { 'yt.watch.hideRelated': true }, features: [bad, good] });
      assert.deepEqual(w.inspect().features, [{ id: 'bad', active: false, broken: true }, { id: 'good', active: true, broken: false }]);
      assert.equal(console.warn.mock.calls.length, 1);
      assert.match(String(console.warn.mock.calls[0].arguments[1]), /feature "bad" init failed/);
      bad.calls.length = 0;
      await change(w, { 'yt.guide.hideFooter': true, 'yt.watch.hideRelated': false });
      await change(w, { 'yt.watch.hideRelated': true });
      assert.deepEqual(bad.calls, [], 'a parked feature is left alone');
      assert.deepEqual(good.calls.map((c) => c[0]), ['init', 'onNavigate', 'destroy', 'init', 'onNavigate']);
    });

    test('throwing onNavigate / onSettings hooks are logged and the feature stays active', async () => {
      const f = recorder('f', ['yt.watch.hideRelated', 'yt.general.thumbnails'], {
        onNavigate: () => { throw new Error('nav bug'); },
        onSettings: () => { throw new Error('settings bug'); },
      });
      const g = recorder('g', ['yt.watch.hideRelated']);
      const w = await boot({ stored: { 'yt.watch.hideRelated': true }, features: [f, g] });
      finishNavigation(w, '/watch?v=1');
      await change(w, { 'yt.general.thumbnails': 'hide' });
      assert.equal(w.inspect().features[0].active, true);
      assert.ok(console.warn.mock.calls.some((c) => /onNavigate failed/.test(String(c.arguments[1]))));
      assert.ok(console.warn.mock.calls.some((c) => /onSettings failed/.test(String(c.arguments[1]))));
      assert.ok(g.calls.some((c) => c[0] === 'onNavigate'), 'the other feature still got its calls');
    });

    test('async hooks that reject are logged, not left unhandled', async () => {
      const f = recorder('f', ['yt.watch.hideRelated'], { init: async () => { throw new Error('async bug'); } });
      await boot({ stored: { 'yt.watch.hideRelated': true }, features: [f] });
      await sleep(10);
      assert.ok(console.warn.mock.calls.some((c) => /init failed/.test(String(c.arguments[1]))));
      assert.equal(running.inspect().features[0].active, true, 'a rejected promise does not park the feature');
    });

    test('a throwing isActive() counts as inactive and is logged', async () => {
      const f = recorder('f', ['yt.watch.hideRelated'], { isActive: () => { throw new Error('active bug'); } });
      const w = await boot({ features: [f] });
      assert.equal(w.inspect().features[0].active, false);
      assert.ok(console.warn.mock.calls.some((c) => /isActive failed/.test(String(c.arguments[1]))));
    });
  });
});

describe('mutation bus', () => {
  const element = (w, tag, parent = w.html) => parent.appendChild(w.doc.createElement(tag));

  test('no observer exists unless an enabled feature observes (only the style guard watches the root)', async () => {
    const quiet = recorder('quiet', ['yt.watch.hideRelated']);
    const w = await boot({ stored: { 'yt.watch.hideRelated': true }, features: [quiet] });
    assert.equal(w.inspect().observing, false);
    const watchers = FakeMutationObserver.instances.filter((o) => o.active);
    assert.equal(watchers.length, 1, 'just the style guard');
    assert.equal(watchers[0].targets[0].options.subtree, undefined);
  });

  test('an observing feature gets one observer on the document and an initial scan of the whole document', async () => {
    const f = recorder('obs', ['yt.watch.hideRelated'], { observes: true });
    const w = await boot({ stored: { 'yt.watch.hideRelated': true }, features: [f] });
    assert.equal(w.inspect().observing, true);
    const bus = FakeMutationObserver.instances.find((o) => o.active && o.targets[0].target === w.doc);
    assert.deepEqual(bus.targets[0].options, { childList: true, subtree: true });
    assert.deepEqual(f.calls.filter((c) => c[0] === 'onMutations'), [], 'not before the next frame');
    w.win.runFrames();
    assert.deepEqual(f.calls.filter((c) => c[0] === 'onMutations'), [['onMutations', ['HTML']]]);
  });

  test('additions are batched per animation frame, nested ones collapse into their ancestor, text and detached nodes are ignored', async () => {
    const f = recorder('obs', ['yt.watch.hideRelated'], { observes: true });
    const w = await boot({ stored: { 'yt.watch.hideRelated': true }, features: [f] });
    w.win.runFrames();
    f.calls.length = 0;

    const list = element(w, 'ytd-rich-grid-renderer');
    const item = element(w, 'ytd-rich-item-renderer', list);
    element(w, 'ytd-thumbnail', item);
    const sibling = element(w, 'ytd-guide-renderer');
    const gone = element(w, 'ytd-tmp');
    gone.remove();
    list.appendChild(w.doc.createTextNode('hello'));
    await flush();
    assert.deepEqual(f.calls, [], 'nothing until the frame');
    w.win.runFrames();
    assert.equal(f.calls.length, 1, 'one call per frame, however many mutations');
    assert.deepEqual(f.calls[0], ['onMutations', ['YTD-RICH-GRID-RENDERER', 'YTD-GUIDE-RENDERER']]);
    void sibling;
    w.win.runFrames();
    assert.equal(f.calls.length, 1, 'no frame is scheduled without mutations');
  });

  test('only observing, active features are called; a throwing one does not stop the other', async () => {
    const a = recorder('a', ['yt.watch.hideRelated'], { observes: true, onMutations: () => { throw new Error('scan bug'); } });
    const b = recorder('b', ['yt.watch.hideRelated'], { observes: true });
    const c = recorder('c', ['yt.watch.hideRelated']);
    const d = recorder('d', ['yt.comments.hideAll'], { observes: true }); // off
    const w = await boot({ stored: { 'yt.watch.hideRelated': true }, features: [a, b, c, d] });
    w.win.runFrames();
    f_clear([b, c, d]);
    element(w, 'div');
    await flush();
    w.win.runFrames();
    assert.deepEqual(b.calls, [['onMutations', ['DIV']]]);
    assert.deepEqual(c.calls, []);
    assert.deepEqual(d.calls, []);
    assert.ok(console.warn.mock.calls.some((x) => /onMutations failed/.test(String(x.arguments[1]))));
    function f_clear(list) {
      for (const f of list) f.calls.length = 0;
    }
  });

  test('a feature that becomes active later gets its own initial scan without replaying old mutations to the others', async () => {
    const early = recorder('early', ['yt.watch.hideRelated'], { observes: true });
    const late = recorder('late', ['yt.comments.hideAll'], { observes: true });
    const w = await boot({ stored: { 'yt.watch.hideRelated': true }, features: [early, late] });
    w.win.runFrames();
    early.calls.length = 0;
    await change(w, { 'yt.comments.hideAll': true });
    w.win.runFrames();
    assert.deepEqual(late.calls.filter((c) => c[0] === 'onMutations'), [['onMutations', ['HTML']]]);
    assert.deepEqual(early.calls.filter((c) => c[0] === 'onMutations'), [], 'the first feature already scanned');
  });

  test('turning the last observing feature off disconnects the observer and drops queued work', async () => {
    const f = recorder('obs', ['yt.watch.hideRelated'], { observes: true });
    const w = await boot({ stored: { 'yt.watch.hideRelated': true }, features: [f] });
    w.win.runFrames();
    element(w, 'div');
    await flush();
    await change(w, { 'yt.watch.hideRelated': false });
    assert.equal(w.inspect().observing, false);
    assert.equal(w.win._frames.length, 0, 'the pending frame was cancelled');
    f.calls.length = 0;
    element(w, 'div');
    await flush();
    w.win.runFrames();
    assert.deepEqual(f.calls, []);
  });

  test('a flood of roots (hidden tab) collapses into one scan of the document', async () => {
    const f = recorder('obs', ['yt.watch.hideRelated'], { observes: true });
    const w = await boot({ stored: { 'yt.watch.hideRelated': true }, features: [f] });
    w.win.runFrames();
    f.calls.length = 0;
    for (let i = 0; i < 1600; i++) element(w, 'span');
    await flush();
    w.win.runFrames();
    assert.deepEqual(f.calls, [['onMutations', ['HTML']]]);
  });
});

describe('stop()', () => {
  test('removes listeners, observers, sheets and attributes, and destroys features', async () => {
    const f = recorder('f', ['yt.watch.hideRelated'], { observes: true });
    const w = await boot({ stored: { 'yt.watch.hideRelated': true }, features: [f] });
    startNavigation(w, '/results?search_query=x');
    f.calls.length = 0;
    w.engine.stop();
    assert.deepEqual(f.calls, [['destroy']]);
    for (const name of ['data-at-peace', 'data-at-peace-page', 'data-at-peace-next']) assert.equal(w.attr(name), null, name);
    assert.equal(w.doc.getElementById('at-peace-style'), null);
    assert.equal(w.doc.getElementById('at-peace-dynamic'), null);
    assert.equal(FakeMutationObserver.instances.filter((o) => o.active).length, 0);
    assert.equal(w.engine.inspect().started, false);

    finishNavigation(w, '/watch?v=1'); // events after stop are ignored
    assert.equal(w.attr('data-at-peace-page'), null);
    assert.equal(fake.storage.onChanged.listeners.length, 0);
    assert.equal(AP.engine.inspect()?.started, false);
    AP.engine.stop();
    assert.equal(AP.engine.inspect(), null);
  });
});
