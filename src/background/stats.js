// Usage stats (PLAN §5.4): heartbeats → active seconds, pause outcomes, blocked-page hits and the
// optional "what did you come for" lines. Only the background writes `stats`.
//
//   stats = { [YYYY-MM-DD local]: { [siteKey]: { activeSec, opens, turnedBack, continued, blockedHits,
//                                                intentions?: [{ at, text }] } } }
//
// `intentions` is a background-private extension (AP.state readers only look at the five counters).
// Every write is a read-modify-write on the raw map through AP.bg.store's per-key queue, so two
// overlapping events (a heartbeat and a pause outcome) never lose each other's update.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;
  const bg = (AP.bg ??= {});
  const store = () => bg.store;
  const { isPlainObject } = AP.util;

  /** Beats closer together than this per site are ignored: the same time seen from a second tab. */
  const MIN_GAP_MS = 25_000;
  /** One beat can add at most this many seconds (beats come every 30 s). */
  const MAX_CREDIT_SEC = 35;
  /** What the very first beat of a stretch is worth (the tracker sends it after 30 s of presence). */
  const FIRST_BEAT_SEC = 30;
  const MAX_INTENTIONS = 20;
  const INTENTION_MAX_LENGTH = 140;
  const HOUR_MS = 3_600_000;
  const MAX_RECENT = 40;

  const SESSION_KEYS = Object.freeze({ lastBeat: 'lastBeat', recentOpens: 'recentOpens' });

  /** The counters object of `siteKey` on `day`, created on demand. */
  function entry(draft, day, siteKey) {
    if (!isPlainObject(draft[day])) draft[day] = {};
    if (!isPlainObject(draft[day][siteKey])) draft[day][siteKey] = AP.state.emptyCounters();
    return draft[day][siteKey];
  }

  function bump(counters, field, amount = 1) {
    const current = typeof counters[field] === 'number' && Number.isFinite(counters[field]) ? counters[field] : 0;
    counters[field] = current + amount;
  }

  /**
   * Credits the time between two heartbeats. Pure, so the rules are unit-tested without storage.
   * @param {number|undefined} last timestamp of the previous accepted beat for this site
   * @param {number} now
   * @returns {{ counted: boolean, seconds: number }}
   */
  function creditFor(last, now) {
    if (typeof last !== 'number' || !Number.isFinite(last)) return { counted: true, seconds: FIRST_BEAT_SEC };
    const delta = now - last;
    if (delta < MIN_GAP_MS) return { counted: false, seconds: 0 };
    return { counted: true, seconds: Math.min(Math.round(delta / 1000), MAX_CREDIT_SEC) };
  }

  /**
   * One HEARTBEAT: ignore beats less than 25 s after the previous one for the same site, otherwise
   * add min(delta, 35) seconds to today's activeSec.
   * @param {string} siteKey
   * @param {number} [now]
   * @returns {Promise<{ counted: boolean, seconds: number, activeSec: number }>}
   */
  function heartbeat(siteKey, now = bg.clock.now()) {
    const day = AP.util.dayKey(now);
    return store().updateStats(async (draft) => {
      const beats = (await store().sessionGet(SESSION_KEYS.lastBeat)) ?? {};
      const credit = creditFor(beats[siteKey], now);
      const counters = entry(draft, day, siteKey);
      if (credit.counted) {
        bump(counters, 'activeSec', credit.seconds);
        await store().sessionSet(SESSION_KEYS.lastBeat, { ...beats, [siteKey]: now });
      }
      return { ...credit, activeSec: counters.activeSec };
    }, now);
  }

  /**
   * A pause page was opened: opens++ and remember the time (for "visits in the last hour").
   * @returns {Promise<{ opens: number, recent: number }>}
   */
  async function recordOpen(siteKey, now = bg.clock.now()) {
    const day = AP.util.dayKey(now);
    const opens = await store().updateStats((draft) => {
      const counters = entry(draft, day, siteKey);
      bump(counters, 'opens');
      return counters.opens;
    }, now);
    const recent = await store().queue('recent', async () => {
      const all = (await store().sessionGet(SESSION_KEYS.recentOpens)) ?? {};
      const list = [...(Array.isArray(all[siteKey]) ? all[siteKey] : []).filter((t) => typeof t === 'number' && now - t < HOUR_MS), now].slice(-MAX_RECENT);
      await store().sessionSet(SESSION_KEYS.recentOpens, { ...all, [siteKey]: list });
      return list.length;
    });
    return { opens, recent };
  }

  /** How many pause pages were opened for `siteKey` in the last hour. */
  async function recentOpens(siteKey, now = bg.clock.now()) {
    const all = (await store().sessionGet(SESSION_KEYS.recentOpens)) ?? {};
    const list = Array.isArray(all[siteKey]) ? all[siteKey] : [];
    return list.filter((t) => typeof t === 'number' && now - t < HOUR_MS).length;
  }

  /**
   * @param {string} siteKey
   * @param {'turnedBack'|'continued'|'blockedHits'} field
   */
  function recordCount(siteKey, field, now = bg.clock.now()) {
    const day = AP.util.dayKey(now);
    return store().updateStats((draft) => {
      const counters = entry(draft, day, siteKey);
      bump(counters, field);
      return counters[field];
    }, now);
  }

  /**
   * Cleans an intention line: collapsed whitespace, trimmed, at most 140 characters; '' when there
   * is nothing worth keeping.
   * @param {unknown} text
   */
  function cleanIntention(text) {
    if (typeof text !== 'string') return '';
    return text.replace(/\s+/g, ' ').trim().slice(0, INTENTION_MAX_LENGTH).trim();
  }

  /**
   * Keeps "what I came for" in today's stats for the site: newest last, at most 20 (oldest dropped).
   * @returns {Promise<boolean>} whether something was stored
   */
  async function addIntention(siteKey, text, now = bg.clock.now()) {
    const clean = cleanIntention(text);
    if (clean === '') return false;
    const day = AP.util.dayKey(now);
    await store().updateStats((draft) => {
      const counters = entry(draft, day, siteKey);
      const list = Array.isArray(counters.intentions) ? counters.intentions : [];
      counters.intentions = [...list, { at: now, text: clean }].slice(-MAX_INTENTIONS);
    }, now);
    return true;
  }

  /** Today's counters for every site that has any, normalized to the five public numbers. */
  async function today(now = bg.clock.now()) {
    return AP.state.getStats(AP.util.dayKey(now));
  }

  bg.stats = {
    MIN_GAP_MS,
    MAX_CREDIT_SEC,
    FIRST_BEAT_SEC,
    MAX_INTENTIONS,
    INTENTION_MAX_LENGTH,
    creditFor,
    cleanIntention,
    heartbeat,
    recordOpen,
    recentOpens,
    recordCount,
    addIntention,
    today,
  };
})();
