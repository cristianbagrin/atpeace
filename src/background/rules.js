// The DNR "rules compiler" (PLAN §8.2): effective settings + runtime state + the clock → the
// complete list of dynamic declarativeNetRequest rules, and `syncRules()` which makes the
// browser's dynamic rules equal that list in one `updateDynamicRules` call.
//
//   ids          priority   purpose
//   100–199      300        BLOCK   focus / schedule / daily-limit → blocked.html?reason=…#<url>
//   200–299      200        PAUSE   Mindful Pause → pause.html#<url>   (site has no running session)
//   300–399      100        YouTube redirects (AP.yt.redirects.dnrRules, Contract C2)
//
// All rules apply to `main_frame` only. The original URL travels in the hash, unencoded
// (`regexSubstitution` with `\0`), which is why every site regex ends in `.*`: `\0` is the part of
// the URL the regex MATCHED, so the regex has to match the whole URL. Regexes are RE2-compatible
// (no lookarounds, no backreferences) because Chrome compiles them with RE2.
//
// computeRules() is pure (unit-tested). It computes schedule blocks straight from the clock, so a
// schedule starts and ends exactly on time even when the minute alarm is late.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;
  const bg = (AP.bg ??= {});
  const { isPlainObject } = AP.util;

  const RANGES = Object.freeze({ block: 100, pause: 200, redirect: 300 });
  const PRIORITY = Object.freeze({ block: 300, pause: 200, redirect: 100 });
  const RANGE_SIZE = 100;
  const REASON_PRIORITY = Object.freeze({ focus: 3, limit: 2, schedule: 1 });
  const PAGES = Object.freeze({
    pause: 'src/pages/pause/pause.html',
    blocked: 'src/pages/blocked/blocked.html',
  });

  /** YouTube proper: the bare domain, www and m. — not music., studio., tv. (PLAN §8.2). */
  const YOUTUBE_REGEX = '^https?://(www\\.|m\\.)?youtube\\.com/.*';

  const escapeRegex = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /**
   * The regex a rule uses to recognise a site's page loads: the domain and any subdomain.
   * @param {{ siteKey: string, domain: string }} site
   */
  function siteRegex(site) {
    if (site.siteKey === 'youtube') return YOUTUBE_REGEX;
    return `^https?://([a-z0-9-]+\\.)*${escapeRegex(site.domain)}(:[0-9]+)?/.*`;
  }

  const redirectRule = (id, priority, regex, target) => ({
    id,
    priority,
    action: { type: 'redirect', redirect: { regexSubstitution: target } },
    condition: { regexFilter: regex, isUrlFilterCaseSensitive: false, resourceTypes: ['main_frame'] },
  });

  /** Every block in force at `now`: the stored ones plus the schedule blocks the clock says are on. */
  function blocksAt(settings, state, now) {
    const blocks = (Array.isArray(state?.blocks) ? state.blocks : []).filter((b) => b.until > now);
    const schedules = bg.sessions.activeSchedules(settings['focus.schedules'], new Date(now));
    for (const a of bg.sessions.resolveSchedules(schedules).blocks) blocks.push({ reason: 'schedule', until: a.endsAt, siteKeys: a.siteKeys });
    return blocks;
  }

  /**
   * @typedef {Object} RuleOptions
   * @property {string} pauseUrl    full URL of the pause page (no hash)
   * @property {string} blockedUrl  full URL of the blocked page (no query, no hash)
   * @property {{ dnrRules?: Function }} [ytRedirects]  AP.yt.redirects (Contract C2), when loaded
   */

  /**
   * The full desired list of dynamic rules.
   * @param {Record<string, any>} settings effective settings
   * @param {{ sessions: Record<string, number>, blocks?: object[] }} state
   * @param {number} now ms since epoch
   * @param {RuleOptions} options
   * @returns {object[]} rules sorted by id
   */
  function computeRules(settings, state, now, options) {
    const { pauseUrl, blockedUrl, ytRedirects } = options;
    const sites = bg.sessions.sitesOf(settings);
    const rules = [];

    // BLOCK: one rule per blocked site; where several blocks cover a site the strongest reason shows.
    const reasonOf = new Map();
    for (const block of blocksAt(settings, state, now)) {
      for (const key of block.siteKeys) {
        if (!sites.has(key)) continue; // a site with no known domain cannot be matched
        const known = reasonOf.get(key);
        if (!known || REASON_PRIORITY[block.reason] > REASON_PRIORITY[known]) reasonOf.set(key, block.reason);
      }
    }
    [...reasonOf.keys()]
      .sort()
      .slice(0, RANGE_SIZE)
      .forEach((key, i) => {
        rules.push(redirectRule(RANGES.block + i, PRIORITY.block, siteRegex(sites.get(key)), `${blockedUrl}?reason=${reasonOf.get(key)}#\\0`));
      });

    // PAUSE: every listed, enabled site that has no running session.
    if (settings['pause.enabled'] === true) {
      [...sites.values()]
        .filter((s) => s.listed && s.enabled && !(state.sessions?.[s.siteKey] > now))
        .sort((a, b) => (a.siteKey < b.siteKey ? -1 : 1))
        .slice(0, RANGE_SIZE)
        .forEach((site, i) => {
          rules.push(redirectRule(RANGES.pause + i, PRIORITY.pause, siteRegex(site), `${pauseUrl}#\\0`));
        });
    }

    // YouTube redirects. They are part of how YouTube behaves, so the master switch governs them
    // (unlike the pause and the blocks, which must never be a way out via the master switch).
    if (settings['general.enabled'] !== false && typeof ytRedirects?.dnrRules === 'function') {
      let list = [];
      try {
        list = ytRedirects.dnrRules(settings, { blockedPageUrl: blockedUrl });
      } catch (err) {
        AP.warn('YouTube redirect rules failed to compile', err);
      }
      (Array.isArray(list) ? list : [])
        .filter((r) => isPlainObject(r) && typeof r.key === 'string' && isPlainObject(r.action) && isPlainObject(r.condition))
        .sort((a, b) => (a.key < b.key ? -1 : 1))
        .slice(0, RANGE_SIZE)
        .forEach((r, i) => {
          rules.push({
            id: RANGES.redirect + i,
            priority: Number.isInteger(r.priority) ? r.priority : PRIORITY.redirect,
            action: r.action,
            condition: { resourceTypes: ['main_frame'], ...r.condition },
          });
        });
    }
    return rules;
  }

  // ---------------------------------------------------------------------------------------
  // Diff & apply
  // ---------------------------------------------------------------------------------------

  /** Does `have` contain everything `want` says? (A browser may report extra default fields.) */
  function contains(want, have) {
    if (Array.isArray(want)) return Array.isArray(have) && want.length === have.length && want.every((w, i) => contains(w, have[i]));
    if (isPlainObject(want)) return isPlainObject(have) && Object.entries(want).every(([k, v]) => contains(v, have[k]));
    return want === have;
  }

  const sameRule = (want, have) => Boolean(have) && want.id === have.id && want.priority === have.priority && contains(want.action, have.action) && contains(want.condition, have.condition);

  const ours = (id) => id >= RANGES.block && id < RANGES.redirect + RANGE_SIZE;

  /**
   * What has to change to turn `existing` into `desired`. Rules outside our id ranges are left alone.
   * @param {object[]} desired
   * @param {object[]} existing
   * @returns {{ removeRuleIds: number[], addRules: object[] }}
   */
  function diffRules(desired, existing) {
    const have = new Map(existing.filter((r) => ours(r.id)).map((r) => [r.id, r]));
    const want = new Map(desired.map((r) => [r.id, r]));
    const removeRuleIds = [];
    const addRules = [];
    for (const [id, rule] of have) if (!want.has(id) || !sameRule(want.get(id), rule)) removeRuleIds.push(id);
    for (const [id, rule] of want) if (!have.has(id) || !sameRule(rule, have.get(id))) addRules.push(rule);
    return { removeRuleIds: removeRuleIds.sort((a, b) => a - b), addRules };
  }

  const dnr = () => AP.api.declarativeNetRequest;

  async function applyDesired(desired) {
    const { removeRuleIds, addRules } = diffRules(desired, await dnr().getDynamicRules());
    if (removeRuleIds.length === 0 && addRules.length === 0) return { added: 0, removed: 0 };
    await dnr().updateDynamicRules({ removeRuleIds, addRules });
    return { added: addRules.length, removed: removeRuleIds.length };
  }

  /**
   * Makes the dynamic rules equal to computeRules(). A rule the browser refuses (a bad regex from a
   * redirect catalog, say) must never take the pause and block rules down with it: on failure the
   * core rules are applied alone, then the redirect rules one by one, and the bad one is skipped.
   * @returns {Promise<{ added: number, removed: number, skipped?: number[] }>}
   */
  function syncRules() {
    return bg.store.queue('rules', async () => {
      if (!dnr()?.updateDynamicRules) return { added: 0, removed: 0 };
      const [settings, state] = await Promise.all([AP.settings.effective(), bg.store.readState()]);
      const desired = computeRules(settings, state, bg.clock.now(), {
        pauseUrl: AP.api.runtime.getURL(PAGES.pause),
        blockedUrl: AP.api.runtime.getURL(PAGES.blocked),
        ytRedirects: AP.yt?.redirects,
      });
      try {
        return await applyDesired(desired);
      } catch (err) {
        AP.warn('updating the DNR rules failed; retrying without the YouTube redirect rules', err);
      }
      const core = desired.filter((r) => r.id < RANGES.redirect);
      const result = await applyDesired(core);
      const skipped = [];
      let current = core;
      for (const rule of desired.filter((r) => r.id >= RANGES.redirect)) {
        try {
          await applyDesired([...current, rule]);
          current = [...current, rule];
        } catch (err) {
          skipped.push(rule.id);
          AP.warn(`DNR rule ${rule.id} was refused and is skipped`, err);
        }
      }
      return { ...result, skipped };
    });
  }

  bg.rules = { RANGES, PRIORITY, PAGES, YOUTUBE_REGEX, siteRegex, escapeRegex, computeRules, diffRules, syncRules };
})();
