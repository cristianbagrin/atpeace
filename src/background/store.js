// Background storage helpers (PLAN §5): the ONE place that writes `state` and `stats`.
//
// Everything here follows two rules of the event page (PLAN §8): no in-memory state that matters
// (an event page can be unloaded at any moment, so all truth lives in storage), and no two
// read-modify-write cycles on the same key may overlap (overlapping events — a heartbeat while a
// pause continues — would otherwise overwrite each other). Writes to one key are therefore
// serialized through a per-key promise queue.
//
// `state` holds the PLAN §5 fields plus two background-private extensions that readers of
// AP.state.normalizeState() simply do not see:
//   sessionMinutes  { [siteKey]: minutes }   how long the current pause session was granted for,
//                                            so the expiry overlay can say "Your 15 minutes are up"
//   blocks          [{ reason, until, siteKeys, scheduleId?, name? }]
//                                            every block in force (focus / schedule / limit); the
//                                            single `block` of PLAN §5 is the primary one of these
//   lockUnlockedUntil  ms                    the settings lock is open until then (src/shared/lock.js);
//                                            0 / past = locked. Pages read it straight from storage.
//
// Short-lived bookkeeping (the last heartbeat per site) lives in storage.session, which survives
// event-page unloads but not a browser restart; where storage.session is missing the fallback is an
// in-memory map (good enough: it only affects de-duplicating beats).
(() => {
  'use strict';
  const AP = globalThis.AtPeace;
  const bg = (AP.bg ??= {});
  const { isPlainObject, deepEqual } = AP.util;

  /** The background's clock; unit tests replace `bg.clock.now` to drive time. */
  bg.clock ??= { now: () => Date.now() };

  const REASONS = Object.freeze(['focus', 'limit', 'schedule']);
  const SITE_KEY_RE = /^[a-z0-9][a-z0-9.-]{0,98}$/;
  /** Days of "extra time" bookkeeping kept in state (only today's matters; a few days of slack). */
  const KEEP_EXTRA_DAYS = 8;

  const area = () => AP.api.storage.local;

  // ---------------------------------------------------------------------------------------
  // Per-key serialization
  // ---------------------------------------------------------------------------------------

  const queues = new Map();

  /**
   * Runs `task` after every earlier task of the same `key` has settled. A failing task rejects its
   * own caller only; it never blocks the queue.
   * @template T
   * @param {string} key
   * @param {() => Promise<T>|T} task
   * @returns {Promise<T>}
   */
  function queue(key, task) {
    const previous = queues.get(key) ?? Promise.resolve();
    const run = previous.then(task, task);
    queues.set(
      key,
      run.catch(() => {}),
    );
    return run;
  }

  // ---------------------------------------------------------------------------------------
  // state
  // ---------------------------------------------------------------------------------------

  const isSiteKey = (v) => typeof v === 'string' && SITE_KEY_RE.test(v);

  /**
   * @typedef {{ reason: 'focus'|'limit'|'schedule', until: number, siteKeys: string[], scheduleId?: string, name?: string }} Block
   */

  /** @param {unknown} raw @returns {Block[]} */
  function normalizeBlocks(raw) {
    if (!Array.isArray(raw)) return [];
    const out = [];
    for (const b of raw) {
      if (!isPlainObject(b) || !REASONS.includes(b.reason)) continue;
      if (typeof b.until !== 'number' || !Number.isFinite(b.until)) continue;
      const siteKeys = Array.isArray(b.siteKeys) ? [...new Set(b.siteKeys.filter(isSiteKey))] : [];
      if (siteKeys.length === 0) continue;
      const block = { reason: b.reason, until: b.until, siteKeys };
      if (typeof b.scheduleId === 'string') block.scheduleId = b.scheduleId.slice(0, 40);
      if (typeof b.name === 'string' && b.name !== '') block.name = b.name.slice(0, 80);
      out.push(block);
    }
    return out;
  }

  /**
   * Stored `state` → the full background view: PLAN §5 fields (normalized by AP.state) plus the
   * private extensions above. Always a fresh object.
   * @param {unknown} raw
   */
  function fromRaw(raw) {
    const base = AP.state.normalizeState(raw);
    const src = isPlainObject(raw) ? raw : {};
    const sessionMinutes = {};
    if (isPlainObject(src.sessionMinutes)) {
      for (const [key, minutes] of Object.entries(src.sessionMinutes)) {
        if (isSiteKey(key) && typeof minutes === 'number' && Number.isFinite(minutes) && minutes > 0) sessionMinutes[key] = minutes;
      }
    }
    // A `state` written without our `blocks` list (another writer, the PLAN §5 shape) is adopted:
    // its single `block` becomes the first entry, so nothing is silently lost.
    let blocks = normalizeBlocks(src.blocks);
    if (!Array.isArray(src.blocks) && base.block) {
      const { block } = base;
      blocks = normalizeBlocks([{ ...block, reason: REASONS.includes(block.reason) ? block.reason : 'focus', siteKeys: block.siteKeys.length > 0 ? block.siteKeys : ['youtube'] }]);
    }
    const unlocked = Number(src.lockUnlockedUntil);
    return { ...base, sessionMinutes, blocks, lockUnlockedUntil: Number.isFinite(unlocked) && unlocked > 0 ? unlocked : 0 };
  }

  /** The view → what goes into storage (only known fields; extraTime trimmed to recent days). */
  function toRaw(state) {
    const days = Object.keys(state.extraTime).sort().slice(-KEEP_EXTRA_DAYS);
    return {
      sessions: state.sessions,
      sessionMinutes: state.sessionMinutes,
      block: state.block,
      blocks: state.blocks,
      extraTime: Object.fromEntries(days.map((d) => [d, state.extraTime[d]])),
      scheduleOverride: state.scheduleOverride,
      lockUnlockedUntil: state.lockUnlockedUntil,
    };
  }

  /** @returns {Promise<ReturnType<typeof fromRaw>>} */
  async function readState() {
    const { state } = await AP.settings.readStorage('state');
    return fromRaw(state);
  }

  /**
   * Atomic read-modify-write of `state`. `fn(draft)` mutates the draft (a fresh copy) and may
   * return a value; the write happens only when something actually changed (a write that changes
   * nothing would still wake every tab through storage.onChanged in some browsers).
   * @template T
   * @param {(draft: ReturnType<typeof fromRaw>) => T|Promise<T>} fn
   * @returns {Promise<{ before: ReturnType<typeof fromRaw>, after: ReturnType<typeof fromRaw>, result: T }>}
   */
  function updateState(fn) {
    return queue('state', async () => {
      const before = await readState();
      const after = structuredClone(before);
      const result = await fn(after);
      if (!deepEqual(before, after)) await area().set({ state: toRaw(after) });
      return { before, after, result };
    });
  }

  // ---------------------------------------------------------------------------------------
  // stats
  // ---------------------------------------------------------------------------------------

  /** Raw stats map (not normalized: read-modify-write keeps whatever fields a day carries). */
  async function readStatsRaw() {
    const { stats } = await AP.settings.readStorage('stats');
    return isPlainObject(stats) ? stats : {};
  }

  /**
   * Atomic read-modify-write of `stats` on the RAW map. Older than 90 days is pruned on every write.
   * @template T
   * @param {(draft: Record<string, any>) => T|Promise<T>} fn
   * @param {number} [now]
   * @returns {Promise<T>}
   */
  function updateStats(fn, now = bg.clock.now()) {
    return queue('stats', async () => {
      const before = await readStatsRaw();
      const draft = structuredClone(before);
      const result = await fn(draft);
      const next = AP.state.pruneStats(draft, AP.state.DEFAULT_KEEP_DAYS, now);
      if (!deepEqual(before, next)) await area().set({ stats: next });
      return result;
    });
  }

  // ---------------------------------------------------------------------------------------
  // storage.session (with an in-memory fallback)
  // ---------------------------------------------------------------------------------------

  const memory = new Map();

  /** @param {string} key */
  async function sessionGet(key) {
    const session = AP.api.storage?.session;
    if (!session) return memory.get(key);
    try {
      return (await session.get(key))[key];
    } catch {
      return memory.get(key);
    }
  }

  /** @param {string} key @param {any} value */
  async function sessionSet(key, value) {
    const session = AP.api.storage?.session;
    memory.set(key, value);
    if (!session) return;
    try {
      await session.set({ [key]: value });
    } catch {
      /* the in-memory copy still works for this wake-up */
    }
  }

  bg.store = {
    REASONS,
    queue,
    normalizeBlocks,
    readState,
    updateState,
    readStatsRaw,
    updateStats,
    sessionGet,
    sessionSet,
    isSiteKey,
  };
})();
