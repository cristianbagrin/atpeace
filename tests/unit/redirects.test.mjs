// YouTube redirect catalogue (src/sites/youtube/redirects.js, Contract C2): pure functions, so the
// tests are tables of URL -> expected answer, plus a check that the DNR rules (full page loads) and
// rewrite() (in-app navigation) agree, and that every DNR regex is RE2-compatible.
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { loadAtPeace, uninstallFakeBrowser, CORE_SCRIPTS } from './_load.mjs';

let R;
const BLOCKED = 'moz-extension://uuid/src/pages/blocked/blocked.html';
const WWW = 'https://www.youtube.com';

before(async () => {
  const AP = await loadAtPeace([...CORE_SCRIPTS, 'src/sites/youtube/redirects.js']);
  R = AP.yt.redirects;
});
after(() => uninstallFakeBrowser());

const S = (extra = {}) => ({
  'yt.home.feedMode': 'show',
  'yt.home.redirectUrl': '',
  'yt.shorts.mode': 'allow',
  'yt.channel.openVideosTab': false,
  ...extra,
});
const rewrite = (url, settings) => R.rewrite(url, settings, { blockedPageUrl: BLOCKED });

/** What the browser would do with the DNR rules: highest priority wins; `\0`-`\9` are capture groups. */
function applyDnr(rules, url) {
  const hits = rules
    .filter((r) => new RegExp(r.condition.regexFilter, r.condition.isUrlFilterCaseSensitive ? '' : 'i').test(url))
    .sort((a, b) => (b.priority ?? 100) - (a.priority ?? 100));
  if (hits.length === 0) return null;
  const rule = hits[0];
  const m = new RegExp(rule.condition.regexFilter, 'i').exec(url);
  return rule.action.redirect.regexSubstitution.replace(/\\(\d)/g, (_all, n) => m[Number(n)] ?? '');
}

describe('home feed redirects', () => {
  const HOMES = ['https://www.youtube.com/', 'https://www.youtube.com', 'https://youtube.com/', 'https://m.youtube.com/', '/', '/?app=desktop', '/?bp=abc&hl=de#frag', 'http://www.youtube.com/'];

  test('each redirecting mode sends every spelling of the home URL to its page', () => {
    const modes = { subscriptions: `${WWW}/feed/subscriptions`, watchLater: `${WWW}/playlist?list=WL`, playlists: `${WWW}/feed/playlists` };
    for (const [mode, target] of Object.entries(modes)) {
      for (const url of HOMES) assert.equal(rewrite(url, S({ 'yt.home.feedMode': mode })), target, `${mode}: ${url}`);
    }
  });

  test('show and hide leave the home page where it is (hide draws a placeholder instead)', () => {
    for (const mode of ['show', 'hide']) for (const url of HOMES) assert.equal(rewrite(url, S({ 'yt.home.feedMode': mode })), null, mode);
  });

  test('other pages never redirect to the home target', () => {
    const settings = S({ 'yt.home.feedMode': 'subscriptions' });
    for (const url of ['/watch?v=abcdefghijk', '/results?search_query=x', '/feed/subscriptions', '/feed/history', '/@mkbhd', '/playlist?list=WL', '/premium']) {
      assert.equal(rewrite(url, settings), null, url);
    }
  });

  describe('custom address (validated)', () => {
    const custom = (value) => S({ 'yt.home.feedMode': 'custom', 'yt.home.redirectUrl': value });

    test('a path or an https youtube.com address works and is normalised to www', () => {
      assert.equal(rewrite('/', custom('/playlist?list=PL123')), `${WWW}/playlist?list=PL123`);
      assert.equal(rewrite('/', custom('  /@mkbhd/videos ')), `${WWW}/@mkbhd/videos`);
      assert.equal(rewrite('/', custom('https://www.youtube.com/feed/history')), `${WWW}/feed/history`);
      assert.equal(rewrite('/', custom('https://youtube.com/results?search_query=a+b')), `${WWW}/results?search_query=a+b`);
    });

    test('anything else is ignored (no redirect, the placeholder takes over)', () => {
      const bad = [
        '', '   ', 'javascript:alert(1)', 'data:text/html,x', '//evil.example/x', '/\\evil.example', 'https://evil.example/', 'https://www.youtube.com.evil.example/',
        'http://www.youtube.com/x', 'https://m.youtube.com/x', 'https://music.youtube.com/', 'https://user:pw@www.youtube.com/x', 'https://www.youtube.com:8443/x',
        'feed/subscriptions', '/with space', 'x'.repeat(501), '/', '/?x=1', 'https://www.youtube.com/', 'https://www.youtube.com',
      ];
      for (const value of bad) assert.equal(rewrite('/', custom(value)), null, JSON.stringify(value).slice(0, 40));
      assert.equal(R.customTarget(42), null);
      assert.equal(R.customTarget(undefined), null);
      assert.deepEqual(R.dnrRules(custom('//evil.example/x'), { blockedPageUrl: BLOCKED }), []);
    });
  });
});

