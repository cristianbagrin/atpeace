// Pure logic of the Phase 3b YouTube features: filter matching, the redirect interceptor's
// loop guard, the decision functions of autoplay / theater / speed / still-watching / search / hover,
// the feature registry (every setting a feature names exists), and the MAIN-world bridge (tag mapping
// and the nonce protocol between page-bridge.js and bridge-client.js, run in a vm).
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { join } from 'node:path';
import { loadAtPeace, installFakeBrowser, uninstallFakeBrowser, CORE_SCRIPTS, SCHEMA_SCRIPTS, ROOT } from './_load.mjs';

const FEATURE_FILES = [
  'bridge-tags', 'home-feed', 'shorts', 'autoplay', 'theater', 'speed', 'still-watching', 'channel-tab', 'filters', 'thumbnails-hover', 'thumbnail-frame', 'search-suggestions', 'layout-nudge',
].map((f) => `src/sites/youtube/features/${f}.js`);

let AP;
before(async () => {
  installFakeBrowser();
  AP = await loadAtPeace([
    ...CORE_SCRIPTS,
    ...SCHEMA_SCRIPTS,
    'src/content/engine.js',
    'src/sites/youtube/page.js',
    'src/sites/youtube/bridge-client.js',
    'src/sites/youtube/redirects.js',
    'src/sites/youtube/features/_shared.js',
    ...FEATURE_FILES,
  ]);
});
after(() => uninstallFakeBrowser());

describe('filters: keyword matching', () => {
  const F = () => AP.yt.filters;
  const match = (lines, text) => F().matchesKeywords(F().compileKeywords(lines), text);

  test('substring, case-insensitive', () => {
    assert.equal(match(['spoiler'], 'The Big SPOILERS inside'), true);
    assert.equal(match(['react'], 'Why I do not react'), true);
    assert.equal(match(['react'], 'Rea ct'), false);
    assert.equal(match([], 'anything'), false);
    assert.equal(match(['x'], ''), false);
  });

  test('diacritic-insensitive in both directions', () => {
    assert.equal(match(['creme brulee'], 'Crème Brûlée in 5 minutes'), true);
    assert.equal(match(['crème'], 'CREME'), true);
    assert.equal(match(['É'], 'e'), true);
    assert.equal(match(['naïve'], 'Naive realism'), true);
  });

  test('/regex/flags lines', () => {
    assert.equal(match(['/spoiler|leak/i'], 'Huge LEAK'), true);
    assert.equal(match(['/^top \\d+/i'], 'Top 10 things'), true);
    assert.equal(match(['/^top \\d+/i'], 'The top 10 things'), false);
    assert.equal(match(['/foo/'], 'FOO'), false); // no i flag: case-sensitive, as written
    assert.equal(match(['/foo/gi'], 'foo foo'), true); // g would make test() stateful: dropped
    const compiled = F().compileKeywords(['/foo/gi']);
    assert.equal(F().matchesKeywords(compiled, 'foo'), true);
    assert.equal(F().matchesKeywords(compiled, 'foo'), true, 'repeated calls give the same answer');
    assert.equal(match(['/Creme/'], 'Crème'), true, 'a regex also sees the text without accents');
  });

  test('invalid regexes are ignored and reported, never thrown', () => {
    const compiled = F().compileKeywords(['/(unclosed/', '/ok/', '/x/z', 'plain']);
    assert.deepEqual(compiled.invalid.map((i) => i.raw), ['/(unclosed/', '/x/z']);
    assert.equal(compiled.regexes.length, 1);
    assert.deepEqual(compiled.needles, ['plain']);
    assert.equal(F().matchesKeywords(compiled, 'an OK day'), false); // /ok/ is case-sensitive
    assert.equal(F().matchesKeywords(compiled, 'ok'), true);
  });

  test('a lone slash or a slash-containing phrase is plain text', () => {
    assert.equal(match(['/'], 'AC/DC live'), true);
    assert.equal(match(['and/or'], 'this and/or that'), true);
  });

  test('blank lines and non-array input are harmless', () => {
    assert.deepEqual(F().compileKeywords(['', '   ']).needles, []);
    assert.deepEqual(F().compileKeywords(null).needles, []);
    assert.deepEqual(F().compileKeywords(['  Padded  ']).needles, ['padded']);
  });
});

describe('filters: channels', () => {
  const F = () => AP.yt.filters;
  const hit = (lines, channel) => F().matchesChannel(F().compileChannels(lines), channel);

  test('by name (exact, ignoring case and accents), by @handle, by channel id', () => {
    assert.equal(hit(['MrBeast'], { name: 'mrbeast' }), true);
    assert.equal(hit(['MrBeast'], { name: 'MrBeast Gaming' }), false, 'a name is matched whole, not as a substring');
    assert.equal(hit(['Cuisine Française'], { name: 'cuisine francaise' }), true);
    assert.equal(hit(['@MKBHD'], { name: 'Marques', handles: ['mkbhd'] }), true);
    assert.equal(hit(['@mkbhd'], { name: 'Marques', handles: ['other'] }), false);
    assert.equal(hit(['UCBJycsmduvYEL83R_U4JriQ'], { name: 'x', ids: ['UCBJycsmduvYEL83R_U4JriQ'] }), true);
    assert.equal(hit([], { name: 'x' }), false);
  });

  test('a /regex/ line applies to the name and to @handle', () => {
    assert.equal(hit(['/^news/i'], { name: 'News Today' }), true);
    assert.equal(hit(['/^@news/i'], { name: 'x', handles: ['newsroom'] }), true);
    assert.equal(hit(['/^news/i'], { name: 'Daily news' }), false);
  });

  test('channelFromHref reads handles and ids from every link form', () => {
    const c = F().channelFromHref;
    assert.deepEqual(c('/@MrBeast'), { handle: 'mrbeast' });
    assert.deepEqual(c('/@MrBeast/videos'), { handle: 'mrbeast' });
    assert.deepEqual(c('https://www.youtube.com/@Gordon%20Ramsay?x=1'), { handle: 'gordon ramsay' });
    assert.deepEqual(c('/channel/UCBJycsmduvYEL83R_U4JriQ'), { id: 'UCBJycsmduvYEL83R_U4JriQ' });
    assert.deepEqual(c('/@%E3%81%82'), { handle: 'あ' });
    assert.equal(c('/watch?v=abcdefghijk'), null);
    assert.equal(c('/c/Foo'), null);
    assert.equal(c('/@'), null);
    assert.equal(c(null), null);
  });
});

