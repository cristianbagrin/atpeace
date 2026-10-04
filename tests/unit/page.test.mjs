// YouTube page-type detection (src/sites/youtube/page.js): pure, URL in → page type out.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { uninstallFakeBrowser } from './_load.mjs';
import { freshWorld } from './_fixtures.mjs';

let AP;
let detect;

before(async () => {
  ({ AP } = await freshWorld({ catalog: 'none', engine: true }));
  detect = AP.yt.page.detect;
});
after(() => uninstallFakeBrowser());

const table = {
  home: ['https://www.youtube.com/', 'https://www.youtube.com', 'https://youtube.com/', '/', '/?app=desktop', '/?bp=abc#frag', 'https://www.youtube.com//', 'https://m.youtube.com/'],
  watch: [
    '/watch?v=dQw4w9WgXcQ',
    '/watch?v=dQw4w9WgXcQ&list=PLx0sYbCqOb8TBPRdmBHs5Iftvv9TPboYG&index=2',
    'https://www.youtube.com/watch?v=abc&t=42s',
    '/watch',
    '/watch/',
    '/WATCH?v=1',
    '/live/ABCDEFGHIJK',
    '/clip/UgkxABC123',
  ],
  search: ['/results?search_query=lofi', '/results?search_query=a+b&sp=EgIQAQ%253D%253D', 'https://www.youtube.com/results', '/results/'],
  shorts: ['/shorts/abc123', '/shorts/abc123?feature=share', '/shorts', '/shorts/'],
  subscriptions: ['/feed/subscriptions', '/feed/subscriptions/', '/feed/subscriptions?flow=1', '/feed/subscriptions/shorts'],
  history: ['/feed/history', '/feed/history/'],
  you: ['/feed/you', '/feed/library', '/feed/YOU'],
  hashtag: ['/hashtag/music', '/hashtag/music/shorts', '/hashtag/%E3%81%82', '/HASHTAG/x'],
  playlist: ['/playlist?list=PL123', '/playlist?list=WL', 'https://www.youtube.com/playlist'],
  channel: [
    '/@mkbhd',
    '/@mkbhd/videos',
    '/@mkbhd/shorts',
    '/@mkbhd/playlists?view=1',
    '/@%E3%81%82%E3%81%84',
    '/@a',
    '/channel/UCBJycsmduvYEL83R_U4JriQ',
    '/channel/UCBJycsmduvYEL83R_U4JriQ/shorts',
    '/channel/UCBJycsmduvYEL83R_U4JriQ/videos?view=0&sort=dd',
    '/c/GoogleDevelopers',
    '/c/GoogleDevelopers/videos',
    '/user/PewDiePie',
    '/user/PewDiePie/featured',
  ],
  other: [
    '/premium',
    '/account',
    '/feed',
    '/feed/',
    // YouTube redirects these to "/" now; they get no page type of their own
    '/feed/trending',
    '/feed/explore',
    '/feed/storefront',
    '/feed/news_destination',
    '/feed/channels',
    '/gaming',
    '/gaming/games',
    '/hashtag',
    '/hashtag/',
    '/channel',
    '/channel/',
    '/c/',
    '/user',
    '/@',
    '/live',
    '/clip',
    '/embed/abc',
    '/podcasts',
    '/t/terms',
    '/s/something',
    '/watchlater',
    '',
    '/results2',
    '/shortsfeed',
    '/channelz',
    'https://music.youtube.com/',
    'https://music.youtube.com/watch?v=1',
    'https://studio.youtube.com/',
    'https://www.google.com/watch?v=1',
    'https://youtube.com.evil.example/watch?v=1',
    'https://evilyoutube.com/results',
    'https://www.youtube.com:evil',
    'http://[bad',
    'javascript:alert(1)',
    'about:blank',
    'moz-extension://abc/src/pages/pause/pause.html#https://www.youtube.com/watch?v=1',
  ],
};

describe('detect(url)', () => {
  for (const [page, urls] of Object.entries(table)) {
    test(`${page}`, () => {
      for (const url of urls) assert.equal(detect(url), page, url);
    });
  }

  test('never throws and returns "other" for non-URLs', () => {
    for (const junk of [undefined, null, 0, 5, {}, [], true, Symbol.iterator.toString()]) assert.equal(detect(junk), 'other', String(junk));
    assert.equal(detect(new URL('https://www.youtube.com/results?search_query=x')), 'search');
  });

  test('every answer is one of TYPES, and TYPES are valid `page:` names for the schema', () => {
    const types = new Set(AP.yt.page.TYPES);
    for (const url of Object.values(table).flat()) assert.ok(types.has(detect(url)), url);
    assert.equal(types.size, AP.yt.page.TYPES.length);
    assert.ok(Object.isFrozen(AP.yt.page.TYPES));
    assert.ok(!types.has('explore'), 'explore is not a page type any more');
    for (const t of types) assert.match(t, /^[a-z][a-z0-9-]*$/);
    // page.js registered them, so a setting with an unknown `page:` is reported:
    AP.schema.section({ id: 'yt.t', site: 'youtube', title: 'T', order: 150 });
    AP.schema.define('yt.t', [{ id: 'yt.t.a', label: 'a', type: 'toggle', default: false, hide: ['x'], page: 'wach' }]);
    assert.ok(AP.schema.validateRegistry().some((p) => /unknown youtube page type "wach"/.test(p)));
  });

  test('the page types of PLAN §6.1 are all there', () => {
    for (const t of ['home', 'watch', 'search', 'shorts', 'subscriptions', 'channel', 'playlist', 'history', 'you', 'hashtag', 'other']) {
      assert.ok(AP.yt.page.TYPES.includes(t), t);
    }
  });
});

describe('urlFromNavigateEvent(event)', () => {
  const fromDetail = (detail) => AP.yt.page.urlFromNavigateEvent({ detail });

  test('reads detail.url, or the endpoint webCommandMetadata url (a path)', () => {
    assert.equal(fromDetail({ url: '/results?search_query=lofi', pageType: 'search' }), '/results?search_query=lofi');
    assert.equal(fromDetail({ endpoint: { commandMetadata: { webCommandMetadata: { url: '/watch?v=abc' } } } }), '/watch?v=abc');
    assert.equal(fromDetail({ url: '/a', endpoint: { commandMetadata: { webCommandMetadata: { url: '/b' } } } }), '/a');
  });

  test('unreadable details give null (the engine has other sources)', () => {
    for (const detail of [null, undefined, {}, { url: 5 }, { url: '' }, { endpoint: {} }, 'x']) assert.equal(fromDetail(detail), null, JSON.stringify(detail));
    assert.equal(AP.yt.page.urlFromNavigateEvent(null), null);
    const opaque = { get detail() { throw new Error('Permission denied to access property "detail"'); } };
    assert.equal(AP.yt.page.urlFromNavigateEvent(opaque), null);
  });

  test('falls back to wrappedJSObject.detail (Firefox) when detail is opaque', () => {
    const event = {
      get detail() { throw new Error('Permission denied'); },
      wrappedJSObject: { detail: { url: '/shorts/abc' } },
    };
    assert.equal(AP.yt.page.urlFromNavigateEvent(event), '/shorts/abc');
  });

  test('declares the feature list that feature files push into', () => {
    assert.ok(Array.isArray(AP.yt.features));
  });
});