describe('Shorts', () => {
  const ID = 'dQw4w9WgXcQ';
  const SHORTS = [`/shorts/${ID}`, `https://www.youtube.com/shorts/${ID}`, `https://youtube.com/shorts/${ID}?feature=share`, `https://m.youtube.com/shorts/${ID}`, `/SHORTS/${ID}`, `/shorts/${ID}/`, `/shorts/${ID}?si=abc#t`];

  test('allow: nothing happens', () => {
    for (const url of [...SHORTS, '/shorts']) assert.equal(rewrite(url, S()), null, url);
  });

  test('watch: a Short opens in the normal player; the feed and malformed ids get the blocked page', () => {
    const settings = S({ 'yt.shorts.mode': 'watch' });
    for (const url of SHORTS) assert.equal(rewrite(url, settings), `${WWW}/watch?v=${ID}`, url);
    assert.equal(rewrite('/shorts', settings), `${BLOCKED}?reason=shorts#${WWW}/shorts`);
    assert.equal(rewrite('/shorts/', settings), `${BLOCKED}?reason=shorts#${WWW}/shorts/`);
    assert.equal(rewrite('/shorts/ab', settings), `${WWW}/watch?v=ab`, 'no length bound (the DNR regex has none)');
    assert.equal(rewrite('/shorts/a%20b', settings), `${BLOCKED}?reason=shorts#${WWW}/shorts/a%20b`);
    // Ids are `[A-Za-z0-9_-]+`: a dash and an underscore are legal.
    assert.equal(rewrite('/shorts/a_b-c_d-e_f', settings), `${WWW}/watch?v=a_b-c_d-e_f`);
  });

  test('block: every Shorts URL goes to the blocked page with the original URL in the hash', () => {
    const settings = S({ 'yt.shorts.mode': 'block' });
    assert.equal(rewrite(`/shorts/${ID}`, settings), `${BLOCKED}?reason=shorts#${WWW}/shorts/${ID}`);
    assert.equal(rewrite('https://youtube.com/shorts/abc123xyz?feature=share', settings), `${BLOCKED}?reason=shorts#https://youtube.com/shorts/abc123xyz?feature=share`);
    assert.equal(rewrite('/shorts', settings), `${BLOCKED}?reason=shorts#${WWW}/shorts`);
  });

  test('block without a blocked-page URL answers null rather than a broken address', () => {
    assert.equal(R.rewrite(`/shorts/${ID}`, S({ 'yt.shorts.mode': 'block' })), null);
    assert.equal(R.rewrite('/shorts', S({ 'yt.shorts.mode': 'watch' })), null);
    assert.equal(R.rewrite(`/shorts/${ID}`, S({ 'yt.shorts.mode': 'watch' })), `${WWW}/watch?v=${ID}`);
  });

  test('similar-looking paths are not Shorts', () => {
    const settings = S({ 'yt.shorts.mode': 'block' });
    for (const url of ['/shortsfoo', '/@mkbhd/shorts', '/hashtag/shorts', '/results?search_query=shorts', '/watch?v=abcdefghijk&feature=shorts', '/feed/subscriptions/shorts']) {
      assert.equal(rewrite(url, settings), null, url);
    }
  });
});