describe('redirect interceptor loop guard', () => {
  const memoryStorage = () => {
    const data = new Map();
    return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)) };
  };

  test('the same target three times within 15 s is refused, other targets and later times are fine', () => {
    const { allowRedirect, isLooping, setLoopGuard } = AP.yt.shared;
    setLoopGuard(memoryStorage());
    const t0 = 1_000_000;
    assert.equal(allowRedirect('https://www.youtube.com/feed/subscriptions', t0), true);
    assert.equal(allowRedirect('https://www.youtube.com/feed/subscriptions', t0 + 1000), true);
    assert.equal(isLooping('https://www.youtube.com/feed/subscriptions', t0 + 1500), false);
    assert.equal(allowRedirect('https://www.youtube.com/feed/subscriptions', t0 + 2000), true);
    assert.equal(isLooping('https://www.youtube.com/feed/subscriptions', t0 + 2500), true);
    assert.equal(allowRedirect('https://www.youtube.com/feed/subscriptions', t0 + 3000), false);
    assert.equal(allowRedirect('https://www.youtube.com/feed/history', t0 + 3000), true);
    assert.equal(allowRedirect('https://www.youtube.com/feed/subscriptions', t0 + 20_000), true, 'the window slides');
    setLoopGuard(null);
  });

  test('survives broken storage', () => {
    const { allowRedirect, setLoopGuard } = AP.yt.shared;
    setLoopGuard({ getItem: () => 'not json', setItem: () => { throw new Error('quota'); } });
    assert.equal(allowRedirect('https://www.youtube.com/a', 1), true);
    assert.equal(allowRedirect('https://www.youtube.com/a', 2), true);
    assert.equal(allowRedirect('https://www.youtube.com/a', 3), true);
    assert.equal(allowRedirect('https://www.youtube.com/a', 4), false, 'the in-memory copy still guards');
    setLoopGuard(null);
  });

  test('videoIdOf', () => {
    const v = AP.yt.shared.videoIdOf;
    assert.equal(v('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=5'), 'dQw4w9WgXcQ');
    assert.equal(v('/watch?v=dQw4w9WgXcQ&list=PLx'), 'dQw4w9WgXcQ');
    assert.equal(v('/live/ABCDEFGHIJK'), 'ABCDEFGHIJK');
    assert.equal(v('/shorts/abc_def-123'), 'abc_def-123');
    assert.equal(v('/watch'), null);
    assert.equal(v('/results?search_query=x'), null);
    assert.equal(v('/watch?v=<script>'), null);
  });
});

describe('decision functions', () => {
  test('autoplay: pause a start the user did not ask for, once per video', () => {
    const f = AP.yt.autoplay.shouldPauseOnPlay;
    assert.equal(f({ videoId: 'a', handledFor: null, intentAt: 0, navStartedAt: 1000 }), true);
    assert.equal(f({ videoId: 'a', handledFor: 'a', intentAt: 0, navStartedAt: 1000 }), false, 'already handled: never fight the user afterwards');
    assert.equal(f({ videoId: 'b', handledFor: 'a', intentAt: 0, navStartedAt: 1000 }), true, 'a new video');
    assert.equal(f({ videoId: 'a', handledFor: null, intentAt: 1500, navStartedAt: 1000 }), false, 'the user pressed play after the navigation began');
    assert.equal(f({ videoId: 'a', handledFor: null, intentAt: 900, navStartedAt: 1000 }), true, 'a click before the navigation (the link that led here) is not play');
    assert.equal(f({ videoId: null, handledFor: null, intentAt: 0, navStartedAt: 0 }), false);
  });

  test('theater: click only a watch page that is ready and not in theater', () => {
    const d = AP.yt.theater.decide;
    assert.equal(d({ flexyAttrs: null, hasButton: true }), 'wait');
    assert.equal(d({ flexyAttrs: ['hidden'], hasButton: true }), 'wait');
    assert.equal(d({ flexyAttrs: ['theater', 'full-bleed-player'], hasButton: true }), 'done');
    assert.equal(d({ flexyAttrs: ['fullscreen'], hasButton: true }), 'done');
    assert.equal(d({ flexyAttrs: ['role'], hasButton: false }), 'wait');
    assert.equal(d({ flexyAttrs: ['role'], hasButton: true }), 'click');
  });

  test('speed: which values mean a speed, and who changed it', () => {
    const { parseSpeed, classifyRateChange } = AP.yt.speed;
    assert.equal(parseSpeed('1.5'), 1.5);
    assert.equal(parseSpeed('0.75'), 0.75);
    assert.equal(parseSpeed(2), 2);
    for (const v of ['default', '', 'fast', '3', '0.1', null, undefined, {}, NaN]) assert.equal(parseSpeed(v), null, String(v));
    assert.equal(classifyRateChange({ now: 1000, ownSetAt: 500, userInputAt: 0 }), 'ours');
    assert.equal(classifyRateChange({ now: 5000, ownSetAt: 500, userInputAt: 4000 }), 'user');
    assert.equal(classifyRateChange({ now: 9000, ownSetAt: 500, userInputAt: 4000 }), 'player');
    assert.equal(classifyRateChange({ now: 5000, ownSetAt: 0, userInputAt: 0 }), 'player');
    assert.equal(classifyRateChange({ now: 1000, ownSetAt: 500, userInputAt: 800 }), 'user', 'a shortcut right after our own change is still the user\'s');
    assert.equal(classifyRateChange({ now: 1000, ownSetAt: 900, userInputAt: 800 }), 'ours', 'a shortcut before our change does not make it theirs');
  });

  test('still watching: only an idle user\'s dialog is dismissed; keep-alive on visible or playing watch pages', () => {
    const { mayDismiss, shouldKeepAlive } = AP.yt.stillWatching;
    const now = 10_000_000;
    assert.equal(mayDismiss({ now, lastInputAt: now - 3_600_000, pageStartedAt: now - 7_200_000, onWatchPage: true }), true);
    assert.equal(mayDismiss({ now, lastInputAt: now - 2000, pageStartedAt: now - 7_200_000, onWatchPage: true }), false, 'a confirm dialog right after a click is the user\'s (delete, unsubscribe)');
    assert.equal(mayDismiss({ now, lastInputAt: 0, pageStartedAt: now - 5000, onWatchPage: true }), false, 'the first minute of a page');
    assert.equal(mayDismiss({ now, lastInputAt: 0, pageStartedAt: now - 3_600_000, onWatchPage: false }), false);
    assert.equal(shouldKeepAlive({ onWatchPage: true, visible: true, playing: false }), true);
    assert.equal(shouldKeepAlive({ onWatchPage: true, visible: false, playing: true }), true);
    assert.equal(shouldKeepAlive({ onWatchPage: true, visible: false, playing: false }), false);
    assert.equal(shouldKeepAlive({ onWatchPage: false, visible: true, playing: true }), false);
  });

  test('search suggestions: only plain ArrowUp/ArrowDown inside the search box', () => {
    const s = AP.yt.searchSuggestions.shouldSwallow;
    assert.equal(s({ key: 'ArrowDown', inSearchBox: true, modifiers: false }), true);
    assert.equal(s({ key: 'ArrowUp', inSearchBox: true, modifiers: false }), true);
    assert.equal(s({ key: 'Enter', inSearchBox: true, modifiers: false }), false);
    assert.equal(s({ key: 'ArrowDown', inSearchBox: false, modifiers: false }), false);
    assert.equal(s({ key: 'ArrowDown', inSearchBox: true, modifiers: true }), false);
  });

  test('hover: a thumbnail starts a preview, a control over it does not', () => {
    const tag = (match) => ({ closest: (sel) => (sel.split(',').map((part) => part.trim()).some((part) => match.includes(part)) ? {} : null) });
    const h = AP.yt.thumbnailsHover.startsPreview;
    assert.equal(h(tag(['ytd-thumbnail'])), true);
    assert.equal(h(tag(['ytd-thumbnail', 'button'])), false);
    assert.equal(h(tag(['ytd-thumbnail', '#hover-overlays'])), false);
    assert.equal(h(tag([])), false);
    assert.equal(h(null), false);
  });
});

