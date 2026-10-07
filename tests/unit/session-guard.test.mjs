// What "Finish this video" means on YouTube (src/sites/youtube/features/session-guard.js): when the
// video is finishable, and what makes the overlay come back. The page is a small fake: the feature
// only needs a document with a <video>, window events and a location.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadAtPeace, installFakeBrowser, uninstallFakeBrowser, CORE_SCRIPTS } from './_load.mjs';

let AP;
let world;

/** A listener registry that behaves like an EventTarget for the few things the feature uses. */
function target() {
  const map = new Map();
  return {
    addEventListener: (type, fn) => map.set(type, [...(map.get(type) ?? []), fn]),
    removeEventListener: (type, fn) => map.set(type, (map.get(type) ?? []).filter((f) => f !== fn)),
    fire(type, event = {}) {
      for (const fn of map.get(type) ?? []) fn({ type, ...event });
    },
    count: (type) => (map.get(type) ?? []).length,
  };
}

function buildWorld(href = 'https://www.youtube.com/watch?v=abc') {
  const doc = target();
  const win = target();
  const video = { ended: false, paused: false, closest: (sel) => (sel.includes('#movie_player') ? {} : null), play: () => { world.played++; return Promise.resolve(); } };
  const preview = { closest: () => null };
  world = { doc, win, video, preview, ad: false, href, played: 0 };
  doc.querySelector = (sel) => {
    if (sel.includes('ad-showing')) return world.ad ? {} : null;
    return world.noVideo ? null : world.video;
  };
  doc.querySelectorAll = () => [world.video];
  globalThis.document = doc;
  globalThis.window = win;
  Object.defineProperty(globalThis, 'location', { configurable: true, get: () => ({ href: world.href }) });
}

beforeEach(async () => {
  installFakeBrowser();
  AP = await loadAtPeace([...CORE_SCRIPTS, 'src/shared/schema-core.js', 'src/sites/youtube/page.js', 'src/sites/youtube/features/session-guard.js']);
  buildWorld();
});
afterEach(() => {
  delete globalThis.document;
  delete globalThis.window;
  delete globalThis.location;
  uninstallFakeBrowser();
});

const finish = () => AP.yt.sessionGuard.finish;

describe('pageKey', () => {
  test('a video is its id; time links and other parameters do not make it another video', () => {
    const k = AP.yt.sessionGuard.pageKey;
    assert.equal(k('https://www.youtube.com/watch?v=abc'), k('/watch?v=abc&t=90s'));
    assert.equal(k('/watch?v=abc&list=PL1'), k('/watch?v=abc'));
    assert.notEqual(k('/watch?v=abc'), k('/watch?v=def'));
    assert.notEqual(k('/watch?v=abc'), k('/'));
    assert.notEqual(k('/shorts/abc'), k('/shorts/def'));
  });
});

describe('available', () => {
  test('a watch page with a video that has not ended', () => {
    assert.equal(finish().available(), true);
    world.video.ended = true;
    assert.equal(finish().available(), false, 'nothing left to finish');
  });

  test('not on any other page, and not without a video', () => {
    world.href = 'https://www.youtube.com/';
    assert.equal(finish().available(), false);
    world.href = 'https://www.youtube.com/results?search_query=x';
    assert.equal(finish().available(), false);
    world.href = 'https://www.youtube.com/watch?v=abc';
    world.noVideo = true;
    assert.equal(finish().available(), false);
  });

  test('a page that is about to open: a watch page is finishable even though this video has ended', () => {
    world.video.ended = true;
    assert.equal(finish().available('/watch?v=next'), true);
    assert.equal(finish().available('/'), false);
    assert.equal(finish().available('/watch?v=abc'), false, 'the same ended video');
  });
});

describe('watch', () => {
  test('the main video ending calls back once the overlay can take over', () => {
    const calls = [];
    const stop = finish().watch((...a) => calls.push(a));
    world.doc.fire('ended', { target: world.video });
    assert.deepEqual(calls, [['ended']]);
    stop();
  });

  test('other media that ends (a hover preview, a different element) and ads are ignored', () => {
    const calls = [];
    finish().watch((...a) => calls.push(a));
    world.doc.fire('ended', { target: world.preview });
    world.ad = true;
    world.doc.fire('ended', { target: world.video });
    world.ad = false;
    assert.deepEqual(calls, []);
    world.doc.fire('ended', { target: world.video });
    assert.equal(calls.length, 1);
  });

  test('opening another video (yt-navigate-start) calls back with where it goes; the same video does not', () => {
    const calls = [];
    finish().watch((...a) => calls.push(a));
    world.win.fire('yt-navigate-start', { detail: { url: '/watch?v=abc&t=30s' } });
    assert.deepEqual(calls, [], 'a time link inside the same video');
    world.win.fire('yt-navigate-start', { detail: { url: '/watch?v=next' } });
    world.win.fire('yt-navigate-start', { detail: { endpoint: { commandMetadata: { webCommandMetadata: { url: '/' } } } } });
    assert.deepEqual(calls, [['navigate', { url: '/watch?v=next' }], ['navigate', { url: '/' }]]);
  });

  test('a navigation whose target cannot be read counts as leaving (better a second overlay than a missed one)', () => {
    const calls = [];
    finish().watch((...a) => calls.push(a));
    world.win.fire('yt-navigate-start', {});
    assert.deepEqual(calls, [['navigate', { url: null }]]);
  });

  test('Back/Forward (popstate) to another page calls back; to the same video it does not', () => {
    const calls = [];
    finish().watch((...a) => calls.push(a));
    world.win.fire('popstate');
    assert.deepEqual(calls, []);
    world.href = 'https://www.youtube.com/watch?v=other';
    world.win.fire('popstate');
    assert.deepEqual(calls, [['navigate', { url: 'https://www.youtube.com/watch?v=other' }]]);
  });

  test('stopping removes every listener', () => {
    const stop = finish().watch(() => {});
    assert.deepEqual([world.doc.count('ended'), world.win.count('yt-navigate-start'), world.win.count('popstate')], [1, 1, 1]);
    stop();
    assert.deepEqual([world.doc.count('ended'), world.win.count('yt-navigate-start'), world.win.count('popstate')], [0, 0, 0]);
  });
});
