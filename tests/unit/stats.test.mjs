// Usage stats (src/background/stats.js) and the serialized storage layer (src/background/store.js).
import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { uninstallFakeBrowser } from './_load.mjs';
import { bgWorld } from './_bg.mjs';

let w;
let AP;
let fake;
let stats;

const T0 = new Date(2026, 5, 10, 12, 0, 0).getTime();
const SEC = 1000;

beforeEach(async () => {
  w = await bgWorld({ now: T0 });
  ({ AP, fake } = w);
  stats = AP.bg.stats;
  mock.method(console, 'warn', () => {});
});
afterEach(() => {
  mock.restoreAll();
  uninstallFakeBrowser();
});

const day = () => AP.util.dayKey(w.now());
const raw = async () => (await fake.storage.local.get('stats')).stats;
const todayYt = async () => (await AP.state.getStats(day())).youtube;

describe('creditFor (pure)', () => {
  test('first beat of a stretch is worth 30 s; beats under 25 s apart are ignored; the rest add min(delta, 35)', () => {
    assert.deepEqual(stats.creditFor(undefined, T0), { counted: true, seconds: 30 });
    assert.deepEqual(stats.creditFor(T0, T0 + 24_999), { counted: false, seconds: 0 });
    assert.deepEqual(stats.creditFor(T0, T0 + 25_000), { counted: true, seconds: 25 });
    assert.deepEqual(stats.creditFor(T0, T0 + 30_000), { counted: true, seconds: 30 });
    assert.deepEqual(stats.creditFor(T0, T0 + 35_000), { counted: true, seconds: 35 });
    assert.deepEqual(stats.creditFor(T0, T0 + 3_600_000), { counted: true, seconds: 35 });
    assert.deepEqual(stats.creditFor('x', T0), { counted: true, seconds: 30 });
  });
});

describe('heartbeat', () => {
  test('30 second beats add 30 s each', async () => {
    await stats.heartbeat('youtube', w.now());
    for (let i = 0; i < 4; i++) {
      w.advance(30 * SEC);
      await stats.heartbeat('youtube', w.now());
    }
    assert.equal((await todayYt()).activeSec, 150);
  });

  test('a second tab\'s beats within 25 s do not double count', async () => {
    await stats.heartbeat('youtube', w.now()); // tab A
    for (let i = 0; i < 4; i++) {
      w.advance(15 * SEC);
      await stats.heartbeat('youtube', w.now()); // alternating A / B beats every 15 s
    }
    // beats at 0 (30), 15 (ignored), 30 (30), 45 (ignored), 60 (30)
    assert.equal((await todayYt()).activeSec, 90);
  });

  test('beats of different sites are tracked separately', async () => {
    await w.settings({ 'pause.sites': [{ siteKey: 'youtube', domain: 'youtube.com', enabled: true }, { siteKey: 'a.com', domain: 'a.com', enabled: true }] });
    await stats.heartbeat('youtube', w.now());
    const r = await stats.heartbeat('a.com', w.now() + SEC);
    assert.equal(r.counted, true);
    const all = await AP.state.getStats(day());
    assert.equal(all['a.com'].activeSec, 30);
    assert.equal(all.youtube.activeSec, 30);
  });

  test('a long gap credits at most 35 s', async () => {
    await stats.heartbeat('youtube', w.now());
    w.advance(3 * 3_600_000);
    const r = await stats.heartbeat('youtube', w.now());
    assert.equal(r.seconds, 35);
  });

  test('simultaneous beats are serialized: every one is judged against the one before', async () => {
    const results = await Promise.all(Array.from({ length: 6 }, () => stats.heartbeat('youtube', w.now())));
    assert.equal(results.filter((r) => r.counted).length, 1);
    assert.equal((await todayYt()).activeSec, 30);
  });

  test('the day is the LOCAL calendar day: a beat just after midnight lands on the new day', async () => {
    const late = new Date(2026, 5, 10, 23, 59, 50).getTime();
    await stats.heartbeat('youtube', late);
    await stats.heartbeat('youtube', late + 30 * SEC);
    const all = await AP.state.getStats();
    assert.equal(all['2026-06-10'].youtube.activeSec, 30);
    assert.equal(all['2026-06-11'].youtube.activeSec, 30);
  });

  test('last-beat bookkeeping lives in storage.session, so an unloaded event page does not forget it', async () => {
    await stats.heartbeat('youtube', w.now());
    assert.deepEqual(Object.keys((await fake.storage.session.get('lastBeat')).lastBeat), ['youtube']);
  });
});