describe('feature registry', () => {
  test('every feature has an id and settings that exist in the catalog; ids are unique', () => {
    const ids = new Set();
    for (const f of AP.yt.features) {
      assert.ok(f.id, 'id');
      assert.ok(!ids.has(f.id), `duplicate feature ${f.id}`);
      ids.add(f.id);
      assert.ok(Array.isArray(f.settings) && f.settings.length > 0, `${f.id}: settings`);
      for (const id of f.settings) assert.ok(AP.schema.get(id), `${f.id}: unknown setting ${id}`);
    }
  });

  test('every `feature:` named by the catalog (except 3c\'s and the engine\'s) has a registered feature', () => {
    const named = new Set(AP.schema.all().filter((d) => d.id.startsWith('yt.') && d.feature).map((d) => d.feature));
    const registered = new Set(AP.yt.features.map((f) => f.id));
    for (const name of named) assert.ok(registered.has(name), `catalog names feature "${name}" but none is registered`);
  });

  test('each setting that names a feature is read by that feature', () => {
    for (const def of AP.schema.all().filter((d) => d.id.startsWith('yt.') && d.feature)) {
      const feature = AP.yt.features.find((f) => f.id === def.feature);
      assert.ok(feature.settings.includes(def.id), `${def.id} is marked feature "${def.feature}" but that feature does not list it`);
    }
  });

  test('bridgeTags covers every setting whose CSS uses a bridge tag (shelf and channel-action tags included)', () => {
    const tags = AP.yt.features.find((f) => f.id === 'bridgeTags').settings;
    for (const id of ['yt.guide.hideWatchLater', 'yt.guide.hideShorts', 'yt.watch.hideClip', 'yt.watch.hideShare', 'yt.channel.hideShortsTab', 'yt.channel.hideStoreTab', 'yt.channel.hideRowPosts', 'yt.channel.hideRowMembers', 'yt.channel.hideRowLive', 'yt.channel.hideJoinButton', 'yt.channel.hideShowsTab', 'yt.channel.hideMembersTab']) assert.ok(tags.includes(id), id);
    assert.ok(tags.length >= 38, `${tags.length} settings`);
  });

  test('layout nudge only names layout settings that exist', () => {
    for (const id of AP.yt.layoutNudge.LAYOUT_SETTINGS) assert.ok(AP.schema.get(id), id);
  });

  test('engine activity rule: a filters feature with empty lists is inactive, with a keyword it is active', () => {
    const f = AP.yt.features.find((x) => x.id === 'filters');
    assert.equal(AP.engine.isFeatureActive(f, { settings: { 'yt.filters.keywords': [], 'yt.filters.applyTo': ['home'] } }), false);
    assert.equal(AP.engine.isFeatureActive(f, { settings: { 'yt.filters.keywords': ['x'] } }), true);
    assert.equal(AP.engine.isFeatureActive(f, { settings: { 'yt.filters.keywords': ['  '], 'yt.filters.channels': [] } }), false);
  });
});

// ---------------------------------------------------------------------------------------------------------
// The MAIN-world bridge: run the real file in a vm
// ---------------------------------------------------------------------------------------------------------

const BRIDGE_SOURCE = readFileSync(join(ROOT, 'src/sites/youtube/page-bridge.js'), 'utf8');

/** Runs page-bridge.js in a fresh vm "page" and returns its window, the attributes it set, and its test exports. */
function loadBridge({ player, onTimeout } = {}) {
  const listeners = [];
  const posted = [];
  const attrs = new Map();
  const win = {
    __atPeaceBridgeTest: {},
    addEventListener: (type, fn) => listeners.push([type, fn]),
    location: { origin: 'https://www.youtube.com' },
    postMessage(data) {
      posted.push(data);
      win.onPost?.(data);
    },
  };
  win.window = win;
  const doc = {
    documentElement: { getAttribute: (k) => attrs.get(k) ?? null, setAttribute: (k, v) => attrs.set(k, String(v)) },
    querySelector: (sel) => (sel.includes('movie_player') ? player ?? null : null),
    querySelectorAll: () => [],
    getElementsByTagName: () => [],
  };
  const context = vm.createContext({ window: win, location: win.location, document: doc, setTimeout: onTimeout ?? setTimeout, clearTimeout, console, URL, URLSearchParams, Date, Object, Array, Number, String, JSON });
  vm.runInContext(BRIDGE_SOURCE, context);
  return { win, attrs, posted, exports: win.__atPeaceBridgeTest.exports, send: (data, source = win) => listeners.filter(([t]) => t === 'message').forEach(([, fn]) => fn({ source, data })) };
}

