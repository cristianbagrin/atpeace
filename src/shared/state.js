// Runtime state and usage stats: READ helpers and pure functions (PLAN §5, §5.4).
//
// WRITERS LIVE IN THE BACKGROUND ONLY (src/background/*, Phase 3c). Pages and content scripts
// send messages (AP.msg) and read from here; `state` and `stats` are never written from anywhere
// else, which avoids write races between tabs. Nothing in this file writes to storage.
//
// Reads go through AP.settings.readStorage (retries Firefox's occasional transient read failure).
//
// Shapes (see PLAN §5):
//   state = { sessions: {[siteKey]: untilMs}, block: {until, reason, siteKeys[]}|null,
//             extraTime: {[YYYY-MM-DD]: minutes}, scheduleOverride: presetId|null }
//   stats = { [YYYY-MM-DD]: { [siteKey]: { activeSec, opens, turnedBack, continued, blockedHits } } }
// Everything handed out is normalized: missing or corrupt parts become empty/zero, so callers
// never need null checks.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;
  const { isPlainObject } = AP.util;

  const COUNTER_KEYS = Object.freeze(['activeSec', 'opens', 'turnedBack', 'continued', 'blockedHits']);
  const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
  const DEFAULT_KEEP_DAYS = 90;

  const count = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

  /** @returns {{activeSec:number, opens:number, turnedBack:number, continued:number, blockedHits:number}} */
  function emptyCounters() {
    return { activeSec: 0, opens: 0, turnedBack: 0, continued: 0, blockedHits: 0 };
  }

  function normalizeCounters(raw) {
    const out = emptyCounters();
    if (isPlainObject(raw)) for (const key of COUNTER_KEYS) out[key] = count(raw[key]);
    return out;
  }

  /**
   * @param {unknown} raw stored `state`
   * @returns {{ sessions: Record<string, number>, block: null | { until: number, reason: string, siteKeys: string[] }, extraTime: Record<string, number>, scheduleOverride: string|null }}
   */
  function normalizeState(raw) {
    const src = isPlainObject(raw) ? raw : {};
    const sessions = {};
    if (isPlainObject(src.sessions)) {
      for (const [siteKey, until] of Object.entries(src.sessions)) {
        if (typeof until === 'number' && Number.isFinite(until) && until > 0) sessions[siteKey] = until;
      }
    }
    const extraTime = {};
    if (isPlainObject(src.extraTime)) {
      for (const [day, minutes] of Object.entries(src.extraTime)) if (DAY_RE.test(day)) extraTime[day] = count(minutes);
    }
    let block = null;
    if (isPlainObject(src.block) && typeof src.block.until === 'number' && Number.isFinite(src.block.until)) {
      block = {
        until: src.block.until,
        reason: typeof src.block.reason === 'string' ? src.block.reason : 'focus',
        siteKeys: Array.isArray(src.block.siteKeys) ? src.block.siteKeys.filter((k) => typeof k === 'string') : [],
      };
    }
    return {
      sessions,
      block,
      extraTime,
      scheduleOverride: typeof src.scheduleOverride === 'string' && src.scheduleOverride !== '' ? src.scheduleOverride : null,
    };
  }

  /** @param {unknown} raw stored `stats` @returns {Record<string, Record<string, ReturnType<typeof emptyCounters>>>} */
  function normalizeStats(raw) {
    const out = {};
    if (!isPlainObject(raw)) return out;
    for (const [day, sites] of Object.entries(raw)) {
      if (!DAY_RE.test(day) || !isPlainObject(sites)) continue;
      out[day] = {};
      for (const [siteKey, counters] of Object.entries(sites)) out[day][siteKey] = normalizeCounters(counters);
    }
    return out;
  }

  /** Current runtime state, normalized. */
  async function getState() {
    const { state } = await AP.settings.readStorage('state');
    return normalizeState(state);
  }

  /**
   * Usage stats, normalized. With `day` ('YYYY-MM-DD', local): that day's `{ [siteKey]: counters }`
   * (empty object when there is nothing); without: the whole `{ [day]: … }` map.
   * @param {string} [day]
   */
  async function getStats(day) {
    const { stats } = await AP.settings.readStorage('stats');
    const all = normalizeStats(stats);
    return day === undefined ? all : (all[day] ?? {});
  }

  /**
   * Today's counters (local calendar day) for one site; all zeros when nothing was recorded.
   * @param {string} siteKey
   * @param {number|Date} [now]
   */
  async function todayFor(siteKey, now = Date.now()) {
    const today = await getStats(AP.util.dayKey(now));
    return normalizeCounters(today[siteKey]);
  }

  /**
   * Drops stats older than the last `keepDays` calendar days (today included) and any key that is
   * not a day. Pure: returns a new object.
   * @param {unknown} stats
   * @param {number} [keepDays]
   * @param {number|Date} [now]
   */
  function pruneStats(stats, keepDays = DEFAULT_KEEP_DAYS, now = Date.now()) {
    const today = new Date(now);
    // Calendar arithmetic on the local date, so a DST change cannot shift the cutoff by a day.
    const cutoff = AP.util.dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - (Math.max(1, keepDays) - 1)));
    const out = {};
    if (!isPlainObject(stats)) return out;
    for (const [day, value] of Object.entries(stats)) {
      if (DAY_RE.test(day) && day >= cutoff) out[day] = value;
    }
    return out;
  }

  /** YouTube's siteKey only covers the main site, not music./studio./tv. (PLAN §8.2). */
  function hostMatches(host, domain, siteKey) {
    if (siteKey === 'youtube' && domain === 'youtube.com') {
      return host === 'youtube.com' || host === 'www.youtube.com' || host === 'm.youtube.com';
    }
    return host === domain || host.endsWith(`.${domain}`);
  }

  /**
   * Which configured site (`pause.sites` entry) a URL belongs to: its `siteKey`, or null.
   * A site matches its domain and any subdomain (except YouTube, where only the bare/www/m hosts
   * count). The most specific domain wins. Only http(s) URLs match. `enabled` is ignored: this
   * answers "which site is this", the caller decides whether it is paused.
   * @param {string|URL} url
   * @param {{siteKey: string, domain: string, enabled?: boolean}[]} pauseSites
   * @returns {string|null}
   */
  function siteKeyForUrl(url, pauseSites) {
    let parsed;
    try {
      parsed = new URL(String(url));
    } catch {
      return null;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
    let best = null;
    for (const site of Array.isArray(pauseSites) ? pauseSites : []) {
      if (!isPlainObject(site) || typeof site.domain !== 'string' || typeof site.siteKey !== 'string') continue;
      const domain = site.domain.toLowerCase();
      if (!hostMatches(host, domain, site.siteKey)) continue;
      if (!best || domain.length > best.domain.length) best = { domain, siteKey: site.siteKey };
    }
    return best?.siteKey ?? null;
  }

  AP.state = {
    COUNTER_KEYS,
    DEFAULT_KEEP_DAYS,
    emptyCounters,
    normalizeState,
    normalizeStats,
    getState,
    getStats,
    todayFor,
    pruneStats,
    siteKeyForUrl,
  };
})();
