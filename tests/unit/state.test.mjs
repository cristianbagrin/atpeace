// State/stats read helpers and pure functions (src/shared/state.js).
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { uninstallFakeBrowser } from './_load.mjs';
import { freshWorld } from './_fixtures.mjs';

let AP;
let fake;

beforeEach(async () => {
  ({ AP, fake } = await freshWorld({ catalog: 'none' }));
});
afterEach(() => uninstallFakeBrowser());

const local = (items) => new Date(...items).getTime(); // [y, m(0-based), d, h?, min?]

describe('normalizeState / getState', () => {
  test('nothing or garbage stored → an empty but fully shaped state', async () => {
    const empty = { sessions: {}, block: null, extraTime: {}, scheduleOverride: null };
    assert.deepEqual(await AP.state.getState(), empty);
    for (const junk of [null, 'x', 5, [], { sessions: 'x', block: 'x', extraTime: 3, scheduleOverride: 9 }]) {
      assert.deepEqual(AP.state.normalizeState(junk), empty, JSON.stringify(junk));
    }
  });

  test('valid parts are kept, bad entries dropped', async () => {
    await fake.storage.local.set({
      state: {
        sessions: { youtube: 1700000000000, 'reddit.com': 'soon', zero: 0, neg: -5 },
        block: { until: 1700000999999, reason: 'limit', siteKeys: ['youtube', 5, 'x.com'] },
        extraTime: { '2026-01-02': 5, 'yesterday': 3, '2026-01-03': -1 },
        scheduleOverride: 'focused',
      },
    });
    assert.deepEqual(await AP.state.getState(), {
      sessions: { youtube: 1700000000000 },
      block: { until: 1700000999999, reason: 'limit', siteKeys: ['youtube', 'x.com'] },
      extraTime: { '2026-01-02': 5, '2026-01-03': 0 },
      scheduleOverride: 'focused',
    });
  });

  test('a block needs a numeric `until`; a missing reason defaults to focus; empty override is null', () => {
    assert.equal(AP.state.normalizeState({ block: { reason: 'focus' } }).block, null);
    assert.equal(AP.state.normalizeState({ block: { until: Infinity } }).block, null);
    assert.deepEqual(AP.state.normalizeState({ block: { until: 5 } }).block, { until: 5, reason: 'focus', siteKeys: [] });
    assert.equal(AP.state.normalizeState({ scheduleOverride: '' }).scheduleOverride, null);
  });

  test('getState returns a detached copy', async () => {
    await fake.storage.local.set({ state: { sessions: { youtube: 5 } } });
    const a = await AP.state.getState();
    a.sessions.youtube = 99;
    assert.equal((await AP.state.getState()).sessions.youtube, 5);
  });
});

describe('stats', () => {
  const day = '2026-03-04';
  beforeEach(() =>
    fake.storage.local.set({
      stats: {
        [day]: { youtube: { activeSec: 600, opens: 4, turnedBack: 1, continued: 3, blockedHits: 0, extra: 9 }, 'reddit.com': { activeSec: 'many' } },
        '2026-03-03': { youtube: { activeSec: 60 } },
        'not-a-day': { youtube: {} },
      },
    }),
  );

  test('getStats() normalizes every day; getStats(day) returns that day or {}', async () => {
    const all = await AP.state.getStats();
    assert.deepEqual(Object.keys(all).sort(), ['2026-03-03', day]);
    assert.deepEqual(all[day].youtube, { activeSec: 600, opens: 4, turnedBack: 1, continued: 3, blockedHits: 0 });
    assert.deepEqual(all[day]['reddit.com'], AP.state.emptyCounters());
    assert.deepEqual(await AP.state.getStats('2026-03-03'), { youtube: { activeSec: 60, opens: 0, turnedBack: 0, continued: 0, blockedHits: 0 } });
    assert.deepEqual(await AP.state.getStats('1999-01-01'), {});
  });

  test('todayFor uses the LOCAL calendar day and zero-fills', async () => {
    const noon = local([2026, 2, 4, 12, 0]);
    assert.deepEqual(await AP.state.todayFor('youtube', noon), { activeSec: 600, opens: 4, turnedBack: 1, continued: 3, blockedHits: 0 });
    assert.deepEqual(await AP.state.todayFor('unknown.com', noon), AP.state.emptyCounters());
    const lateNight = local([2026, 2, 4, 23, 59]);
    assert.equal((await AP.state.todayFor('youtube', lateNight)).opens, 4);
    const nextMorning = local([2026, 2, 5, 0, 1]);
    assert.equal((await AP.state.todayFor('youtube', nextMorning)).opens, 0);
  });

  test('empty counters are not shared', () => {
    const a = AP.state.emptyCounters();
    a.opens = 5;
    assert.equal(AP.state.emptyCounters().opens, 0);
  });
});