/** The vm has its own Object/Array prototypes: compare through JSON. */
const plain = (value) => JSON.parse(JSON.stringify(value ?? null));

describe('thumbnail frame (Phase 7b)', () => {
  const T = () => AP.yt.thumbnailFrame;
  test('the video id comes from the card link: /watch?v=ID and /shorts/ID, nothing else', () => {
    assert.equal(T().videoIdFromHref('/watch?v=plN7JMbadRg'), 'plN7JMbadRg');
    assert.equal(T().videoIdFromHref('/watch?v=plN7JMbadRg&list=PLabc&index=3&pp=xyz'), 'plN7JMbadRg');
    assert.equal(T().videoIdFromHref('https://www.youtube.com/watch?v=C0STkNVChLI&t=30s'), 'C0STkNVChLI');
    assert.equal(T().videoIdFromHref('/shorts/C0STkNVChLI'), 'C0STkNVChLI');
    assert.equal(T().videoIdFromHref('/shorts/C0STkNVChLI?feature=share'), 'C0STkNVChLI');
    for (const no of ['/playlist?list=PLabc', '/@MrBeast', '/channel/UCX6OQ3DkcsbYNE6H8uQQuVA', '/watch', '/watch?v=short', '/clip/Ugkx123456789', 'https://example.com/watch?v=plN7JMbadRg', '', null, undefined, 5]) {
      assert.equal(T().videoIdFromHref(no), null, String(no));
    }
  });

  test('the three frames are YouTube\'s own i.ytimg.com pictures, 16:9 (mq1 … mq3), never another host', () => {
    assert.deepEqual({ ...T().FRAMES }, { start: 'mq1', middle: 'mq2', end: 'mq3' });
    assert.equal(T().frameUrl('plN7JMbadRg', 'mq2'), 'https://i.ytimg.com/vi/plN7JMbadRg/mq2.jpg');
    for (const f of Object.values(T().FRAMES)) assert.match(T().frameUrl('plN7JMbadRg', f), /^https:\/\/i\.ytimg\.com\/vi\/[\w-]{11}\/mq[123]\.jpg$/);
  });

  test('the setting is a select Original · Early · Middle · Late whose first option is the default', () => {
    const def = AP.schema.get('yt.general.thumbnailFrame');
    assert.deepEqual(def.options.map((o) => o.label), ['Original', 'Early', 'Middle', 'Late']);
    assert.equal(def.default, def.options[0].value);
    assert.equal(def.feature, 'thumbnail-frame');
  });
});

