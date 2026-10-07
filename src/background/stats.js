// Usage stats (PLAN §5.4): heartbeats → active seconds, pause outcomes and blocked-page hits. Only
// the background writes `stats`.
//
//   stats = { [YYYY-MM-DD local]: { [siteKey]: { activeSec, opens, turnedBack, continued, blockedHits } } }
//
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

  const SESSION_KEYS = Object.freeze({ lastBeat: 'lastBeat' });

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
   * A pause page was opened: opens++.
   * @returns {Promise<number>} today's count for the site, this visit included
   */
  function recordOpen(siteKey, now = bg.clock.now()) {
    const day = AP.util.dayKey(now);
    return store().updateStats((draft) => {
      const counters = entry(draft, day, siteKey);
      bump(counters, 'opens');
      return counters.opens;
    }, now);
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
   * Forgets every day of usage ("Clear usage history"). The last-heartbeat bookkeeping stays: it
   * only prevents double counting and holds no history.
   * @returns {Promise<number>} how many days were removed
   */
  function clear() {
    return store().updateStats((draft) => {
      const days = Object.keys(draft);
      for (const day of days) delete draft[day];
      return days.length;
    });
  }

  /**
   * 0.1.0 could keep the one-line "what did you come for" answers inside the stats. That feature is
   * gone; after an update the old lines are removed rather than left behind where nothing shows them.
   * @returns {Promise<number>} how many entries had lines
   */
  function dropLegacyIntentions() {
    return store().updateStats((draft) => {
      let found = 0;
      for (const sites of Object.values(draft)) {
        if (!isPlainObject(sites)) continue;
        for (const counters of Object.values(sites)) {
          if (isPlainObject(counters) && 'intentions' in counters) {
            delete counters.intentions;
            found++;
          }
        }
      }
      return found;
    });
  }

  /** Today's counters for every site that has any, normalized to the five public numbers. */
  async function today(now = bg.clock.now()) {
    return AP.state.getStats(AP.util.dayKey(now));
  }

  bg.stats = {
    MIN_GAP_MS,
    MAX_CREDIT_SEC,
    FIRST_BEAT_SEC,
    creditFor,
    heartbeat,
    recordOpen,
    recordCount,
    clear,
    dropLegacyIntentions,
    today,
  };
})();