describe('pause outcomes and hits', () => {
  test('recordOpen counts today\'s opens (nothing else is remembered about a visit)', async () => {
    assert.equal(await stats.recordOpen('youtube', w.now()), 1);
    assert.equal(await stats.recordOpen('youtube', w.now() + 10 * 60_000), 2);
    assert.equal(await stats.recordOpen('reddit.com', w.now() + 11 * 60_000), 1);
    assert.equal(stats.recentOpens, undefined);
    assert.equal((await fake.storage.session.get('recentOpens')).recentOpens, undefined);
  });

  test('recordCount increments turnedBack / continued / blockedHits independently', async () => {
    await stats.recordCount('youtube', 'turnedBack', w.now());
    await stats.recordCount('youtube', 'turnedBack', w.now());
    await stats.recordCount('youtube', 'continued', w.now());
    await stats.recordCount('youtube', 'blockedHits', w.now());
    assert.deepEqual(await todayYt(), { activeSec: 0, opens: 0, turnedBack: 2, continued: 1, blockedHits: 1 });
  });

  test('a continued session stores no intention lines, and the old ones can be dropped', async () => {
    assert.equal(stats.addIntention, undefined);
    const dayKey = day();
    await fake.storage.local.set({
      stats: {
        [dayKey]: { youtube: { ...AP.state.emptyCounters(), intentions: [{ at: 1, text: 'hello' }] }, 'reddit.com': AP.state.emptyCounters() },
        '2026-01-01': 'junk',
      },
    });
    assert.equal(await stats.dropLegacyIntentions(), 1);
    assert.deepEqual((await raw())[dayKey], { youtube: AP.state.emptyCounters(), 'reddit.com': AP.state.emptyCounters() });
    assert.equal(await stats.dropLegacyIntentions(), 0, 'nothing left to drop');
    const status = await AP.background.handleMessage({ type: 'GET_STATUS' }, {});
    assert.deepEqual(Object.keys(status.today.youtube).sort(), ['activeSec', 'blockedHits', 'continued', 'opens', 'turnedBack']);
  });
});

describe('storage layer', () => {
  test('stats older than 90 days are pruned on write; recent days and counters are kept', async () => {
    await fake.storage.local.set({
      stats: {
        '2026-01-01': { youtube: { activeSec: 5 } }, // > 90 days before 2026-06-10
        '2026-03-13': { youtube: { activeSec: 6 } }, // exactly 89 days before: kept
        '2026-03-12': { youtube: { activeSec: 7 } }, // 90 days before: outside the last 90 days (today included)
        '2026-06-09': { youtube: { activeSec: 8 } },
      },
    });
    await stats.recordCount('youtube', 'continued', w.now());
    const days = Object.keys(await raw()).sort();
    assert.deepEqual(days, ['2026-03-13', '2026-06-09', '2026-06-10']);
  });

  test('read-modify-write on one key never interleaves (many concurrent writers all land)', async () => {
    await Promise.all(Array.from({ length: 25 }, () => stats.recordCount('youtube', 'continued', w.now())));
    assert.equal((await todayYt()).continued, 25);
    await Promise.all(Array.from({ length: 10 }, (_, i) => AP.bg.store.updateState((draft) => {
      draft.extraTime[`2026-06-${String(10 + (i % 2)).padStart(2, '0')}`] = (draft.extraTime[`2026-06-${String(10 + (i % 2)).padStart(2, '0')}`] ?? 0) + 1;
    })));
    assert.deepEqual((await w.state()).extraTime, { '2026-06-10': 5, '2026-06-11': 5 });
  });

  test('a task that throws rejects its caller only; the queue keeps working', async () => {
    await assert.rejects(AP.bg.store.queue('k', () => Promise.reject(new Error('x'))), /x/);
    assert.equal(await AP.bg.store.queue('k', () => 'fine'), 'fine');
  });

  test('state: nothing changed → nothing written', async () => {
    let writes = 0;
    fake.storage.onChanged.addListener(() => writes++);
    await AP.bg.store.updateState(() => {});
    assert.equal(writes, 0);
    await AP.bg.store.updateState((draft) => {
      draft.sessions.youtube = 5;
    });
    assert.equal(writes, 1);
  });

  test('state keeps unknown junk out, extraTime is trimmed to the last days, blocks are validated', async () => {
    await fake.storage.local.set({
      state: {
        sessions: { youtube: 5000 },
        junk: true,
        blocks: [{ reason: 'focus', until: 9, siteKeys: ['youtube'] }, { reason: 'weird', until: 9, siteKeys: ['youtube'] }, { reason: 'focus', until: 'x', siteKeys: ['youtube'] }, { reason: 'focus', until: 9, siteKeys: [] }, 'x'],
        extraTime: Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`2026-06-${String(i + 1).padStart(2, '0')}`, 5])),
      },
    });
    await AP.bg.store.updateState((draft) => {
      draft.sessions.youtube = 6000;
    });
    const stored = (await fake.storage.local.get('state')).state;
    assert.equal(stored.junk, undefined);
    assert.deepEqual(stored.blocks, [{ reason: 'focus', until: 9, siteKeys: ['youtube'] }]);
    assert.equal(Object.keys(stored.extraTime).length, 8);
    assert.equal(Object.keys(stored.extraTime).sort()[0], '2026-06-05');
  });
});

describe('storage.session fallback', () => {
  test('without storage.session (older browsers) the bookkeeping falls back to memory', async () => {
    delete fake.storage.session;
    await stats.heartbeat('youtube', w.now());
    const second = await stats.heartbeat('youtube', w.now() + 5 * SEC);
    assert.equal(second.counted, false);
  });
});