describe('page bridge: tag mapping (data shapes observed live, 2026-10-04)', () => {
  let b;
  before(() => {
    b = loadBridge().exports;
  });

  test('guide entries: the five observed logged-out entries (icon + endpoint as YouTube serves them)', () => {
    const nav = (url, browseId) => ({ commandMetadata: { webCommandMetadata: { url } }, browseEndpoint: { browseId } });
    assert.equal(b.entryName({ navigationEndpoint: nav('/', 'FEwhat_to_watch'), icon: { iconType: 'TAB_HOME_CAIRO' } }), 'home');
    assert.equal(b.entryName({ serviceEndpoint: { reelWatchEndpoint: {} }, icon: { iconType: 'TAB_SHORTS_CAIRO' } }), 'shorts');
    assert.equal(b.entryName({ navigationEndpoint: nav('/feed/subscriptions', 'FEsubscriptions'), icon: { iconType: 'TAB_SUBSCRIPTIONS_CAIRO' }, targetId: 'subscriptions-guide-item' }), 'subscriptions');
    assert.equal(b.entryName({ navigationEndpoint: nav('/feed/you', 'FElibrary'), icon: { iconType: 'ACCOUNT_CIRCLE_CAIRO' }, targetId: 'library-guide-item' }), 'you');
    assert.equal(b.entryName({ navigationEndpoint: nav('/feed/history', 'FEhistory'), icon: { iconType: 'WATCH_HISTORY_CAIRO' } }), 'history');
  });

  test('mini-guide Shorts (href /shorts/) and icon-only fallbacks', () => {
    assert.equal(b.entryName({ navigationEndpoint: { commandMetadata: { webCommandMetadata: { url: '/shorts/' } } }, icon: { iconType: 'TAB_SHORTS_CAIRO' } }), 'shorts');
    assert.equal(b.entryName({ icon: { iconType: 'TAB_SHORTS_CAIRO' } }), 'shorts');
    assert.equal(b.entryName({ icon: { iconType: 'WATCH_LATER_CAIRO' } }), 'watch-later');
  });

  test('signed-in entries by destination (language-free), including studio and playlists', () => {
    const url = (u) => ({ navigationEndpoint: { commandMetadata: { webCommandMetadata: { url: u } } } });
    const table = {
      '/playlist?list=WL': 'watch-later',
      '/playlist?list=LL': 'liked',
      '/feed/playlists': 'playlists',
      '/feed/downloads': 'downloads',
      '/feed/courses': 'courses',
      '/feed/clips': 'your-clips',
      'https://studio.youtube.com/channel/UCabc/videos': 'your-videos',
    };
    for (const [u, name] of Object.entries(table)) assert.equal(b.entryName(url(u)), name, u);
    assert.equal(b.entryName({ navigationEndpoint: { browseEndpoint: { browseId: 'VLWL' } } }), 'watch-later');
    assert.equal(b.entryName({ navigationEndpoint: { browseEndpoint: { browseId: 'VLLL' } } }), 'liked');
  });

  test('unknown entries are not tagged (Explore topic channels, Kids, Report history, junk)', () => {
    const url = (u, icon) => ({ navigationEndpoint: { commandMetadata: { webCommandMetadata: { url: u } } }, icon: { iconType: icon } });
    assert.equal(b.entryName(url('/channel/UCkYQyvc_i9hXEo4xic9Hh2g', 'SHOPPING_BAG_CAIRO')), null);
    assert.equal(b.entryName(url('/channel/UC-9-kyTW8ZkZNDHQJ6FgpwQ', 'MUSIC_CAIRO')), null);
    assert.equal(b.entryName(url('https://www.youtubekids.com/?source=youtube_web', 'YOUTUBE_KIDS_ICON')), null);
    assert.equal(b.entryName(url('/reporthistory', 'FLAG')), null);
    assert.equal(b.entryName(url('/feed/trending', '')), null);
    assert.equal(b.entryName(null), null);
    assert.equal(b.entryName('x'), null);
    assert.equal(b.entryName({}), null);
  });

  test('channel tabs: URL suffix, aliases and the search tab (data observed on @veritasium)', () => {
    assert.equal(b.tabFromUrl('/@veritasium/featured'), 'home');
    assert.equal(b.tabFromUrl('/@veritasium'), 'home');
    assert.equal(b.tabFromUrl('/@veritasium/videos'), 'videos');
    assert.equal(b.tabFromUrl('/@veritasium/shorts'), 'shorts');
    assert.equal(b.tabFromUrl('/@veritasium/streams'), 'streams');
    assert.equal(b.tabFromUrl('/@veritasium/podcasts'), 'podcasts');
    assert.equal(b.tabFromUrl('/@veritasium/playlists'), 'playlists');
    assert.equal(b.tabFromUrl('/@veritasium/community'), 'posts');
    assert.equal(b.tabFromUrl('/@veritasium/posts'), 'posts');
    assert.equal(b.tabFromUrl('/@veritasium/store'), 'store');
    assert.equal(b.tabFromUrl('/channel/UCHnyfMqiRRG1u-2MsSQLbXA/courses'), 'courses');
    assert.equal(b.tabFromUrl('/c/Veritasium/releases?x=1'), 'releases');
    assert.equal(b.tabFromUrl('/@veritasium/search'), 'search');
    assert.equal(b.tabFromUrl('/watch?v=abc'), null);
    assert.equal(b.tabFromUrl('/@x/Weird Tab!'), null);
    assert.equal(b.tabFromUrl(''), null);
  });

  const veritasium = {
    contents: {
      twoColumnBrowseResultsRenderer: {
        tabs: [
          { tabRenderer: { title: 'Home', selected: true, endpoint: { commandMetadata: { webCommandMetadata: { url: '/@veritasium/featured' } } } } },
          { tabRenderer: { title: 'Videos', endpoint: { commandMetadata: { webCommandMetadata: { url: '/@veritasium/videos' } } } } },
          { tabRenderer: { title: 'Shorts', endpoint: { commandMetadata: { webCommandMetadata: { url: '/@veritasium/shorts' } } } } },
          { tabRenderer: { title: 'Playlists', endpoint: { commandMetadata: { webCommandMetadata: { url: '/@veritasium/playlists' } } } } },
          { tabRenderer: { title: 'Posts', endpoint: { commandMetadata: { webCommandMetadata: { url: '/@veritasium/posts' } } } } },
          { expandableTabRenderer: { title: 'Search', selected: false, endpoint: { commandMetadata: { webCommandMetadata: { url: '/@veritasium/search' } } } } },
        ],
      },
    },
  };

  test('tabsFromPageData + matchTabs on the observed channel page (DOM titles: Home Videos Shorts Playlists Posts + untitled search)', () => {
    const data = b.tabsFromPageData(veritasium);
    assert.deepEqual(plain(data.map((t) => t.name)), ['home', 'videos', 'shorts', 'playlists', 'posts', 'search']);
    assert.deepEqual(plain(data.map((t) => t.expandable)), [false, false, false, false, false, true]);
    assert.deepEqual(plain(b.matchTabs(['Home', 'Videos', 'Shorts', 'Playlists', 'Posts', null], data)), ['home', 'videos', 'shorts', 'playlists', 'posts', null]);
  });

  test('matching is by title, so order and extra tabs do not matter; a title that does not match falls back to position only when the counts agree', () => {
    const data = b.tabsFromPageData(veritasium);
    assert.deepEqual(plain(b.matchTabs(['Videos', 'Home'], data)), ['videos', 'home']);
    // a translated DOM title that differs from the data's (entity-escaped etc.): positional when counts agree
    assert.deepEqual(plain(b.matchTabs(['Home', 'Videos', 'Shorts', 'Playlists', 'Po&sts', null], data)), ['home', 'videos', 'shorts', 'playlists', 'posts', null]);
    // counts disagree: nothing is guessed
    assert.deepEqual(plain(b.matchTabs(['Home', 'Videos', 'Mystery'], data)), ['home', 'videos', null]);
    assert.deepEqual(plain(b.matchTabs(['Home'], [])), [null]);
  });

  test('two tabs with the same title are matched in order', () => {
    const data = [
      { title: 'Live', name: 'streams', expandable: false },
      { title: 'Live', name: 'releases', expandable: false },
    ];
    assert.deepEqual(plain(b.matchTabs(['Live', 'Live'], data)), ['streams', 'releases']);
  });

  test('tabsFromPageData is safe on junk', () => {
    for (const junk of [null, undefined, {}, { contents: {} }, { contents: { twoColumnBrowseResultsRenderer: { tabs: 'x' } } }, 5]) assert.deepEqual(plain(b.tabsFromPageData(junk)), []);
  });

  test('watch action buttons: view-model / renderer data → Contract C5 names', () => {
    assert.equal(b.actionName({ segmentedLikeDislikeButtonViewModel: {} }), 'like');
    assert.equal(b.actionName({ downloadButtonRenderer: {} }), 'download');
    assert.equal(b.actionName({ buttonViewModel: { iconName: 'SHARE', title: 'Partager' } }), 'share');
    assert.equal(b.actionName({ buttonViewModel: { iconName: 'PLAYLIST_ADD', title: 'Speichern' } }), 'save');
    assert.equal(b.actionName({ buttonViewModel: { iconName: 'CONTENT_CUT', title: 'Clip' } }), 'clip');
    assert.equal(b.actionName({ buttonViewModel: { iconName: 'MONEY_HEART' } }), 'thanks');
    assert.equal(b.actionName({ buttonViewModel: { iconName: 'UNKNOWN_ICON', title: 'Share' } }), null, 'text is never used');
    assert.equal(b.actionName({ buttonViewModel: { targetId: 'watch-metadata-share' } }), 'share');
    assert.equal(b.actionName(null), null);
  });
});

