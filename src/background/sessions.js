// Pause sessions, focus blocks, weekly schedules and the daily limit (PLAN §8.3, §8.4), plus the
// one idempotent `reconcile()` that every event funnels into.
//
// THE MODEL
//   Sources of "YouTube (or a user site) is closed right now":
//     focus     started by the person (popup / shortcut): stored, `FOCUS_START` / `FOCUS_END`
//     schedule  derived from `focus.schedules` and the local wall clock (pure: activeSchedules)
//     limit     derived from today's activeSec, `focus.dailyMinutes` and the "5 more minutes" taken
//   `reconcile()` recomputes everything derived from storage — expired pause sessions dropped,
//   `state.blocks` / `state.block`, the schedule-preset override, the DNR rules and the alarms —
//   and is safe to call at any time and any number of times. Alarms, storage changes, startup and
//   every message handler that changes something call it, so there is no state in memory that
//   could be lost when the event page is unloaded.
//
// Local-time rules: schedules are evaluated on LOCAL wall-clock minutes (getHours/getMinutes), so a
// DST change cannot shift "09:00" by an hour; "end" instants are built from local date parts.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;
  const bg = (AP.bg ??= {});
  const store = () => bg.store;
  const stats = () => bg.stats;
  const { isPlainObject } = AP.util;

  const MINUTE = 60_000;
  const GRACE_MINUTES = 5;
  const MAX_FOCUS_MINUTES = 1440;
  const MAX_SESSION_MINUTES = 240;
  const MAX_BREATH_SECONDS = 30;
  /** Alarms fire at-or-after their time; a little padding makes sure "now >= until" when they do. */
  const ALARM_PAD_MS = 150;
  const REASON_PRIORITY = Object.freeze({ focus: 3, limit: 2, schedule: 1 });
  const TICK_ALARM = 'tick';
  const BLOCK_ALARM = 'block-end';
  const SESSION_ALARM_PREFIX = 'session:';

  const now = () => bg.clock.now();

  // ---------------------------------------------------------------------------------------
  // Sites
  // ---------------------------------------------------------------------------------------

  /**
   * The configured pause sites (`pause.sites`), YouTube first-class even when the person removed it
   * from the list (a focus block can still target it).
   * @param {Record<string, any>} settings effective settings
   * @returns {Map<string, { siteKey: string, domain: string, enabled: boolean, listed: boolean }>}
   */
  function sitesOf(settings) {
    const map = new Map();
    const list = Array.isArray(settings?.['pause.sites']) ? settings['pause.sites'] : [];
    for (const s of list) {
      if (isPlainObject(s) && typeof s.siteKey === 'string') map.set(s.siteKey, { siteKey: s.siteKey, domain: s.domain, enabled: s.enabled !== false, listed: true });
    }
    if (!map.has('youtube')) map.set('youtube', { siteKey: 'youtube', domain: 'youtube.com', enabled: false, listed: false });
    return map;
  }

  /** Is the Mindful Pause active for this site right now (feature on, site listed and enabled)? */
  function isPaused(settings, siteKey) {
    if (settings?.['pause.enabled'] !== true) return false;
    const site = sitesOf(settings).get(siteKey);
    return Boolean(site?.listed && site.enabled);
  }

  // ---------------------------------------------------------------------------------------
  // Time helpers
  // ---------------------------------------------------------------------------------------

  /** The next local midnight after `at` (start of tomorrow, DST-safe: built from date parts). */
  function nextLocalMidnight(at) {
    const d = new Date(at);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
  }

  const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

  /** `hhmm` on the local day `dayOffset` days from `date`'s day. */
  function localInstant(date, dayOffset, hhmm) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate() + dayOffset, Number(hhmm.slice(0, 2)), Number(hhmm.slice(3, 5)));
  }

  // ---------------------------------------------------------------------------------------
  // Schedules (pure)
  // ---------------------------------------------------------------------------------------

  /**
   * Which schedules are in force at `date`, in list order. Weekly, on local wall-clock minutes.
   * An end earlier than the start means "past midnight" and belongs to the day it started on
   * ("Mon 22:00–06:00" runs from Monday evening to Tuesday morning). Disabled and malformed
   * entries never match.
   * @param {object[]} list the `focus.schedules` setting
   * @param {Date} date
   * @returns {{ id: string, name: string, action: string, siteKeys: string[], endsAt: number }[]}
   */
  function activeSchedules(list, date) {
    const out = [];
    if (!Array.isArray(list) || !(date instanceof Date) || Number.isNaN(date.getTime())) return out;
    const minute = date.getHours() * 60 + date.getMinutes();
    const day = date.getDay();
    const yesterday = (day + 6) % 7;
    for (const s of list) {
      if (!isPlainObject(s) || s.enabled === false || !Array.isArray(s.days)) continue;
      if (typeof s.start !== 'string' || typeof s.end !== 'string' || !/^\d\d:\d\d$/.test(s.start) || !/^\d\d:\d\d$/.test(s.end)) continue;
      const start = toMinutes(s.start);
      const end = toMinutes(s.end);
      if (start === end) continue;
      let endsAt = null;
      if (start < end) {
        if (s.days.includes(day) && minute >= start && minute < end) endsAt = localInstant(date, 0, s.end);
      } else if (s.days.includes(day) && minute >= start) {
        endsAt = localInstant(date, 1, s.end); // the evening part: ends tomorrow morning
      } else if (s.days.includes(yesterday) && minute < end) {
        endsAt = localInstant(date, 0, s.end); // the small hours of a schedule that started yesterday
      }
      if (endsAt) {
        out.push({
          id: String(s.id),
          name: typeof s.name === 'string' ? s.name : '',
          action: String(s.action),
          siteKeys: Array.isArray(s.siteKeys) && s.siteKeys.length > 0 ? s.siteKeys : ['youtube'],
          endsAt: endsAt.getTime(),
        });
      }
    }
    return out;
  }

  /**
   * Block beats preset; the first preset wins. When any block schedule is active no preset is
   * applied (the sites are closed anyway, and the preset resumes when the block ends).
   * @param {ReturnType<typeof activeSchedules>} active
   * @returns {{ blocks: typeof active, presets: typeof active }} `presets` is in list order: the caller takes the first one whose preset still exists
   */
  function resolveSchedules(active) {
    const blocks = active.filter((a) => a.action === 'block');
    const presets = blocks.length > 0 ? [] : active.filter((a) => a.action.startsWith('preset:'));
    return { blocks, presets };
  }

  // ---------------------------------------------------------------------------------------
  // Limit & blocks (pure)
  // ---------------------------------------------------------------------------------------

  /**
   * Daily limit bookkeeping for YouTube.
   * @param {Record<string, any>} settings effective settings
   * @param {{ extraTime: Record<string, number> }} state
   * @param {{ activeSec?: number }|undefined} youtubeToday today's counters
   * @param {number} at
   * @returns {{ dailyMinutes: number, usedSec: number, extraSec: number, limitSec: number, graceLeft: number, reached: boolean }}
   */
  function limitStatus(settings, state, youtubeToday, at) {
    const dailyMinutes = Number(settings?.['focus.dailyMinutes']) > 0 ? Number(settings['focus.dailyMinutes']) : 0;
    const usedSec = Math.max(0, Number(youtubeToday?.activeSec) || 0);
    const extraMinutes = Math.max(0, Number(state?.extraTime?.[AP.util.dayKey(at)]) || 0);
    const grace = Math.max(0, Number(settings?.['focus.limitGrace']) || 0);
    const graceLeft = Math.max(0, grace - Math.floor(extraMinutes / GRACE_MINUTES));
    const limitSec = dailyMinutes * 60;
    return {
      dailyMinutes,
      usedSec,
      extraSec: extraMinutes * 60,
      limitSec,
      graceLeft,
      reached: dailyMinutes > 0 && usedSec >= limitSec + extraMinutes * 60,
    };
  }

  /** @param {{ reason: string }[]} blocks */
  const byStrength = (a, b) => b.until - a.until || REASON_PRIORITY[b.reason] - REASON_PRIORITY[a.reason];

  /**
   * The blocks in force: focus blocks carried over from `previous` (stored, not derivable), plus
   * the schedule blocks and the limit block derived right now.
   * @param {object[]} previous the stored `state.blocks`
   * @param {{ schedules: ReturnType<typeof activeSchedules>, limit: ReturnType<typeof limitStatus>, at: number }} input
   * @returns {import('./store.js').Block[]}
   */
  function computeBlocks(previous, { schedules, limit, at }) {
    const out = (Array.isArray(previous) ? previous : []).filter((b) => b.reason === 'focus' && b.until > at).map((b) => ({ ...b }));
    for (const a of resolveSchedules(schedules).blocks) {
      out.push({ reason: 'schedule', until: a.endsAt, siteKeys: [...a.siteKeys], scheduleId: a.id, ...(a.name ? { name: a.name } : {}) });
    }
    if (limit.reached) out.push({ reason: 'limit', until: nextLocalMidnight(at), siteKeys: ['youtube'] });
    return out.sort(byStrength);
  }

  /**
   * The single `state.block` of PLAN §5: the block that lasts longest (focus > limit > schedule on
   * a tie), or null.
   * @param {{ reason: string, until: number, siteKeys: string[] }[]} blocks
   * @param {number} at
   */
  function primaryBlock(blocks, at) {
    const live = blocks.filter((b) => b.until > at).sort(byStrength);
    const first = live[0];
    return first ? { until: first.until, reason: first.reason, siteKeys: [...first.siteKeys] } : null;
  }

  /** The block that applies to one site (strongest first), or null. */
  function blockForSite(blocks, siteKey, at) {
    return blocks.filter((b) => b.until > at && b.siteKeys.includes(siteKey)).sort(byStrength)[0] ?? null;
  }

  // ---------------------------------------------------------------------------------------
  // Pause (pure helpers)
  // ---------------------------------------------------------------------------------------

  /**
   * How long the breath lasts. With `pause.escalate` each visit beyond the first one within the
   * last hour adds `pause.escalateStep` seconds, never more than 30 in total.
   * @param {Record<string, any>} settings
   * @param {number} recent pause pages opened in the last hour, this one included
   */
  function breathSeconds(settings, recent) {
    const base = Number(settings?.['pause.breathSeconds']) || 6;
    if (settings?.['pause.escalate'] !== true) return base;
    const step = Number(settings['pause.escalateStep']) || 0;
    return Math.min(MAX_BREATH_SECONDS, Math.max(base, base + step * Math.max(0, recent - 1)));
  }

  /**
   * Drops sessions that ended, and sessions of sites that no longer have a pause (pause switched
   * off, site removed or disabled): a session only exists to suppress a pause, and the page guards
   * rely on "a session in state means the pause is on".
   * @param {{ sessions: Record<string, number>, sessionMinutes: Record<string, number> }} draft mutated in place
   * @param {Record<string, any>} settings effective settings
   * @param {number} at
   */
  function pruneSessions(draft, settings, at) {
    for (const [siteKey, until] of Object.entries(draft.sessions)) {
      if (until <= at || !isPaused(settings, siteKey)) delete draft.sessions[siteKey];
    }
    for (const siteKey of Object.keys(draft.sessionMinutes)) {
      if (!(siteKey in draft.sessions)) delete draft.sessionMinutes[siteKey];
    }
  }

  // ---------------------------------------------------------------------------------------
  // Effective settings without touching storage twice
  // ---------------------------------------------------------------------------------------

  /** defaults ⊕ stored ⊕ the preset a schedule applies — the same result as AP.settings.effective(). */
  function effectiveFor(got, overrideId) {
    const meta = isPlainObject(got.meta) ? got.meta : {};
    const version = Number.isInteger(meta.schemaVersion) ? meta.schemaVersion : 1;
    const stored = version < AP.settings.SCHEMA_VERSION ? AP.settings.migrate(got.settings, version) : got.settings;
    const override = overrideId ? AP.presets.valuesFor(overrideId, got.customPresets) : null;
    return AP.settings.merge(stored, override);
  }

  // ---------------------------------------------------------------------------------------
  // reconcile
  // ---------------------------------------------------------------------------------------

  let chain = Promise.resolve();

  /**
   * Brings every derived thing in line with storage and the clock; see the file header. Calls are
   * serialized, and each call runs a full pass that starts after the call was made, so a handler
   * that just wrote something can `await reconcile()` and rely on the rules being up to date.
   * @returns {Promise<{ state: object, settings: Record<string, any> }>} the state after the pass and the effective settings it used
   */
  function reconcile() {
    const run = chain.then(doReconcile);
    chain = run.catch((err) => AP.warn('reconcile failed', err));
    return run;
  }

  async function doReconcile() {
    const at = now();
    const got = await AP.settings.readStorage(['settings', 'customPresets', 'meta']);
    // Schedules and the limit are never part of a preset, so the plain settings are enough to find
    // out which preset (if any) applies; the effective settings then include it.
    const base = effectiveFor(got, null);
    const active = activeSchedules(base['focus.schedules'], new Date(at));
    const resolved = resolveSchedules(active);
    let overrideId = null;
    for (const a of resolved.presets) {
      const id = a.action.slice('preset:'.length);
      if (AP.presets.get(id, got.customPresets)) {
        overrideId = id;
        break;
      }
    }
    const settings = effectiveFor(got, overrideId);
    const todays = await stats().today(at);

    const { after } = await store().updateState((draft) => {
      draft.scheduleOverride = overrideId;
      pruneSessions(draft, settings, at);
      const limit = limitStatus(settings, draft, todays.youtube, at);
      draft.blocks = computeBlocks(draft.blocks, { schedules: active, limit, at });
      draft.block = primaryBlock(draft.blocks, at);
    });

    await bg.rules.syncRules();
    await syncAlarms(after, base, at);
    return { state: after, settings };
  }

  // ---------------------------------------------------------------------------------------
  // Alarms
  // ---------------------------------------------------------------------------------------

  /**
   * One alarm per pause session, one for the next block end, and (only while schedules or a daily
   * limit exist) a minute tick aligned to the wall-clock minute.
   */
  async function syncAlarms(state, settings, at) {
    const alarms = AP.api.alarms;
    if (!alarms?.create) return;
    /** @type {Map<string, { when?: number, periodInMinutes?: number }>} */
    const desired = new Map();
    for (const [siteKey, until] of Object.entries(state.sessions)) {
      if (until > at) desired.set(`${SESSION_ALARM_PREFIX}${siteKey}`, { when: until + ALARM_PAD_MS });
    }
    const ends = state.blocks.map((b) => b.until).filter((u) => u > at);
    if (ends.length > 0) desired.set(BLOCK_ALARM, { when: Math.min(...ends) + ALARM_PAD_MS });
    const schedules = Array.isArray(settings['focus.schedules']) ? settings['focus.schedules'] : [];
    if (schedules.some((s) => s.enabled !== false) || Number(settings['focus.dailyMinutes']) > 0) {
      desired.set(TICK_ALARM, { when: (Math.floor(at / MINUTE) + 1) * MINUTE + 500, periodInMinutes: 1 });
    }

    const existing = new Map((await alarms.getAll()).map((a) => [a.name, a]));
    for (const name of existing.keys()) {
      const ours = name === TICK_ALARM || name === BLOCK_ALARM || name.startsWith(SESSION_ALARM_PREFIX);
      if (ours && !desired.has(name)) await alarms.clear(name);
    }
    for (const [name, spec] of desired) {
      const current = existing.get(name);
      if (spec.periodInMinutes) {
        if (!current?.periodInMinutes) await alarms.create(name, spec);
      } else if (!current || Math.abs(current.scheduledTime - spec.when) > 1000) {
        await alarms.create(name, { when: spec.when });
      }
    }
  }

  // ---------------------------------------------------------------------------------------
  // Handlers: pause
  // ---------------------------------------------------------------------------------------

  /** @param {unknown} v */
  const validSiteKey = (v) => typeof v === 'string' && store().isSiteKey(v);

  /** PAUSE_OPENED { siteKey, repeat? } → counts the visit and tells the page how long to breathe. */
  async function onPauseOpened(payload) {
    const siteKey = payload?.siteKey;
    if (!validSiteKey(siteKey)) return { ok: false, error: 'bad-site' };
    const at = now();
    const { settings, state } = await reconcile();
    if (!sitesOf(settings).get(siteKey)?.listed) return { ok: false, error: 'unknown-site' };
    const sessionUntil = state.sessions[siteKey] > at ? state.sessions[siteKey] : null;
    let counts;
    if (payload.repeat === true || sessionUntil) {
      // A reload of the same pause page, or a stale tab while a session runs: no new visit.
      const today = await stats().today(at);
      counts = { opens: today[siteKey]?.opens ?? 0, recent: Math.max(1, await stats().recentOpens(siteKey, at)) };
    } else {
      counts = await stats().recordOpen(siteKey, at);
    }
    return { ok: true, opens: counts.opens, recent: counts.recent, breathSeconds: breathSeconds(settings, counts.recent), sessionUntil };
  }

  /** PAUSE_CONTINUE { siteKey, minutes, intention } → a session, the pause rule removed. */
  async function onPauseContinue(payload) {
    const siteKey = payload?.siteKey;
    if (!validSiteKey(siteKey)) return { ok: false, error: 'bad-site' };
    const minutes = Math.round(Number(payload.minutes));
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > MAX_SESSION_MINUTES) return { ok: false, error: 'bad-minutes' };
    const at = now();
    const { settings, state } = await reconcile();
    if (!sitesOf(settings).get(siteKey)?.listed) return { ok: false, error: 'unknown-site' };
    if (blockForSite(state.blocks, siteKey, at)) return { ok: false, error: 'blocked' };

    const until = at + minutes * MINUTE;
    await store().updateState((draft) => {
      // Never shorten a session that is already running (two tabs continuing at once).
      if (!(draft.sessions[siteKey] > until)) {
        draft.sessions[siteKey] = until;
        draft.sessionMinutes[siteKey] = minutes;
      }
    });
    await stats().recordCount(siteKey, 'continued', at);
    await stats().addIntention(siteKey, payload.intention, at);
    await reconcile(); // the pause rule must be gone before the page navigates on
    return { ok: true, until: Math.max(until, state.sessions[siteKey] ?? 0) };
  }

  /** PAUSE_TURN_BACK { siteKey } → stats only. */
  async function onPauseTurnBack(payload) {
    if (!validSiteKey(payload?.siteKey)) return { ok: false, error: 'bad-site' };
    await stats().recordCount(payload.siteKey, 'turnedBack', now());
    return { ok: true };
  }

  // ---------------------------------------------------------------------------------------
  // Handlers: focus & limit
  // ---------------------------------------------------------------------------------------

  /**
   * FOCUS_START { minutes?, untilEndOfDay?, siteKeys? }. Starting a block while one runs only ever
   * extends it (a shorter block must not be a way to shorten a longer, strict one).
   */
  async function onFocusStart(payload) {
    const at = now();
    const p = isPlainObject(payload) ? payload : {};
    let until;
    if (p.untilEndOfDay === true) {
      until = nextLocalMidnight(at);
    } else {
      const minutes = Math.round(Number(p.minutes));
      if (!Number.isFinite(minutes) || minutes < 1 || minutes > MAX_FOCUS_MINUTES) return { ok: false, error: 'bad-minutes' };
      until = at + minutes * MINUTE;
    }
    const known = sitesOf(await AP.settings.effective());
    const wanted = Array.isArray(p.siteKeys) ? p.siteKeys.filter((k) => typeof k === 'string' && known.has(k)) : [];
    const siteKeys = [...new Set(wanted.length > 0 ? wanted : ['youtube'])];

    await store().updateState((draft) => {
      const running = draft.blocks.find((b) => b.reason === 'focus' && b.until > at);
      if (running) {
        running.until = Math.max(running.until, until);
        running.siteKeys = [...new Set([...running.siteKeys, ...siteKeys])];
      } else {
        draft.blocks.push({ reason: 'focus', until, siteKeys });
      }
    });
    const { state } = await reconcile();
    return { ok: true, block: state.block };
  }

  /**
   * FOCUS_END { frictionDone? } — strict forbids it; friction other than 'none' must have been done
   * by the page; while the settings lock holds (src/shared/lock.js) it needs an unlock first,
   * because ending a block early shows YouTube again.
   */
  async function onFocusEnd(payload) {
    const at = now();
    const settings = await AP.settings.effective();
    const { blocks, lockUnlockedUntil } = await store().readState();
    if (!blocks.some((b) => b.reason === 'focus' && b.until > at)) return { ok: true };
    if (settings['focus.strict'] === true) return { ok: false, error: 'strict' };
    if (AP.lock.status(settings['advanced.lock'], lockUnlockedUntil, at).locked) return { ok: false, error: 'locked' };
    if (settings['focus.unlockFriction'] !== 'none' && payload?.frictionDone !== true) return { ok: false, error: 'friction-required' };
    await store().updateState((draft) => {
      draft.blocks = draft.blocks.filter((b) => b.reason !== 'focus');
    });
    await reconcile();
    return { ok: true };
  }

  /** LIMIT_GRACE → "5 more minutes" if the limit is reached and the day's allowance is not used up. */
  async function onLimitGrace() {
    const at = now();
    const { settings, state } = await reconcile();
    const todays = await stats().today(at);
    const limit = limitStatus(settings, state, todays.youtube, at);
    if (limit.dailyMinutes === 0 || !limit.reached) return { ok: false, error: 'not-needed' };
    if (limit.graceLeft <= 0) return { ok: false, error: 'no-grace' };
    const day = AP.util.dayKey(at);
    await store().updateState((draft) => {
      draft.extraTime[day] = (draft.extraTime[day] ?? 0) + GRACE_MINUTES;
    });
    const after = await reconcile(); // the block and its DNR rule go away before the page navigates on
    return { ok: true, graceLeft: limitStatus(after.settings, after.state, todays.youtube, at).graceLeft };
  }

  // ---------------------------------------------------------------------------------------
  // GET_STATUS (Contract C3)
  // ---------------------------------------------------------------------------------------

  /** The settings lock as pages need it: `{ mode, unlockedUntil }` (unlockedUntil 0 = locked). */
  function lockOf(settings, state, at) {
    const { mode, unlockedUntil } = AP.lock.status(settings['advanced.lock'], state.lockUnlockedUntil, at);
    return { mode, unlockedUntil };
  }

  /**
   * @returns {Promise<{ ok: true, version: string, block: object|null, sessions: Record<string, number>,
   *   scheduleOverride: string|null, activeSchedules: object[], today: Record<string, object>,
   *   limit: { dailyMinutes: number, usedSec: number, graceLeft: number }, blocks: object[],
   *   lock: { mode: string, unlockedUntil: number }, now: number }>}
   */
  async function onGetStatus() {
    const at = now();
    const { settings, state } = await reconcile();
    const todays = await stats().today(at);
    const today = { youtube: AP.state.emptyCounters(), ...todays };
    const limit = limitStatus(settings, state, todays.youtube, at);
    const active = activeSchedules(settings['focus.schedules'], new Date(at));
    const sessions = Object.fromEntries(Object.entries(state.sessions).filter(([, until]) => until > at));
    return {
      ok: true,
      version: AP.api.runtime.getManifest().version,
      block: state.block,
      sessions,
      scheduleOverride: state.scheduleOverride,
      activeSchedules: active.map(({ id, name, action, endsAt }) => ({ id, name, action, endsAt })),
      today,
      limit: { dailyMinutes: limit.dailyMinutes, usedSec: limit.usedSec, graceLeft: limit.graceLeft },
      // Beyond Contract C3 (additive): every block in force, for pages that need the one of their own site.
      blocks: state.blocks.filter((b) => b.until > at),
      lock: lockOf(settings, state, at),
      now: at,
    };
  }

  bg.sessions = {
    GRACE_MINUTES,
    TICK_ALARM,
    BLOCK_ALARM,
    SESSION_ALARM_PREFIX,
    sitesOf,
    isPaused,
    nextLocalMidnight,
    activeSchedules,
    resolveSchedules,
    limitStatus,
    computeBlocks,
    primaryBlock,
    blockForSite,
    breathSeconds,
    pruneSessions,
    effectiveFor,
    lockOf,
    reconcile,
    syncAlarms,
    handlers: {
      onPauseOpened,
      onPauseContinue,
      onPauseTurnBack,
      onFocusStart,
      onFocusEnd,
      onLimitGrace,
      onGetStatus,
    },
  };
})();
