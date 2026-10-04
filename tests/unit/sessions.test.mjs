// Pause sessions, focus blocks, schedules and the daily limit (src/background/sessions.js).
import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { uninstallFakeBrowser } from './_load.mjs';
import { bgWorld } from './_bg.mjs';

let w;
let AP;
let S; // AP.bg.sessions
let fake;

const local = (y, m, d, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const MIN = 60_000;

beforeEach(async () => {
  w = await bgWorld({ now: local(2026, 6, 10, 12, 0) }); // Wednesday 2026-06-10 12:00 local
  ({ AP, fake } = w);
  S = AP.bg.sessions;
  mock.method(console, 'warn', () => {});
});

afterEach(() => {
  mock.restoreAll();
  uninstallFakeBrowser();
});

const send = (type, payload) => AP.background.handleMessage({ type, payload }, {});

const sched = (extra = {}) => ({
  id: 's1', name: 'Work', days: [1, 2, 3, 4, 5], start: '09:00', end: '17:30', action: 'block', siteKeys: ['youtube'], enabled: true, ...extra,
});

/** Runs `fn` with the process time zone set to `tz` (Node re-reads TZ at runtime). */
async function inTimeZone(tz, fn) {
  const before = process.env.TZ;
  process.env.TZ = tz;
  try {
    return await fn();
  } finally {
    if (before === undefined) delete process.env.TZ;
    else process.env.TZ = before;
  }
}

describe('activeSchedules (pure)', () => {
  const at = (d) => S.activeSchedules([sched()], d).map((a) => a.id);

  test('weekly window on local wall-clock minutes: start inclusive, end exclusive, listed days only', () => {
    assert.deepEqual(at(new Date(2026, 5, 10, 9, 0)), ['s1']); // Wed 09:00
    assert.deepEqual(at(new Date(2026, 5, 10, 17, 29)), ['s1']);
    assert.deepEqual(at(new Date(2026, 5, 10, 17, 30)), []);
    assert.deepEqual(at(new Date(2026, 5, 10, 8, 59)), []);
    assert.deepEqual(at(new Date(2026, 5, 13, 12, 0)), []); // Saturday
    assert.deepEqual(at(new Date(2026, 5, 14, 12, 0)), []); // Sunday
  });

  test('reports when it ends and which sites it covers', () => {
    const [a] = S.activeSchedules([sched()], new Date(2026, 5, 10, 12, 0));
    assert.equal(a.endsAt, local(2026, 6, 10, 17, 30));
    assert.deepEqual(a.siteKeys, ['youtube']);
    assert.equal(a.action, 'block');
    assert.equal(a.name, 'Work');
  });

  test('disabled and malformed schedules never match', () => {
    const bad = [sched({ enabled: false }), sched({ id: 'x', days: 'mon' }), sched({ id: 'y', start: '9am' }), sched({ id: 'z', start: '09:00', end: '09:00' }), null, 'junk'];
    assert.deepEqual(S.activeSchedules(bad, new Date(2026, 5, 10, 12, 0)), []);
    assert.deepEqual(S.activeSchedules(undefined, new Date()), []);
    assert.deepEqual(S.activeSchedules([sched()], new Date('nope')), []);
  });

  test('an overnight range belongs to the day it starts on', () => {
    const night = sched({ id: 'n', days: [1], start: '22:00', end: '06:00' }); // Mondays 22:00 → Tuesday 06:00
    const on = (...d) => S.activeSchedules([night], new Date(...d)).map((a) => a.id);
    assert.deepEqual(on(2026, 5, 8, 23, 0), ['n']); // Mon 2026-06-08 23:00
    assert.deepEqual(on(2026, 5, 9, 5, 59), ['n']); // Tue small hours
    assert.deepEqual(on(2026, 5, 9, 6, 0), []);
    assert.deepEqual(on(2026, 5, 8, 5, 0), []); // Monday 05:00 is NOT Sunday's overnight
    assert.deepEqual(on(2026, 5, 9, 23, 0), []); // Tuesday evening: Tuesday is not listed
    const [evening] = S.activeSchedules([night], new Date(2026, 5, 8, 23, 0));
    assert.equal(evening.endsAt, local(2026, 6, 9, 6, 0), 'evening part ends tomorrow morning');
    const [morning] = S.activeSchedules([night], new Date(2026, 5, 9, 5, 0));
    assert.equal(morning.endsAt, local(2026, 6, 9, 6, 0), 'small hours part ends this morning');
  });

  test('a Sunday-night schedule wraps from Saturday 6 into Sunday 0', () => {
    const night = sched({ id: 'n', days: [6], start: '23:00', end: '01:00' });
    assert.deepEqual(S.activeSchedules([night], new Date(2026, 5, 14, 0, 30)).map((a) => a.id), ['n']); // Sunday 00:30
    assert.deepEqual(S.activeSchedules([night], new Date(2026, 5, 13, 23, 30)).map((a) => a.id), ['n']); // Saturday 23:30
  });

  test('overlapping schedules are all reported, in list order', () => {
    const list = [sched({ id: 'a', action: 'preset:focused' }), sched({ id: 'b', start: '11:00', end: '13:00' }), sched({ id: 'c', start: '13:00', end: '14:00' })];
    assert.deepEqual(S.activeSchedules(list, new Date(2026, 5, 10, 12, 0)).map((a) => a.id), ['a', 'b']);
  });

  describe('daylight saving time', () => {
    test('Europe/Bucharest spring forward (2026-03-29, 03:00 → 04:00): wall-clock minutes decide', async () => {
      await inTimeZone('Europe/Bucharest', () => {
        assert.equal(new Date(2026, 2, 29, 12).getTimezoneOffset(), -180, 'the zone switch must take effect');
        const day = sched({ id: 'd', days: [0], start: '01:00', end: '05:00' });
        const on = (h, m) => S.activeSchedules([day], new Date(2026, 2, 29, h, m)).map((a) => a.id);
        assert.deepEqual(on(1, 30), ['d']);
        assert.deepEqual(on(2, 59), ['d']);
        assert.deepEqual(on(4, 0), ['d'], 'the first minute after the gap');
        assert.deepEqual(on(4, 59), ['d']);
        assert.deepEqual(on(5, 0), []);
        const [a] = S.activeSchedules([day], new Date(2026, 2, 29, 4, 0));
        assert.equal(a.endsAt, new Date(2026, 2, 29, 5, 0).getTime());

        // An end inside the missing hour: wall minutes 03:30 never occur, so 04:00 is already past it.
        const early = sched({ id: 'e', days: [0], start: '02:00', end: '03:30' });
        assert.deepEqual(S.activeSchedules([early], new Date(2026, 2, 29, 2, 59)).map((a) => a.id), ['e']);
        assert.deepEqual(S.activeSchedules([early], new Date(2026, 2, 29, 4, 0)), []);

        // An overnight schedule that started Saturday evening keeps going across the change.
        const night = sched({ id: 'n', days: [6], start: '22:00', end: '06:00' });
        assert.deepEqual(S.activeSchedules([night], new Date(2026, 2, 29, 5, 59)).map((a) => a.id), ['n']);
        assert.deepEqual(S.activeSchedules([night], new Date(2026, 2, 29, 6, 0)), []);
      });
    });

    test('Europe/Bucharest fall back (2026-10-25, 04:00 → 03:00): both passes of 03:30 are inside 03:00–04:00', async () => {
      await inTimeZone('Europe/Bucharest', () => {
        const hour = sched({ id: 'h', days: [0], start: '03:00', end: '04:00' });
        const first = new Date(Date.UTC(2026, 9, 25, 0, 30)); // 03:30 EEST
        const second = new Date(Date.UTC(2026, 9, 25, 1, 30)); // 03:30 EET
        assert.equal(first.getHours(), 3);
        assert.equal(second.getHours(), 3);
        assert.deepEqual(S.activeSchedules([hour], first).map((a) => a.id), ['h']);
        assert.deepEqual(S.activeSchedules([hour], second).map((a) => a.id), ['h']);
        const [a] = S.activeSchedules([hour], second);
        assert.equal(a.endsAt, new Date(2026, 9, 25, 4, 0).getTime());
      });
    });

    test('America/New_York spring forward (2026-03-08, 02:00 → 03:00)', async () => {
      await inTimeZone('America/New_York', () => {
        assert.equal(new Date(2026, 2, 8, 12).getTimezoneOffset(), 240);
        const day = sched({ id: 'd', days: [0], start: '01:00', end: '04:00' });
        assert.deepEqual(S.activeSchedules([day], new Date(2026, 2, 8, 1, 59)).map((a) => a.id), ['d']);
        assert.deepEqual(S.activeSchedules([day], new Date(2026, 2, 8, 3, 0)).map((a) => a.id), ['d']);
        assert.deepEqual(S.activeSchedules([day], new Date(2026, 2, 8, 4, 0)), []);
        // 09:00 is 09:00 on both sides of the change: the schedule does not slide by an hour.
        const work = sched({ id: 'w', days: [0, 6], start: '09:00', end: '10:00' });
        assert.deepEqual(S.activeSchedules([work], new Date(2026, 2, 7, 9, 0)).map((a) => a.id), ['w']);
        assert.deepEqual(S.activeSchedules([work], new Date(2026, 2, 8, 9, 0)).map((a) => a.id), ['w']);
        assert.deepEqual(S.activeSchedules([work], new Date(2026, 2, 8, 8, 59)), []);
      });
    });

    test('America/New_York fall back (2026-11-01, 02:00 → 01:00): an overnight schedule spans the repeated hour', async () => {
      await inTimeZone('America/New_York', () => {
        const night = sched({ id: 'n', days: [6], start: '22:00', end: '06:00' });
        const firstPass = new Date(Date.UTC(2026, 10, 1, 5, 30)); // 01:30 EDT
        const secondPass = new Date(Date.UTC(2026, 10, 1, 6, 30)); // 01:30 EST
        assert.equal(firstPass.getHours(), 1);
        assert.equal(secondPass.getHours(), 1);
        assert.deepEqual(S.activeSchedules([night], firstPass).map((a) => a.id), ['n']);
        assert.deepEqual(S.activeSchedules([night], secondPass).map((a) => a.id), ['n']);
        assert.deepEqual(S.activeSchedules([night], new Date(2026, 10, 1, 6, 0)), []);
      });
    });

    test('"until midnight" is built from date parts: 23 and 25 hour days come out right', async () => {
      await inTimeZone('Europe/Bucharest', () => {
        assert.equal(S.nextLocalMidnight(new Date(2026, 2, 29, 12).getTime()), new Date(2026, 2, 30).getTime());
        assert.equal((S.nextLocalMidnight(new Date(2026, 2, 29, 0, 30).getTime()) - new Date(2026, 2, 29, 0, 30).getTime()) / 3_600_000, 22.5);
        assert.equal((S.nextLocalMidnight(new Date(2026, 9, 25, 0, 30).getTime()) - new Date(2026, 9, 25, 0, 30).getTime()) / 3_600_000, 24.5);
      });
    });
  });
});

describe('resolveSchedules: block beats preset, first preset wins', () => {
  const active = (...items) => items.map((a, i) => ({ id: `s${i}`, name: '', siteKeys: ['youtube'], endsAt: 1, ...a }));

  test('a block cancels every preset', () => {
    const r = S.resolveSchedules(active({ action: 'preset:focused' }, { action: 'block' }, { action: 'preset:deep-work' }));
    assert.equal(r.blocks.length, 1);
    assert.deepEqual(r.presets, []);
  });

  test('without a block the presets are listed in schedule order', () => {
    const r = S.resolveSchedules(active({ action: 'preset:focused' }, { action: 'preset:deep-work' }));
    assert.deepEqual(r.presets.map((p) => p.action), ['preset:focused', 'preset:deep-work']);
    assert.deepEqual(r.blocks, []);
  });
});

describe('limitStatus, blocks and breath (pure)', () => {
  const settings = (extra = {}) => ({ 'focus.dailyMinutes': 30, 'focus.limitGrace': 2, ...extra });
  const day = '2026-06-10';

  test('reached exactly at the limit; extra minutes move the bar; grace left counts 5-minute steps', () => {
    const at = local(2026, 6, 10, 12);
    assert.equal(S.limitStatus(settings(), { extraTime: {} }, { activeSec: 1799 }, at).reached, false);
    assert.equal(S.limitStatus(settings(), { extraTime: {} }, { activeSec: 1800 }, at).reached, true);
    const one = S.limitStatus(settings(), { extraTime: { [day]: 5 } }, { activeSec: 1800 }, at);
    assert.deepEqual([one.reached, one.graceLeft, one.extraSec], [false, 1, 300]);
    assert.equal(S.limitStatus(settings(), { extraTime: { [day]: 5 } }, { activeSec: 2100 }, at).reached, true);
    assert.equal(S.limitStatus(settings(), { extraTime: { [day]: 10 } }, { activeSec: 0 }, at).graceLeft, 0);
    assert.equal(S.limitStatus(settings(), { extraTime: { '2026-06-09': 10 } }, {}, at).graceLeft, 2, 'yesterday\'s grace does not count');
  });

  test('no limit (0) is never reached; grace 0 means none', () => {
    const at = local(2026, 6, 10, 12);
    assert.equal(S.limitStatus(settings({ 'focus.dailyMinutes': 0 }), { extraTime: {} }, { activeSec: 99999 }, at).reached, false);
    assert.equal(S.limitStatus(settings({ 'focus.limitGrace': 0 }), { extraTime: {} }, {}, at).graceLeft, 0);
  });

  test('computeBlocks keeps focus blocks, derives schedule and limit blocks, drops everything stale', () => {
    const at = local(2026, 6, 10, 12);
    const previous = [
      { reason: 'focus', until: at + MIN, siteKeys: ['youtube'] },
      { reason: 'focus', until: at - 1, siteKeys: ['youtube'] },
      { reason: 'limit', until: at + 99 * MIN, siteKeys: ['youtube'] }, // stored limit blocks are re-derived, not trusted
    ];
    const limit = { reached: true };
    const out = S.computeBlocks(previous, {
      schedules: [{ id: 's', name: 'Work', action: 'block', siteKeys: ['youtube'], endsAt: at + 30 * MIN }, { id: 'p', name: '', action: 'preset:focused', siteKeys: ['youtube'], endsAt: 1 }],
      limit,
      at,
    });
    assert.deepEqual(out.map((b) => b.reason), ['limit', 'schedule', 'focus']); // strongest (latest end) first
    assert.equal(out[0].until, S.nextLocalMidnight(at));
    assert.equal(out[1].scheduleId, 's');
    assert.equal(out[1].name, 'Work');
  });

  test('primaryBlock: the longest block wins; ties go focus > limit > schedule; null when nothing runs', () => {
    const at = 1000;
    const b = (reason, until, siteKeys = ['youtube']) => ({ reason, until, siteKeys });
    assert.equal(S.primaryBlock([], at), null);
    assert.equal(S.primaryBlock([b('focus', 999)], at), null);
    assert.deepEqual(S.primaryBlock([b('focus', 2000), b('schedule', 3000, ['x.com'])], at), { until: 3000, reason: 'schedule', siteKeys: ['x.com'] });
    assert.equal(S.primaryBlock([b('schedule', 2000), b('limit', 2000), b('focus', 2000)], at).reason, 'focus');
    assert.equal(S.primaryBlock([b('schedule', 2000), b('limit', 2000)], at).reason, 'limit');
  });

  test('blockForSite picks the strongest block that covers the site', () => {
    const blocks = [{ reason: 'schedule', until: 5000, siteKeys: ['youtube'] }, { reason: 'focus', until: 3000, siteKeys: ['youtube', 'a.com'] }];
    assert.equal(S.blockForSite(blocks, 'youtube', 1000).reason, 'schedule');
    assert.equal(S.blockForSite(blocks, 'a.com', 1000).reason, 'focus');
    assert.equal(S.blockForSite(blocks, 'a.com', 3000), null);
    assert.equal(S.blockForSite(blocks, 'zzz', 1000), null);
  });

  test('breathSeconds escalates per extra visit in the last hour and caps at 30', () => {
    const s = { 'pause.breathSeconds': 6, 'pause.escalate': true, 'pause.escalateStep': 2 };
    assert.equal(S.breathSeconds(s, 1), 6);
    assert.equal(S.breathSeconds(s, 2), 8);
    assert.equal(S.breathSeconds(s, 5), 14);
    assert.equal(S.breathSeconds(s, 100), 30);
    assert.equal(S.breathSeconds({ ...s, 'pause.escalate': false }, 5), 6);
    assert.equal(S.breathSeconds({ ...s, 'pause.breathSeconds': 30 }, 9), 30);
  });

  test('pruneSessions drops ended sessions and sessions of sites without a pause', () => {
    const draft = { sessions: { youtube: 5000, 'a.com': 5000, old: 10 }, sessionMinutes: { youtube: 5, 'a.com': 5, old: 5, gone: 1 } };
    const settings = { 'pause.enabled': true, 'pause.sites': [{ siteKey: 'youtube', domain: 'youtube.com', enabled: true }, { siteKey: 'a.com', domain: 'a.com', enabled: false }] };
    S.pruneSessions(draft, settings, 1000);
    assert.deepEqual(draft, { sessions: { youtube: 5000 }, sessionMinutes: { youtube: 5 } });
    S.pruneSessions(draft, { ...settings, 'pause.enabled': false }, 1000);
    assert.deepEqual(draft, { sessions: {}, sessionMinutes: {} });
  });
});

describe('pause flow (handlers)', () => {
  beforeEach(() => w.settings({ 'pause.enabled': true, 'pause.escalate': true, 'pause.escalateStep': 3, 'pause.breathSeconds': 6 }));

  test('PAUSE_OPENED counts the visit and escalates the breath within the hour', async () => {
    const first = await send('PAUSE_OPENED', { siteKey: 'youtube' });
    assert.deepEqual(first, { ok: true, opens: 1, recent: 1, breathSeconds: 6, sessionUntil: null });
    w.advance(5 * MIN);
    const second = await send('PAUSE_OPENED', { siteKey: 'youtube' });
    assert.deepEqual([second.opens, second.recent, second.breathSeconds], [2, 2, 9]);
    w.advance(61 * MIN); // the first two fall out of the hour
    assert.deepEqual((({ opens, recent, breathSeconds }) => [opens, recent, breathSeconds])(await send('PAUSE_OPENED', { siteKey: 'youtube' })), [3, 1, 6]);
  });

  test('a reload of the pause page (repeat) is not a new visit', async () => {
    await send('PAUSE_OPENED', { siteKey: 'youtube' });
    const again = await send('PAUSE_OPENED', { siteKey: 'youtube', repeat: true });
    assert.equal(again.opens, 1);
    assert.equal(again.recent, 1);
  });

  test('only configured sites are accepted', async () => {
    assert.deepEqual(await send('PAUSE_OPENED', { siteKey: 'reddit.com' }), { ok: false, error: 'unknown-site' });
    assert.deepEqual(await send('PAUSE_OPENED', { siteKey: '../x' }), { ok: false, error: 'bad-site' });
    assert.deepEqual(await send('PAUSE_CONTINUE', { siteKey: 'reddit.com', minutes: 5 }), { ok: false, error: 'unknown-site' });
  });

  test('PAUSE_CONTINUE stores the session, counts it, removes the pause rule and sets the expiry alarm', async () => {
    await S.reconcile();
    assert.equal((await w.rules()).length, 1, 'a pause rule exists before');
    const res = await send('PAUSE_CONTINUE', { siteKey: 'youtube', minutes: 15, intention: '  a tutorial   on bread  ' });
    assert.deepEqual(res, { ok: true, until: w.now() + 15 * MIN });
    const state = await w.state();
    assert.deepEqual(state.sessions, { youtube: w.now() + 15 * MIN });
    assert.deepEqual(state.sessionMinutes, { youtube: 15 });
    assert.deepEqual(await w.rules(), [], 'the pause rule is gone before the page navigates on');
    const alarm = fake.alarms.list.find((a) => a.name === 'session:youtube');
    assert.ok(alarm && alarm.scheduledTime >= w.now() + 15 * MIN && alarm.scheduledTime < w.now() + 15 * MIN + 1000);
    const today = (await AP.state.getStats(AP.util.dayKey(w.now()))).youtube;
    assert.equal(today.continued, 1);
    const raw = (await fake.storage.local.get('stats')).stats[AP.util.dayKey(w.now())].youtube;
    assert.deepEqual(raw.intentions.map((i) => i.text), ['a tutorial on bread']);
  });

  test('minutes must be a sane number', async () => {
    for (const minutes of [0, -5, 241, 'soon', NaN, undefined]) {
      assert.deepEqual(await send('PAUSE_CONTINUE', { siteKey: 'youtube', minutes }), { ok: false, error: 'bad-minutes' }, String(minutes));
    }
  });

  test('expiry (the alarm firing later) removes the session and brings the pause rule back', async () => {
    await send('PAUSE_CONTINUE', { siteKey: 'youtube', minutes: 5 });
    w.advance(5 * MIN + 200);
    fake.alarms.onAlarm.dispatch({ name: 'session:youtube' });
    await new Promise((r) => setTimeout(r, 60));
    assert.deepEqual((await w.state()).sessions, {});
    assert.equal((await w.rules()).length, 1);
    assert.equal(fake.alarms.list.some((a) => a.name.startsWith('session:')), false, 'the alarm is cleaned up');
  });

  test('continuing again while a longer session runs never shortens it', async () => {
    await send('PAUSE_CONTINUE', { siteKey: 'youtube', minutes: 60 });
    const res = await send('PAUSE_CONTINUE', { siteKey: 'youtube', minutes: 5 });
    assert.equal(res.until, w.now() + 60 * MIN);
    assert.equal((await w.state()).sessions.youtube, w.now() + 60 * MIN);
  });

  test('PAUSE_OPENED while a session runs reports it and does not count a visit', async () => {
    await send('PAUSE_CONTINUE', { siteKey: 'youtube', minutes: 5 });
    const res = await send('PAUSE_OPENED', { siteKey: 'youtube' });
    assert.equal(res.sessionUntil, w.now() + 5 * MIN);
    assert.equal(res.opens, 0);
  });

  test('PAUSE_TURN_BACK counts', async () => {
    assert.deepEqual(await send('PAUSE_TURN_BACK', { siteKey: 'youtube' }), { ok: true });
    assert.equal((await AP.state.getStats(AP.util.dayKey(w.now()))).youtube.turnedBack, 1);
    assert.deepEqual(await send('PAUSE_TURN_BACK', { siteKey: '' }), { ok: false, error: 'bad-site' });
  });

  test('turning the pause off ends sessions (the guards rely on it)', async () => {
    await send('PAUSE_CONTINUE', { siteKey: 'youtube', minutes: 30 });
    await w.settings({ 'pause.enabled': false });
    await S.reconcile();
    assert.deepEqual((await w.state()).sessions, {});
    assert.deepEqual(await w.rules(), []);
  });

  test('a running block refuses to start a session', async () => {
    await send('FOCUS_START', { minutes: 25 });
    assert.deepEqual(await send('PAUSE_CONTINUE', { siteKey: 'youtube', minutes: 5 }), { ok: false, error: 'blocked' });
  });
});

describe('focus blocks', () => {
  test('FOCUS_START with minutes; until-end-of-day; default site is YouTube', async () => {
    const res = await send('FOCUS_START', { minutes: 25 });
    assert.deepEqual(res, { ok: true, block: { until: w.now() + 25 * MIN, reason: 'focus', siteKeys: ['youtube'] } });
    await send('FOCUS_END', { frictionDone: true });
    const eod = await send('FOCUS_START', { untilEndOfDay: true });
    assert.equal(eod.block.until, local(2026, 6, 11, 0, 0));
  });

  test('block rule, alarm and state are all in place', async () => {
    await send('FOCUS_START', { minutes: 25 });
    const [rule] = await w.rules();
    assert.equal(rule.id, 100);
    assert.equal(rule.priority, 300);
    assert.equal(rule.action.redirect.regexSubstitution, 'moz-extension://fake-uuid/src/pages/blocked/blocked.html?reason=focus#\\0');
    const alarm = fake.alarms.list.find((a) => a.name === 'block-end');
    assert.ok(alarm.scheduledTime >= w.now() + 25 * MIN);
    assert.equal((await w.state()).block.reason, 'focus');
  });

  test('bad input is refused', async () => {
    for (const payload of [{}, { minutes: 0 }, { minutes: 5000 }, { minutes: 'x' }, undefined]) {
      assert.deepEqual(await send('FOCUS_START', payload), { ok: false, error: 'bad-minutes' }, JSON.stringify(payload));
    }
  });

  test('siteKeys: only known sites; an empty or unknown list means YouTube', async () => {
    await w.settings({ 'pause.sites': [{ siteKey: 'youtube', domain: 'youtube.com', enabled: true }, { siteKey: 'reddit.com', domain: 'reddit.com', enabled: true }] });
    const res = await send('FOCUS_START', { minutes: 5, siteKeys: ['reddit.com', 'evil.example', 7] });
    assert.deepEqual(res.block.siteKeys, ['reddit.com']);
    const rules = await w.rules();
    assert.match(rules[0].condition.regexFilter, /reddit\\\.com/);
    await send('FOCUS_END', { frictionDone: true });
    assert.deepEqual((await send('FOCUS_START', { minutes: 5, siteKeys: ['nope'] })).block.siteKeys, ['youtube']);
  });

  test('starting a block while one runs only extends it (and merges sites)', async () => {
    await w.settings({ 'pause.sites': [{ siteKey: 'youtube', domain: 'youtube.com', enabled: true }, { siteKey: 'reddit.com', domain: 'reddit.com', enabled: true }] });
    await send('FOCUS_START', { minutes: 60 });
    const shorter = await send('FOCUS_START', { minutes: 5, siteKeys: ['reddit.com'] });
    assert.equal(shorter.block.until, w.now() + 60 * MIN);
    assert.deepEqual(shorter.block.siteKeys.sort(), ['reddit.com', 'youtube']);
    const longer = await send('FOCUS_START', { minutes: 120 });
    assert.equal(longer.block.until, w.now() + 120 * MIN);
  });

  test('FOCUS_END honours strict and friction; frictionDone unlocks "wait" and "phrase"', async () => {
    await send('FOCUS_START', { minutes: 25 });
    await w.settings({ 'focus.unlockFriction': 'wait' });
    assert.deepEqual(await send('FOCUS_END', {}), { ok: false, error: 'friction-required' });
    assert.deepEqual(await send('FOCUS_END'), { ok: false, error: 'friction-required' });
    await w.settings({ 'focus.unlockFriction': 'phrase' });
    assert.deepEqual(await send('FOCUS_END', { frictionDone: false }), { ok: false, error: 'friction-required' });
    await w.settings({ 'focus.strict': true });
    assert.deepEqual(await send('FOCUS_END', { frictionDone: true }), { ok: false, error: 'strict' });
    assert.ok((await w.state()).block, 'still blocked');
    await w.settings({ 'focus.strict': false });
    assert.deepEqual(await send('FOCUS_END', { frictionDone: true }), { ok: true });
    assert.equal((await w.state()).block, null);
    assert.deepEqual(await w.rules(), []);
    assert.equal(fake.alarms.list.some((a) => a.name === 'block-end'), false);
  });

  test('friction "none" ends at once; ending when nothing runs is fine', async () => {
    await send('FOCUS_START', { minutes: 25 });
    await w.settings({ 'focus.unlockFriction': 'none' });
    assert.deepEqual(await send('FOCUS_END', {}), { ok: true });
    assert.deepEqual(await send('FOCUS_END', {}), { ok: true });
    await w.settings({ 'focus.strict': true });
    assert.deepEqual(await send('FOCUS_END', {}), { ok: true }, 'nothing to end, strict or not');
  });

  test('FOCUS_END does not touch a schedule or limit block', async () => {
    await w.settings({ 'focus.schedules': [sched({ days: [0, 1, 2, 3, 4, 5, 6], start: '09:00', end: '17:30' })], 'focus.unlockFriction': 'none' });
    await send('FOCUS_START', { minutes: 25 });
    await send('FOCUS_END', {});
    const status = await send('GET_STATUS');
    assert.equal(status.block.reason, 'schedule');
  });

  test('a block ends by itself: the alarm reconciles and the rule is removed', async () => {
    await send('FOCUS_START', { minutes: 25 });
    w.advance(25 * MIN + 200);
    fake.alarms.onAlarm.dispatch({ name: 'block-end' });
    await new Promise((r) => setTimeout(r, 60));
    assert.equal((await w.state()).block, null);
    assert.deepEqual(await w.rules(), []);
  });

  test('a PLAN-shaped state.block written by someone else is adopted', async () => {
    await fake.storage.local.set({ state: { block: { until: w.now() + 10 * MIN, reason: 'focus', siteKeys: ['youtube'] } } });
    await S.reconcile();
    assert.equal((await w.state()).blocks.length, 1);
    assert.equal((await w.rules()).length, 1);
  });
});

describe('schedules (reconcile)', () => {
  test('a block schedule closes YouTube while it is active and opens it when it ends', async () => {
    await w.settings({ 'focus.schedules': [sched()] }); // Mon–Fri 09:00–17:30; it is Wednesday 12:00
    await S.reconcile();
    const state = await w.state();
    assert.equal(state.blocks[0].reason, 'schedule');
    assert.equal(state.blocks[0].until, local(2026, 6, 10, 17, 30));
    assert.equal(state.block.reason, 'schedule');
    const [rule] = await w.rules();
    assert.match(rule.action.redirect.regexSubstitution, /reason=schedule#/);
    assert.equal(fake.alarms.list.find((a) => a.name === 'block-end').scheduledTime >= local(2026, 6, 10, 17, 30), true);
    const tick = fake.alarms.list.find((a) => a.name === 'tick');
    assert.equal(tick.periodInMinutes, 1);
    assert.equal(tick.scheduledTime % MIN, 500, 'aligned just after a wall-clock minute');

    w.set(local(2026, 6, 10, 17, 30));
    await S.reconcile();
    assert.equal((await w.state()).block, null);
    assert.deepEqual(await w.rules(), []);
  });

  test('the rule starts exactly on time even before the minute alarm notices', async () => {
    await w.settings({ 'focus.schedules': [sched()], 'pause.enabled': false });
    w.set(local(2026, 6, 10, 8, 59));
    await S.reconcile();
    assert.deepEqual(await w.rules(), []);
    w.set(local(2026, 6, 10, 9, 0));
    await AP.bg.rules.syncRules(); // what a navigation sees: no reconcile ran yet
    assert.equal((await w.rules()).length, 1);
  });

  test('a preset schedule applies its preset as the override; an unknown preset is skipped for the next one', async () => {
    await w.settings({
      'focus.schedules': [sched({ id: 'a', action: 'preset:does-not-exist' }), sched({ id: 'b', action: 'preset:deep-work' })],
    });
    await S.reconcile();
    assert.equal((await w.state()).scheduleOverride, 'deep-work');
    const effective = await AP.settings.effective();
    assert.equal(effective['pause.enabled'], true, 'Deep work turns the pause on');
    assert.equal(effective['yt.general.grayscale'], true);
    assert.equal(effective['focus.schedules'].length, 2, 'schedules themselves are never overridden');
    assert.equal((await w.rules()).length, 1, 'and the pause rule follows the overridden setting');

    w.set(local(2026, 6, 10, 18, 0));
    await S.reconcile();
    assert.equal((await w.state()).scheduleOverride, null);
    assert.deepEqual(await w.rules(), []);
  });

  test('a block schedule beats a preset schedule', async () => {
    await w.settings({ 'focus.schedules': [sched({ id: 'p', action: 'preset:deep-work' }), sched({ id: 'b', start: '11:00', end: '13:00' })] });
    await S.reconcile();
    const state = await w.state();
    assert.equal(state.scheduleOverride, null);
    assert.equal(state.block.reason, 'schedule');
  });

  test('a custom preset can be applied by a schedule', async () => {
    await AP.settings.saveCustomPreset('Mine', { 'yt.general.grayscale': true });
    const [preset] = await AP.settings.listCustomPresets();
    await w.settings({ 'focus.schedules': [sched({ action: `preset:${preset.id}` })] });
    await S.reconcile();
    assert.equal((await AP.settings.effective())['yt.general.grayscale'], true);
  });

  test('no schedules and no limit: no minute tick', async () => {
    await S.reconcile();
    assert.equal(fake.alarms.list.length, 0);
    await w.settings({ 'focus.schedules': [sched({ enabled: false })] });
    await S.reconcile();
    assert.equal(fake.alarms.list.some((a) => a.name === 'tick'), false);
    await w.settings({ 'focus.schedules': [sched()] });
    await S.reconcile();
    assert.equal(fake.alarms.list.some((a) => a.name === 'tick'), true);
    await w.settings({ 'focus.schedules': [] });
    await S.reconcile();
    assert.equal(fake.alarms.list.some((a) => a.name === 'tick'), false, 'cleared when no longer needed');
  });

  test('a schedule for another site blocks that site only', async () => {
    await w.settings({
      'pause.sites': [{ siteKey: 'youtube', domain: 'youtube.com', enabled: true }, { siteKey: 'reddit.com', domain: 'reddit.com', enabled: true }],
      'focus.schedules': [sched({ siteKeys: ['reddit.com'] })],
    });
    await S.reconcile();
    const rules = await w.rules();
    assert.equal(rules.length, 1);
    assert.match(rules[0].condition.regexFilter, /reddit/);
  });
});

describe('daily limit', () => {
  const day = () => AP.util.dayKey(w.now());
  const setActive = (sec) => fake.storage.local.set({ stats: { [day()]: { youtube: { activeSec: sec, opens: 0, turnedBack: 0, continued: 0, blockedHits: 0 } } } });

  beforeEach(() => w.settings({ 'focus.dailyMinutes': 10, 'focus.limitGrace': 2 }));

  test('under the limit nothing is blocked; at the limit YouTube is closed until local midnight', async () => {
    await setActive(599);
    await S.reconcile();
    assert.equal((await w.state()).block, null);
    await setActive(600);
    await S.reconcile();
    const { block } = await w.state();
    assert.deepEqual(block, { until: local(2026, 6, 11, 0, 0), reason: 'limit', siteKeys: ['youtube'] });
    const [rule] = await w.rules();
    assert.match(rule.action.redirect.regexSubstitution, /reason=limit#/);
    assert.equal(fake.alarms.list.some((a) => a.name === 'tick'), true, 'the minute tick watches the day roll over');
  });

  test('the block ends at midnight and the new day starts at zero', async () => {
    await setActive(900);
    await S.reconcile();
    assert.ok((await w.state()).block);
    w.set(local(2026, 6, 11, 0, 1));
    await S.reconcile();
    assert.equal((await w.state()).block, null);
    assert.deepEqual(await w.rules(), []);
  });

  test('LIMIT_GRACE gives 5 more minutes, at most `focus.limitGrace` times a day, and unblocks at once', async () => {
    await setActive(600);
    await S.reconcile();
    assert.deepEqual((await send('GET_STATUS')).limit, { dailyMinutes: 10, usedSec: 600, graceLeft: 2 });
    assert.deepEqual(await send('LIMIT_GRACE'), { ok: true, graceLeft: 1 });
    assert.equal((await w.state()).block, null);
    assert.deepEqual(await w.rules(), [], 'the rule is gone before the page navigates on');
    assert.equal((await w.state()).extraTime[day()], 5);

    assert.deepEqual(await send('LIMIT_GRACE'), { ok: false, error: 'not-needed' }, 'not reached again yet');
    await setActive(900); // 5 extra minutes used
    await S.reconcile();
    assert.equal((await w.state()).block.reason, 'limit');
    assert.deepEqual(await send('LIMIT_GRACE'), { ok: true, graceLeft: 0 });
    await setActive(1200);
    await S.reconcile();
    assert.equal((await w.state()).block.reason, 'limit');
    assert.deepEqual(await send('LIMIT_GRACE'), { ok: false, error: 'no-grace' });
  });

  test('no grace configured, or no limit at all, means no grace', async () => {
    await w.settings({ 'focus.limitGrace': 0 });
    await setActive(600);
    await S.reconcile();
    assert.deepEqual(await send('LIMIT_GRACE'), { ok: false, error: 'no-grace' });
    await w.settings({ 'focus.dailyMinutes': 0 });
    assert.deepEqual(await send('LIMIT_GRACE'), { ok: false, error: 'not-needed' });
    assert.equal((await w.state()).block, null, 'limit off: unblocked');
  });

  test('raising the limit unblocks', async () => {
    await setActive(600);
    await S.reconcile();
    assert.ok((await w.state()).block);
    await w.settings({ 'focus.dailyMinutes': 60 });
    await S.reconcile();
    assert.equal((await w.state()).block, null);
  });
});

describe('reconcile is idempotent and safe', () => {
  test('a second pass changes nothing: no storage writes, no rule updates', async () => {
    await w.settings({ 'pause.enabled': true, 'focus.schedules': [sched()] });
    await S.reconcile();
    const stateBefore = JSON.stringify((await fake.storage.local.get('state')).state);
    const calls = fake.declarativeNetRequest.calls.length;
    const alarms = JSON.stringify(fake.alarms.list);
    let writes = 0;
    fake.storage.onChanged.addListener(() => writes++);
    await S.reconcile();
    await S.reconcile();
    assert.equal(writes, 0);
    assert.equal(fake.declarativeNetRequest.calls.length, calls);
    assert.equal(JSON.stringify((await fake.storage.local.get('state')).state), stateBefore);
    assert.equal(JSON.stringify(fake.alarms.list), alarms);
  });

  test('overlapping calls are serialized and all resolve', async () => {
    await w.settings({ 'pause.enabled': true });
    await Promise.all([S.reconcile(), S.reconcile(), S.reconcile(), send('GET_STATUS')]);
    assert.equal((await w.rules()).length, 1);
  });

  test('a failing step rejects that call but does not wedge later ones', async () => {
    const original = AP.bg.rules.syncRules;
    AP.bg.rules.syncRules = () => Promise.reject(new Error('dnr down'));
    await assert.rejects(S.reconcile(), /dnr down/);
    AP.bg.rules.syncRules = original;
    await w.settings({ 'pause.enabled': true });
    await S.reconcile();
    assert.equal((await w.rules()).length, 1);
  });

  test('garbage in storage never crashes it', async () => {
    await fake.storage.local.set({ state: 'junk', stats: [1, 2], settings: 5, customPresets: 'x' });
    const status = await send('GET_STATUS');
    assert.equal(status.ok, true);
  });
});