describe('page bridge: channel Home rows and header buttons (Phase 7b; data captured live 2026-10-05)', () => {
  // tests/fixtures/youtube/channel-shelves.json: for six channels (MrBeast, Linus Tech Tips, Lofi Girl, NASA, TED,
  // PewDiePie) the data of every row of the Home tab as `ytd-shelf-renderer.data` / `ytd-reel-shelf-renderer.data`
  // holds it (endpoint, kind and type of the first items, badges; titles and texts removed on purpose: the
  // classification must never need them) and of the header buttons.
  const fixture = JSON.parse(readFileSync(join(ROOT, 'tests/fixtures/youtube/channel-shelves.json'), 'utf8'));
  let b;
  before(() => {
    b = loadBridge().exports;
  });
  /** What a person reading each channel's page sees, row by row (null = a row the bridge leaves alone). */
  const EXPECTED = {
    MrBeast: [null, 'series', 'popular', 'channels', 'posts'], // featured video · New Uploads · Popular videos · a custom row of channels · Posts
    LinusTechTips: [null, 'videos', 'series', 'popular', 'channels', 'series', 'series', 'members', 'playlists', 'shorts', 'posts', null],
    LofiGirl: [null, 'live', 'series', 'series', 'series', 'channels'],
    NASA: [null, 'live', 'series', 'series', 'videos', 'series', 'channels', null],
    TED: ['series', 'series', 'series', 'series', 'series', 'playlists', 'videos', 'popular', 'shorts', 'channels'],
    PewDiePie: [null, 'videos', 'series', 'series', 'playlists', 'channels', 'posts'],
  };

  for (const [channel, expected] of Object.entries(EXPECTED)) {
    test(`${channel}: every row gets the type its own data says`, () => {
      const rows = fixture[channel].shelves;
      assert.equal(rows.length, expected.length, 'the fixture has the rows listed here');
      assert.deepEqual(rows.map((r) => b.shelfType(r.tag, r.data)), expected);
    });
  }

  test('the members-only row is found by its playlist (UUM…) or by the star badge, the live row by live_view / UULV / a live badge', () => {
    const lockups = (...badges) => [{ lockupViewModel: { contentType: 'LOCKUP_CONTENT_TYPE_VIDEO', contentImage: { thumbnailViewModel: { overlays: [{ thumbnailBottomOverlayViewModel: { badges } }] } } } }];
    const row = (url, items = lockups()) => ({ endpoint: { commandMetadata: { webCommandMetadata: { url } } }, content: { horizontalListRenderer: { items } } });
    assert.equal(b.shelfType('ytd-shelf-renderer', row('/playlist?list=UUMOabcdefghijklmnopqrstu')), 'members');
    assert.equal(b.shelfType('ytd-shelf-renderer', { ...row('/playlist?list=PLxyz'), endpoint: { browseEndpoint: { browseId: 'VLUUMFabc' } } }), 'members');
    assert.equal(b.shelfType('ytd-shelf-renderer', row('/playlist?list=PLxyz', lockups({ thumbnailBadgeViewModel: { icon: { sources: [{ clientResource: { imageName: 'SPONSORSHIP_STAR' } }] } } }))), 'members');
    assert.equal(b.shelfType('ytd-shelf-renderer', row('/@x/videos?view=2&sort=dd&live_view=502')), 'live');
    assert.equal(b.shelfType('ytd-shelf-renderer', row('/playlist?list=UULVabcdefghijklmnopqrstu')), 'live');
    assert.equal(b.shelfType('ytd-shelf-renderer', row('/playlist?list=PLxyz', lockups({ thumbnailBadgeViewModel: { badgeStyle: 'THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE' } }))), 'live');
    assert.equal(b.shelfType('ytd-shelf-renderer', row('/@x/videos?view=0&sort=p')), 'popular');
    assert.equal(b.shelfType('ytd-shelf-renderer', row('/@x/videos?view=0&sort=dd')), 'videos');
    assert.equal(b.shelfType('ytd-shelf-renderer', row('/playlist?list=PLxyz')), 'series');
  });

  test('a Playlists row holds playlists and courses side by side (seen live on Linus Tech Tips): still one type', () => {
    const items = ['LOCKUP_CONTENT_TYPE_PLAYLIST', 'LOCKUP_CONTENT_TYPE_COURSE', 'LOCKUP_CONTENT_TYPE_PLAYLIST'].map((contentType) => ({ lockupViewModel: { contentType } }));
    assert.equal(b.shelfType('ytd-shelf-renderer', { endpoint: { commandMetadata: { webCommandMetadata: { url: '/@x/playlists?view=1&sort=dd&shelf_id=11' } } }, content: { horizontalListRenderer: { items } } }), 'playlists');
  });

  test('a row of unknown shape, a mixed row and junk are left alone (null), never guessed', () => {
    assert.equal(b.shelfType('ytd-shelf-renderer', { content: { horizontalListRenderer: { items: [{ mysteryRenderer: {} }] } } }), null);
    assert.equal(b.shelfType('ytd-shelf-renderer', { content: { horizontalListRenderer: { items: [] } } }), null);
    const mixed = { content: { horizontalListRenderer: { items: [{ lockupViewModel: { contentType: 'LOCKUP_CONTENT_TYPE_SHORT' } }, { lockupViewModel: { contentType: 'LOCKUP_CONTENT_TYPE_VIDEO' } }] } } };
    assert.equal(b.shelfType('ytd-shelf-renderer', mixed), null);
    for (const junk of [null, undefined, 5, 'x', [], {}]) assert.equal(b.shelfType('ytd-shelf-renderer', junk), null);
    assert.equal(b.shelfType('ytd-reel-shelf-renderer', {}), 'shorts', 'the reel shelf is a Shorts row whatever it holds');
  });

  test('no row title, text or other free text is read: the verdict is the same when every string in the data is scrambled', () => {
    const scramble = (v) => (typeof v === 'string' ? (/^(\/|[A-Z_]+$|UU|VL|PL|[a-z]+Renderer|[a-z]+ViewModel|EgZ)/.test(v) ? v : 'zzz') : Array.isArray(v) ? v.map(scramble) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scramble(x)])) : v);
    for (const [channel, expected] of Object.entries(EXPECTED)) {
      assert.deepEqual(fixture[channel].shelves.map((r) => b.shelfType(r.tag, scramble(r.data))), expected, channel);
    }
  });

  test('header buttons: join / store / community by icon, id or endpoint kind; text is never used', () => {
    const btn = (inner) => ({ buttonViewModel: { title: 'Whatever', accessibilityText: 'Whatever', ...inner } });
    assert.equal(b.channelActionName(btn({ iconName: 'PEOPLE_GROUP', accessibilityId: 'eml.header_community_button' })), 'community');
    assert.equal(b.channelActionName(btn({ accessibilityId: 'eml.header_join_button' })), 'join');
    assert.equal(b.channelActionName(btn({ iconName: 'SPONSORSHIP_STAR' })), 'join');
    assert.equal(b.channelActionName(btn({ onTap: { innertubeCommand: { clickTrackingParams: 'x', sponsorshipsPurchaseEndpoint: {} } } })), 'join');
    assert.equal(b.channelActionName(btn({ onTap: { innertubeCommand: { commandMetadata: {}, modalEndpoint: { modal: { membershipOfferRenderer: {} } } } } })), 'join');
    assert.equal(b.channelActionName(btn({ iconName: 'SHOPPING_BAG' })), 'store');
    assert.equal(b.channelActionName({ subscribeButtonViewModel: {} }), 'subscribe');
    assert.equal(b.channelActionName(null, 'subscribe-button-view-model'), 'subscribe');
    assert.equal(b.channelActionName(btn({ title: 'Join', accessibilityText: 'Join this channel' })), null, 'the label alone says nothing');
    assert.equal(b.channelActionName(null), null);
    // The captured logged-out headers: Subscribe has no name of its own (the first button is taken for it), Lofi Girl's other button is Community.
    const lofi = fixture.LofiGirl.actions.map((a) => b.channelActionName({ buttonViewModel: a.data }, a.tag));
    assert.deepEqual(lofi, [null, 'community']);
  });

  test('channel tabs: Shows and Courses (seen live), and the membership URL names the Members tab', () => {
    for (const [channel, names] of Object.entries({ MrBeast: ['home', 'videos', 'shorts', 'shows', 'posts', 'search'], TED: ['home', 'videos', 'shorts', 'streams', 'shows', 'podcasts', 'courses', 'playlists', 'posts', 'search'] })) {
      assert.deepEqual(fixture[channel].tabs.map((t) => b.tabFromUrl(t.url)), names, channel);
    }
    assert.equal(b.tabFromUrl('https://www.youtube.com/@x/membership'), 'members');
    assert.equal(b.tabFromUrl('/@x/releases'), 'releases');
  });
});