describe('channel root -> Videos tab', () => {
  const settings = S({ 'yt.channel.openVideosTab': true });

  test('only a bare channel root is rewritten', () => {
    const table = {
      '/@mkbhd': `${WWW}/@mkbhd/videos`,
      '/@mkbhd/': `${WWW}/@mkbhd/videos`,
      'https://www.youtube.com/@mkbhd?app=desktop': `${WWW}/@mkbhd/videos`,
      'https://youtube.com/@MrBeast': `${WWW}/@MrBeast/videos`,
      '/@%E3%81%82%E3%81%84': `${WWW}/@%E3%81%82%E3%81%84/videos`,
      '/channel/UCBJycsmduvYEL83R_U4JriQ': `${WWW}/channel/UCBJycsmduvYEL83R_U4JriQ/videos`,
      '/c/GoogleDevelopers': `${WWW}/c/GoogleDevelopers/videos`,
      '/user/PewDiePie': `${WWW}/user/PewDiePie/videos`,
    };
    for (const [url, expected] of Object.entries(table)) assert.equal(rewrite(url, settings), expected, url);
  });

  test('sub-tabs, the bare prefixes and other pages are never touched', () => {
    for (const url of [
      '/@mkbhd/videos', '/@mkbhd/shorts', '/@mkbhd/featured', '/@mkbhd/playlists', '/@mkbhd/about', '/@mkbhd/search?query=x',
      '/channel/UCBJycsmduvYEL83R_U4JriQ/videos', '/channel', '/channel/', '/c', '/user', '/@', '/watch?v=abcdefghijk', '/results?search_query=@mkbhd', '/feed/subscriptions',
    ]) {
      assert.equal(rewrite(url, settings), null, url);
    }
  });

  test('off by default', () => {
    assert.equal(rewrite('/@mkbhd', S()), null);
  });

  test('no foreign hosts, no junk input', () => {
    for (const url of ['https://example.com/@mkbhd', 'https://music.youtube.com/@mkbhd', 'https://www.youtube.com.evil.example/@mkbhd', 'ftp://youtube.com/@mkbhd', '', null, undefined, 42, {}]) {
      assert.equal(rewrite(url, settings), null, String(url));
    }
    assert.equal(R.rewrite('/@mkbhd', null), null);
  });
});

describe('no redirect loops', () => {
  test('following a rewrite never leads to another rewrite of the same kind, for every mode', () => {
    const urls = ['/', '/shorts/dQw4w9WgXcQ', '/shorts', '/@mkbhd', '/channel/UCBJycsmduvYEL83R_U4JriQ'];
    for (const feedMode of ['show', 'hide', 'subscriptions', 'watchLater', 'playlists', 'custom']) {
      for (const shortsMode of ['allow', 'watch', 'block']) {
        for (const openVideosTab of [false, true]) {
          const settings = S({ 'yt.home.feedMode': feedMode, 'yt.home.redirectUrl': '/@mkbhd', 'yt.shorts.mode': shortsMode, 'yt.channel.openVideosTab': openVideosTab });
          for (const url of urls) {
            // Follow the chain; it must end (a loop would never reach null).
            let at = url;
            let hops = 0;
            for (let next = rewrite(at, settings); next; next = rewrite(at, settings)) {
              if (next.startsWith(BLOCKED)) break; // the blocked page is an extension page: not a YouTube URL
              at = next;
              assert.ok(++hops <= 3, `loop: ${url} with ${JSON.stringify(settings)}`);
            }
          }
        }
      }
    }
  });
});