describe('pruneStats', () => {
  const stats = { '2026-01-01': { a: 1 }, '2026-03-01': { a: 2 }, '2026-03-30': { a: 3 }, '2026-03-31': { a: 4 }, 'junk': { a: 5 }, '2026-3-1': { a: 6 } };
  const now = local([2026, 2, 31, 15, 0]);

  test('keeps the last N calendar days including today, drops older days and non-day keys', () => {
    assert.deepEqual(Object.keys(AP.state.pruneStats(stats, 2, now)), ['2026-03-30', '2026-03-31']);
    assert.deepEqual(Object.keys(AP.state.pruneStats(stats, 1, now)), ['2026-03-31']);
    assert.deepEqual(Object.keys(AP.state.pruneStats(stats, 31, now)), ['2026-03-01', '2026-03-30', '2026-03-31']);
    assert.deepEqual(Object.keys(AP.state.pruneStats(stats, 32, now)), ['2026-03-01', '2026-03-30', '2026-03-31'].filter((d) => d >= '2026-02-28'));
    assert.deepEqual(Object.keys(AP.state.pruneStats(stats, 90, now)), ['2026-01-01', '2026-03-01', '2026-03-30', '2026-03-31']);
  });

  test('default keeps 90 days', () => {
    assert.equal(AP.state.DEFAULT_KEEP_DAYS, 90);
    const old = { '2025-12-31': {}, '2026-01-01': {} };
    // 90 days ending 2026-03-31 start on 2026-01-01
    assert.deepEqual(Object.keys(AP.state.pruneStats(old, undefined, now)), ['2026-01-01']);
  });

  test('is pure, tolerates junk, and clamps nonsense keepDays to one day', () => {
    const copy = structuredClone(stats);
    AP.state.pruneStats(stats, 2, now);
    assert.deepEqual(stats, copy);
    assert.deepEqual(AP.state.pruneStats(null, 90, now), {});
    assert.deepEqual(Object.keys(AP.state.pruneStats(stats, 0, now)), ['2026-03-31']);
    assert.deepEqual(Object.keys(AP.state.pruneStats(stats, -5, now)), ['2026-03-31']);
  });

  test('the cutoff is calendar arithmetic, so a DST change does not shift it by a day', () => {
    // 2026-03-29 is the EU spring-forward day; whatever the machine time zone, 3 days ending on the 30th start on the 28th.
    const s = { '2026-03-27': 1, '2026-03-28': 1, '2026-03-29': 1, '2026-03-30': 1 };
    assert.deepEqual(Object.keys(AP.state.pruneStats(s, 3, local([2026, 2, 30, 0, 30]))), ['2026-03-28', '2026-03-29', '2026-03-30']);
  });
});

describe('siteKeyForUrl', () => {
  const sites = [
    { siteKey: 'youtube', domain: 'youtube.com', enabled: true },
    { siteKey: 'reddit.com', domain: 'reddit.com', enabled: false },
    { siteKey: 'old.reddit.com', domain: 'old.reddit.com', enabled: true },
  ];
  const key = (url) => AP.state.siteKeyForUrl(url, sites);

  test('YouTube covers youtube.com, www and m only — not music/studio/tv', () => {
    assert.equal(key('https://www.youtube.com/watch?v=1'), 'youtube');
    assert.equal(key('https://youtube.com/'), 'youtube');
    assert.equal(key('http://m.youtube.com/feed/subscriptions'), 'youtube');
    assert.equal(key('https://music.youtube.com/'), null);
    assert.equal(key('https://studio.youtube.com/'), null);
    assert.equal(key('https://tv.youtube.com/'), null);
    assert.equal(key('https://notyoutube.com/'), null);
    assert.equal(key('https://youtube.com.evil.example/'), null);
  });

  test('other sites match their domain and any subdomain; the most specific domain wins; enabled is ignored', () => {
    assert.equal(key('https://reddit.com/r/x'), 'reddit.com');
    assert.equal(key('https://www.reddit.com/r/x'), 'reddit.com');
    assert.equal(key('https://old.reddit.com/r/x'), 'old.reddit.com');
    assert.equal(key('https://a.b.old.reddit.com/'), 'old.reddit.com');
    assert.equal(key('https://fakereddit.com/'), null);
    assert.equal(key('https://reddit.com.evil.example/'), null);
  });

  test('case, trailing dot, ports and URL objects', () => {
    assert.equal(key('https://WWW.YouTube.com./watch'), 'youtube');
    assert.equal(key('https://www.youtube.com:8443/'), 'youtube');
    assert.equal(key(new URL('https://www.youtube.com/')), 'youtube');
  });

  test('non-http(s) URLs, garbage and bad site lists never match or throw', () => {
    for (const url of ['ftp://youtube.com/', 'moz-extension://abc/pause.html#https://youtube.com', 'about:blank', 'not a url', '', undefined, null, 5]) {
      assert.equal(key(url), null, String(url));
    }
    assert.equal(AP.state.siteKeyForUrl('https://youtube.com/', null), null);
    assert.equal(AP.state.siteKeyForUrl('https://youtube.com/', [null, 5, {}, { siteKey: 1, domain: 'youtube.com' }, { siteKey: 'youtube' }]), null);
  });
});