describe('page bridge: nonce protocol and the isolated client', () => {
  const player = () => {
    const calls = [];
    return {
      calls,
      setAutonav: (v) => void calls.push(['setAutonav', v]),
      pauseVideo: () => void calls.push(['pauseVideo']),
      getPlayerState: () => 2,
      setPlaybackRate(n) {
        this.rate = n;
      },
      getPlaybackRate() {
        return this.rate ?? 1;
      },
    };
  };

  /** Wires the bridge (in the vm) and the client (this realm) onto one shared "window". */
  async function wire(opts) {
    const p = player();
    const main = loadBridge({ player: p, ...opts });
    const clientListeners = [];
    const saved = {};
    for (const k of ['addEventListener', 'removeEventListener', 'postMessage', 'location']) saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
    Object.defineProperty(globalThis, 'addEventListener', { configurable: true, value: (t, fn) => clientListeners.push([t, fn]) });
    Object.defineProperty(globalThis, 'removeEventListener', { configurable: true, value: (t, fn) => clientListeners.splice(0, clientListeners.length, ...clientListeners.filter(([x, y]) => !(x === t && y === fn))) });
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { origin: 'https://www.youtube.com' } });
    // The page's single window: a post from either world reaches the listeners of both, asynchronously.
    const deliver = (data, to) => queueMicrotask(() => to === 'client' ? clientListeners.filter(([t]) => t === 'message').forEach(([, fn]) => fn({ source: globalThis, origin: 'https://www.youtube.com', data: structuredClone(data) })) : main.send(structuredClone(data)));
    Object.defineProperty(globalThis, 'postMessage', { configurable: true, value: (data) => { deliver(data, 'main'); deliver(data, 'client'); } });
    main.win.onPost = (data) => { deliver(data, 'client'); deliver(data, 'main'); };
    return {
      p,
      main,
      client: AP.yt.bridge,
      restore() {
        AP.yt.bridge.stop();
        for (const [k, d] of Object.entries(saved)) {
          if (d) Object.defineProperty(globalThis, k, d);
          else delete globalThis[k];
        }
      },
    };
  }

  test('sets its attribute, answers commands after the handshake, and reports the player\'s answers', async () => {
    const w = await wire();
    try {
      assert.equal(w.main.attrs.get('data-at-peace-bridge'), '1');
      assert.deepEqual(await w.client.call('getPlayerState'), { ok: true, value: 2 });
      assert.deepEqual(await w.client.call('setAutonav', false), { ok: true });
      assert.deepEqual(w.p.calls, [['setAutonav', false]]);
      assert.deepEqual(await w.client.call('setPlaybackRate', 1.5), { ok: true, value: 1.5 });
      assert.deepEqual(await w.client.call('getPlaybackRate'), { ok: true, value: 1.5 });
      assert.deepEqual(await w.client.call('pauseVideo'), { ok: true });
      assert.deepEqual(await w.client.call('keepActive'), { ok: true });
      assert.equal(w.main.win._lact > 0, true);
    } finally {
      w.restore();
    }
  });

  test('bad commands and arguments fail politely and nothing else is exposed', async () => {
    const w = await wire();
    try {
      assert.deepEqual(await w.client.call('eval', '1+1'), { ok: false, error: 'bad-command' });
      assert.deepEqual(await w.client.call('constructor'), { ok: false, error: 'bad-command' });
      assert.deepEqual(await w.client.call('__proto__'), { ok: false, error: 'bad-command' });
      assert.deepEqual(await w.client.call('setPlaybackRate', 'fast'), { ok: false, error: 'bad-argument' });
      assert.deepEqual(await w.client.call('setPlaybackRate', 99), { ok: false, error: 'bad-argument' });
      assert.deepEqual(w.p.calls, []);
    } finally {
      w.restore();
    }
  });

  test('without a player the answer is no-player', async () => {
    const main = loadBridge({ player: null });
    main.send({ ns: 'at-peace', dir: 'hello', nonce: 'n'.repeat(20) });
    main.send({ ns: 'at-peace', dir: 'cmd', nonce: 'n'.repeat(20), id: 1, cmd: 'pauseVideo', args: [] });
    assert.deepEqual(plain(main.posted.at(-1)), { ns: 'at-peace', dir: 'res', nonce: 'n'.repeat(20), id: 1, ok: false, error: 'no-player' });
  });

  test('messages without the nonce, from other windows, or in the wrong shape are ignored', async () => {
    const p = player();
    const main = loadBridge({ player: p });
    const nonce = 'x'.repeat(24);
    main.send({ ns: 'at-peace', dir: 'cmd', nonce, id: 1, cmd: 'pauseVideo' }); // before any hello
    main.send({ ns: 'at-peace', dir: 'hello', nonce }, { not: 'the window' }); // another window
    main.send({ ns: 'at-peace', dir: 'cmd', nonce, id: 2, cmd: 'pauseVideo' });
    main.send({ ns: 'at-peace', dir: 'hello', nonce: 'short' });
    main.send({ ns: 'at-peace', dir: 'hello', nonce });
    for (const bad of [{ ns: 'at-peace', dir: 'cmd', nonce: 'wrong'.repeat(5), id: 3, cmd: 'pauseVideo' }, { ns: 'other', dir: 'cmd', nonce, id: 4, cmd: 'pauseVideo' }, 'pauseVideo', null, 42, { dir: 'cmd', nonce }]) main.send(bad);
    assert.deepEqual(p.calls, []);
    main.send({ ns: 'at-peace', dir: 'cmd', nonce, id: 5, cmd: 'pauseVideo' });
    assert.deepEqual(p.calls, [['pauseVideo']]);
  });

  test('the client only trusts messages from its own origin, and answers only for its own nonce', async () => {
    const saved = {};
    for (const k of ['addEventListener', 'removeEventListener', 'postMessage', 'location']) saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
    const listeners = [];
    const posted = [];
    Object.defineProperty(globalThis, 'addEventListener', { configurable: true, value: (t, fn) => listeners.push([t, fn]) });
    Object.defineProperty(globalThis, 'removeEventListener', { configurable: true, value: () => {} });
    Object.defineProperty(globalThis, 'postMessage', { configurable: true, value: (d) => posted.push(d) });
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { origin: 'https://www.youtube.com' } });
    const deliver = (data, origin = 'https://www.youtube.com') => listeners.filter(([t]) => t === 'message').forEach(([, fn]) => fn({ source: globalThis, origin, data }));
    try {
      let result = null;
      const call = AP.yt.bridge.call('getPlayerState').then((r) => (result = r));
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(posted[0].dir, 'hello');
      deliver({ ns: 'at-peace', dir: 'hello-ack' }, 'https://evil.example');
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(posted.some((m) => m.dir === 'cmd'), false, 'an ack from another origin does not complete the handshake');
      deliver({ ns: 'at-peace', dir: 'hello-ack' });
      await new Promise((r) => setTimeout(r, 30));
      const cmd = posted.find((m) => m.dir === 'cmd');
      assert.ok(cmd, 'the command goes out after a real ack');
      deliver({ ns: 'at-peace', dir: 'res', nonce: 'someone-elses-nonce-0123456789', id: cmd.id, ok: true, value: 9 });
      deliver({ ns: 'at-peace', dir: 'res', nonce: cmd.nonce, id: cmd.id, ok: true, value: 9 }, 'https://evil.example');
      await new Promise((r) => setTimeout(r, 30));
      assert.equal(result, null, 'neither a foreign nonce nor a foreign origin answers it');
      deliver({ ns: 'at-peace', dir: 'res', nonce: cmd.nonce, id: cmd.id, ok: true, value: 2 });
      await call;
      assert.deepEqual(result, { ok: true, value: 2 });
    } finally {
      AP.yt.bridge.stop();
      for (const [k, d] of Object.entries(saved)) {
        if (d) Object.defineProperty(globalThis, k, d);
        else delete globalThis[k];
      }
    }
  });

  test('with no bridge the client degrades: no-bridge, quickly, and never throws', async () => {
    const saved = {};
    for (const k of ['addEventListener', 'removeEventListener', 'postMessage', 'location']) saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
    Object.defineProperty(globalThis, 'addEventListener', { configurable: true, value: () => {} });
    Object.defineProperty(globalThis, 'removeEventListener', { configurable: true, value: () => {} });
    Object.defineProperty(globalThis, 'postMessage', { configurable: true, value: () => {} });
    Object.defineProperty(globalThis, 'location', { configurable: true, value: { origin: 'https://www.youtube.com' } });
    try {
      const started = Date.now();
      const first = await AP.yt.bridge.call('pauseVideo');
      assert.deepEqual(first, { ok: false, error: 'no-bridge' });
      assert.ok(Date.now() - started < 4000, 'the handshake gives up in a few seconds');
      const t1 = Date.now();
      assert.deepEqual(await AP.yt.bridge.call('pauseVideo'), { ok: false, error: 'no-bridge' });
      assert.ok(Date.now() - t1 < 100, 'later calls do not wait again');
    } finally {
      AP.yt.bridge.stop();
      for (const [k, d] of Object.entries(saved)) {
        if (d) Object.defineProperty(globalThis, k, d);
        else delete globalThis[k];
      }
    }
  });

  test('setTags: off by default, the switch is reported back', async () => {
    const w = await wire();
    try {
      assert.deepEqual(await w.client.call('setTags', true), { ok: true, value: true });
      assert.deepEqual(await w.client.call('setTags', false), { ok: true, value: false });
      assert.deepEqual(await w.client.call('retag'), { ok: true });
    } finally {
      w.restore();
    }
  });
});