describe('DNR rules (full page loads)', () => {
  const rules = (extra) => R.dnrRules(S(extra), { blockedPageUrl: BLOCKED });
  const keys = (extra) => rules(extra).map((r) => r.key).sort();

  test('defaults produce no rules', () => {
    assert.deepEqual(rules(), []);
    assert.deepEqual(R.dnrRules(null, { blockedPageUrl: BLOCKED }), []);
    assert.deepEqual(R.dnrRules(S(), undefined), []);
  });

  test('keys are stable names per feature', () => {
    assert.deepEqual(keys({ 'yt.home.feedMode': 'subscriptions' }), ['home']);
    assert.deepEqual(keys({ 'yt.home.feedMode': 'hide' }), []);
    assert.deepEqual(keys({ 'yt.home.feedMode': 'custom' }), []); // no valid address yet
    assert.deepEqual(keys({ 'yt.home.feedMode': 'custom', 'yt.home.redirectUrl': '/feed/history' }), ['home']);
    assert.deepEqual(keys({ 'yt.shorts.mode': 'block' }), ['shorts']);
    assert.deepEqual(keys({ 'yt.shorts.mode': 'watch' }), ['shorts', 'shorts-feed']);
    assert.deepEqual(keys({ 'yt.channel.openVideosTab': true }), ['channel-videos']);
    assert.deepEqual(keys({ 'yt.home.feedMode': 'playlists', 'yt.shorts.mode': 'block', 'yt.channel.openVideosTab': true }), ['channel-videos', 'home', 'shorts']);
  });

  test('every rule is a main_frame redirect with a regexSubstitution, case-insensitive, no ids', () => {
    for (const r of rules({ 'yt.home.feedMode': 'watchLater', 'yt.shorts.mode': 'watch', 'yt.channel.openVideosTab': true })) {
      assert.equal(r.action.type, 'redirect');
      assert.equal(typeof r.action.redirect.regexSubstitution, 'string');
      assert.deepEqual(r.condition.resourceTypes, ['main_frame']);
      assert.equal(r.condition.isUrlFilterCaseSensitive, false);
      assert.equal('id' in r, false);
      assert.ok(r.priority === undefined || (Number.isInteger(r.priority) && r.priority > 100 && r.priority < 200), 'redirect priorities stay below the pause (200) and block (300) rules');
    }
  });

  test('regexes are RE2-compatible: no lookaround, no backreferences, no lazy/possessive tricks, and they compile', () => {
    for (const [name, source] of Object.entries(R.REGEX)) {
      assert.doesNotMatch(source, /\(\?[=!<]/, `${name}: lookaround`);
      assert.doesNotMatch(source.replace(/\\\\/g, ''), /\\[1-9]/, `${name}: backreference`);
      assert.doesNotMatch(source, /\(\?>|\*\+|\+\+|\?\+|\(\?P?=/, `${name}: unsupported construct`);
      assert.doesNotMatch(source, /\{\d+(,\d*)?\}/, `${name}: counted repetition (Chrome: memoryLimitExceeded)`);
      assert.doesNotThrow(() => new RegExp(source), name);
      assert.ok(source.startsWith('^') && source.endsWith('$'), `${name}: anchored (so \\0 is the whole URL)`);
    }
  });

  test('home: matches the home URL (any host spelling, query, fragment) and nothing else', () => {
    const r = rules({ 'yt.home.feedMode': 'subscriptions' });
    for (const url of ['https://www.youtube.com/', 'https://www.youtube.com', 'https://youtube.com/', 'https://m.youtube.com/', 'https://www.youtube.com/?bp=abc&hl=de', 'https://www.youtube.com/?x=1#f', 'http://www.youtube.com/']) {
      assert.equal(applyDnr(r, url), `${WWW}/feed/subscriptions`, url);
    }
    for (const url of ['https://www.youtube.com/watch?v=abc', 'https://www.youtube.com/feed/subscriptions', 'https://www.youtube.com//', 'https://music.youtube.com/', 'https://studio.youtube.com/', 'https://tv.youtube.com/', 'https://www.youtube.com.evil.example/', 'https://example.com/?u=https://www.youtube.com/', 'https://notyoutube.com/', 'https://www.youtube.com/@mkbhd']) {
      assert.equal(applyDnr(r, url), null, url);
    }
  });

  test('shorts watch: id URLs go to /watch?v=ID, other /shorts URLs to the blocked page; block: all to the blocked page', () => {
    const watch = rules({ 'yt.shorts.mode': 'watch' });
    assert.equal(applyDnr(watch, 'https://www.youtube.com/shorts/dQw4w9WgXcQ'), `${WWW}/watch?v=dQw4w9WgXcQ`);
    assert.equal(applyDnr(watch, 'https://youtube.com/shorts/dQw4w9WgXcQ?feature=share'), `${WWW}/watch?v=dQw4w9WgXcQ`);
    assert.equal(applyDnr(watch, 'https://m.youtube.com/shorts/dQw4w9WgXcQ/'), `${WWW}/watch?v=dQw4w9WgXcQ`);
    assert.equal(applyDnr(watch, 'https://www.youtube.com/shorts'), `${BLOCKED}?reason=shorts#https://www.youtube.com/shorts`);
    assert.equal(applyDnr(watch, 'https://www.youtube.com/shorts/'), `${BLOCKED}?reason=shorts#https://www.youtube.com/shorts/`);
    assert.equal(applyDnr(watch, 'https://www.youtube.com/shorts/ab'), `${WWW}/watch?v=ab`);
    assert.equal(applyDnr(watch, 'https://www.youtube.com/shorts/a%20b'), `${BLOCKED}?reason=shorts#https://www.youtube.com/shorts/a%20b`);
    assert.equal(applyDnr(watch, 'https://www.youtube.com/@mkbhd/shorts'), null);
    assert.equal(applyDnr(watch, 'https://www.youtube.com/shortsfoo'), null);

    const block = rules({ 'yt.shorts.mode': 'block' });
    assert.equal(applyDnr(block, 'https://www.youtube.com/shorts/dQw4w9WgXcQ?feature=share#x'), `${BLOCKED}?reason=shorts#https://www.youtube.com/shorts/dQw4w9WgXcQ?feature=share#x`);
    assert.equal(applyDnr(block, 'https://www.youtube.com/shorts'), `${BLOCKED}?reason=shorts#https://www.youtube.com/shorts`);
    assert.equal(applyDnr(block, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'), null);
    assert.equal(applyDnr(block, 'https://www.youtube.com/@mkbhd/shorts'), null);
  });

  test('channel root: only the bare root, keeping the channel path', () => {
    const r = rules({ 'yt.channel.openVideosTab': true });
    const table = {
      'https://www.youtube.com/@mkbhd': `${WWW}/@mkbhd/videos`,
      'https://www.youtube.com/@mkbhd/': `${WWW}/@mkbhd/videos`,
      'https://youtube.com/@MrBeast?si=x': `${WWW}/@MrBeast/videos`,
      'https://www.youtube.com/channel/UCBJycsmduvYEL83R_U4JriQ': `${WWW}/channel/UCBJycsmduvYEL83R_U4JriQ/videos`,
      'https://www.youtube.com/c/GoogleDevelopers': `${WWW}/c/GoogleDevelopers/videos`,
      'https://www.youtube.com/user/PewDiePie': `${WWW}/user/PewDiePie/videos`,
      'https://www.youtube.com/@mkbhd/videos': null,
      'https://www.youtube.com/@mkbhd/featured': null,
      'https://www.youtube.com/@mkbhd/shorts': null,
      'https://www.youtube.com/channel/UCBJycsmduvYEL83R_U4JriQ/playlists': null,
      'https://www.youtube.com/channel': null,
      'https://www.youtube.com/channel/': null,
      'https://www.youtube.com/watch?v=abc': null,
      'https://music.youtube.com/@mkbhd': null,
    };
    for (const [url, expected] of Object.entries(table)) assert.equal(applyDnr(r, url), expected, url);
  });

  test('DNR and rewrite() agree on where every URL goes (full loads and in-app navigation behave the same)', () => {
    const urls = [
      'https://www.youtube.com/', 'https://www.youtube.com/?bp=x', 'https://youtube.com/', 'https://m.youtube.com/',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ', 'https://www.youtube.com/shorts/dQw4w9WgXcQ?feature=share', 'https://www.youtube.com/shorts', 'https://www.youtube.com/shorts/', 'https://www.youtube.com/shorts/ab',
      'https://www.youtube.com/@mkbhd', 'https://www.youtube.com/@mkbhd/', 'https://www.youtube.com/@mkbhd/videos', 'https://www.youtube.com/channel/UCBJycsmduvYEL83R_U4JriQ', 'https://www.youtube.com/c/Foo', 'https://www.youtube.com/user/Foo',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/results?search_query=x', 'https://www.youtube.com/feed/subscriptions', 'https://www.youtube.com/playlist?list=WL',
    ];
    for (const feedMode of ['show', 'hide', 'subscriptions', 'watchLater', 'playlists', 'custom']) {
      for (const shortsMode of ['allow', 'watch', 'block']) {
        for (const openVideosTab of [false, true]) {
          const settings = S({ 'yt.home.feedMode': feedMode, 'yt.home.redirectUrl': '/feed/history', 'yt.shorts.mode': shortsMode, 'yt.channel.openVideosTab': openVideosTab });
          const dnr = R.dnrRules(settings, { blockedPageUrl: BLOCKED });
          for (const url of urls) {
            // The host spelling of the blocked page's hash differs (rewrite() keeps the URL as given, DNR's \0 too): compare as-is.
            assert.equal(applyDnr(dnr, url), rewrite(url, settings), `${url} with ${feedMode}/${shortsMode}/${openVideosTab}`);
          }
        }
      }
    }
  });

  test('the Shorts block rule needs the blocked page URL; without it no broken rule is emitted', () => {
    assert.deepEqual(R.dnrRules(S({ 'yt.shorts.mode': 'block' }), {}), []);
    assert.deepEqual(R.dnrRules(S({ 'yt.shorts.mode': 'watch' }), {}).map((r) => r.key), ['shorts']);
  });
});
