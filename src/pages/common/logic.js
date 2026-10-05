// Pure helpers behind the popup and options pages. No DOM, no storage, no extension API, so they
// can be unit-tested in Node (tests/unit/ui-logic.test.mjs). The DOM half lives in components.js;
// both attach to AP.ui. Needs util.js and schema-core.js (and presets/state for two helpers).
(() => {
  'use strict';
  const AP = globalThis.AtPeace;
  const ui = (AP.ui ??= {});
  const { isPlainObject, deepEqual } = AP.util;

  // ---------------------------------------------------------------------------------------
  // Time
  // ---------------------------------------------------------------------------------------

  /**
   * "0 min", "<1 min", "42 min", "1 h", "2 h 05 min": calm, rounded to the minute.
   * @param {number} sec
   * @returns {string}
   */
  function formatDuration(sec) {
    const s = Math.max(0, Number.isFinite(sec) ? sec : 0);
    if (s === 0) return '0 min';
    if (s < 30) return '<1 min';
    const minutes = Math.max(1, Math.round(s / 60));
    if (minutes < 60) return `${minutes} min`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, '0')} min`;
  }

  /**
   * Countdown text: "04:09", or "1:02:09" from one hour up. Rounds up so it never shows 00:00
   * while time is left.
   * @param {number} sec
   * @returns {string}
   */
  function formatClock(sec) {
    const total = Math.max(0, Math.ceil(Number.isFinite(sec) ? sec : 0));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const two = (n) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${two(m)}:${two(s)}` : `${two(m)}:${two(s)}`;
  }

  /** "14:30" in the user's own clock format. */
  function formatTimeOfDay(ms) {
    return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // ---------------------------------------------------------------------------------------
  // Bulk actions (Shorts, Recommendations, …)
  // ---------------------------------------------------------------------------------------

  /** Chips shown in the options toolbar and the popup, in order: [tag, label]. */
  const BULK_TAGS = Object.freeze([
    ['shorts', 'Shorts'],
    ['recommendations', 'Recommendations'],
    ['comments', 'Comments'],
    ['ai', 'AI'],
    ['metrics', 'Metrics'],
    ['ads', 'Ads'],
    ['clutter', 'Clutter'],
  ]);

  /**
   * How much of a tag is "on" in `values`: a toggle is on when true, a select when it holds the
   * tag's bulk ("most hidden") value.
   * @param {string} tag
   * @param {Record<string, any>} values
   * @returns {{ state: 'all'|'partly'|'none'|'empty', on: number, total: number }}
   */
  function bulkState(tag, values) {
    const targets = AP.schema.bulkTargets(tag);
    const ids = Object.keys(targets);
    if (ids.length === 0) return { state: 'empty', on: 0, total: 0 };
    const on = ids.filter((id) => deepEqual(values?.[id], targets[id])).length;
    return { state: on === ids.length ? 'all' : on === 0 ? 'none' : 'partly', on, total: ids.length };
  }

  /**
   * The settings patch a click on a bulk chip makes: everything on, unless everything already
   * is, in which case everything goes back off (toggles false, selects their default).
   * @param {string} tag
   * @param {Record<string, any>} values
   * @returns {Record<string, boolean|string>}
   */
  function bulkPatch(tag, values) {
    const targets = AP.schema.bulkTargets(tag);
    if (bulkState(tag, values).state !== 'all') return targets;
    const off = {};
    for (const id of Object.keys(targets)) off[id] = AP.schema.get(id).type === 'toggle' ? false : AP.schema.get(id).default;
    return off;
  }

  // ---------------------------------------------------------------------------------------
  // Rows
  // ---------------------------------------------------------------------------------------

  /**
   * Is a row usable? A setting with `requires` is only meaningful while the setting it names is
   * on ('id'), holds a value ('id=value') or holds anything else ('id!=value'); that one may require
   * another in turn, so the chain is followed. When a value is wanted, `wants` carries the parsed
   * condition so the hint can name it.
   * @param {import('../../shared/schema-core.js').SettingDef} def
   * @param {Record<string, any>} values
   * @returns {{ enabled: boolean, needs: import('../../shared/schema-core.js').SettingDef|null, wants?: { op: string, value: string|null } }}
   */
  function requiresState(def, values, seen = new Set()) {
    if (!def.requires || seen.has(def.id)) return { enabled: true, needs: null };
    seen.add(def.id);
    const cond = AP.schema.parseRequires(def.requires);
    const dep = cond ? AP.schema.get(cond.id) : undefined;
    if (!dep) return { enabled: true, needs: null };
    const upstream = requiresState(dep, values, seen);
    if (!upstream.enabled) return { enabled: false, needs: upstream.needs ?? dep, ...(upstream.wants ? { wants: upstream.wants } : {}) };
    if (AP.schema.requiresMet(cond, dep, values?.[dep.id])) return { enabled: true, needs: null };
    return cond.op === 'truthy' ? { enabled: false, needs: dep } : { enabled: false, needs: dep, wants: cond };
  }

  /**
   * Why a row is switched off, in one calm sentence.
   * @param {import('../../shared/schema-core.js').SettingDef|null} needs the setting it waits for
   * @param {{ op: string, value: string|null }} [wants] the value it waits for (from requiresState)
   */
  function requiresHint(needs, wants) {
    if (!needs) return '';
    if (wants && wants.op !== 'truthy') {
      const shown = needs.type === 'select' ? (needs.options?.find((o) => o.value === wants.value)?.label ?? wants.value) : wants.value;
      if (needs.type === 'toggle') return (wants.op === '=') === (wants.value === 'true') ? `Turn on “${needs.label}” to use this.` : `Turn off “${needs.label}” to use this.`;
      return wants.op === '=' ? `Applies when “${needs.label}” is set to “${shown}”.` : `Applies once you change “${needs.label}” from “${shown}”.`;
    }
    if (needs.type === 'toggle') return `Turn on “${needs.label}” to use this.`;
    if (needs.type === 'select') return `Applies once you change “${needs.label}”.`;
    return `Applies once “${needs.label}” is set.`;
  }

  /** A list of plain strings (word list), as opposed to objects or a multi-select. */
  const isStringList = (def) => def.type === 'list' && !def.options && typeof def.item !== 'function';

  /**
   * Settings the popup offers as quick toggles: `quick: true` minus the master switch (it has its
   * own place), ordered by section and then by registration order.
   * @returns {import('../../shared/schema-core.js').SettingDef[]}
   */
  function quickSettings() {
    const order = new Map(AP.schema.sections().map((s, i) => [s.id, i]));
    return AP.schema
      .all()
      .map((def, index) => ({ def, index }))
      .filter(({ def }) => def.quick === true && def.id !== AP.schema.MASTER_ID)
      .sort((a, b) => (order.get(a.def.section) ?? 999) - (order.get(b.def.section) ?? 999) || a.index - b.index)
      .map(({ def }) => def);
  }

  // ---------------------------------------------------------------------------------------
  // Search
  // ---------------------------------------------------------------------------------------

  /** Lower-case, accents removed: "Épisodes" matches "episodes". */
  const fold = (text) =>
    String(text ?? '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase();

  const haystacks = new WeakMap();

  function haystack(def, section) {
    let text = haystacks.get(def);
    if (text === undefined) {
      text = fold([def.label, def.description, def.group, def.tags?.join(' '), def.id, section?.title].filter(Boolean).join(' '));
      haystacks.set(def, text);
    }
    return text;
  }

  /** Words of a search query (folded). */
  const queryTokens = (query) => fold(query).split(/\s+/).filter(Boolean);

  /**
   * Does `def` match the query? Every word must appear somewhere in label, description, group,
   * tags, id or the section title. An empty query matches everything.
   * @param {import('../../shared/schema-core.js').SettingDef} def
   * @param {{ title?: string }|undefined} section
   * @param {string} query
   */
  function matchesQuery(def, section, query) {
    const tokens = queryTokens(query);
    if (tokens.length === 0) return true;
    const text = haystack(def, section);
    return tokens.every((token) => text.includes(token));
  }

  // ---------------------------------------------------------------------------------------
  // Word lists (one entry per line, /regex/flags allowed)
  // ---------------------------------------------------------------------------------------

  const MAX_LINE = 500;
  const REGEX_LINE = /^\/(.+)\/([a-z]*)$/s;

  /**
   * Error message for one entry, or null. Entries that start and end with a slash (plus flags)
   * are regular expressions and must compile; anything else is plain text.
   * @param {string} line already trimmed
   * @returns {string|null}
   */
  function checkWordLine(line) {
    if (line.length > MAX_LINE) return `Too long (${MAX_LINE} characters at most).`;
    const m = REGEX_LINE.exec(line);
    if (!m) return null;
    try {
      new RegExp(m[1], m[2]);
    } catch (err) {
      return `Not a valid regular expression: ${String(err?.message ?? err).replace(/^Invalid regular expression:?\s*/i, '')}`;
    }
    return null;
  }

  /**
   * Splits a one-per-line editor's text into entries (trimmed, blanks skipped, repeats dropped).
   * With `regex`, every entry is also checked and problems come back with their line number.
   * @param {string} text
   * @param {{ regex?: boolean }} [options]
   * @returns {{ items: string[], errors: { line: number, message: string }[] }}
   */
  function parseLines(text, { regex = false } = {}) {
    const items = [];
    const errors = [];
    String(text ?? '')
      .split(/\r?\n/)
      .forEach((raw, index) => {
        const line = raw.trim();
        if (line === '') return;
        if (regex) {
          const message = checkWordLine(line);
          if (message) errors.push({ line: index + 1, message });
        }
        if (!items.includes(line)) items.push(line);
      });
    return { items, errors };
  }

  // ---------------------------------------------------------------------------------------
  // Numbers
  // ---------------------------------------------------------------------------------------

  /**
   * Checks what was typed into a number field against the setting's bounds.
   * @param {{ min?: number, max?: number }} def
   * @param {string|number} raw
   * @returns {{ ok: true, value: number } | { ok: false, message: string }}
   */
  function numberCheck(def, raw) {
    const text = String(raw ?? '').trim();
    const n = Number(text);
    if (text === '' || !Number.isFinite(n)) return { ok: false, message: 'Enter a number.' };
    const { min, max } = def;
    if (Number.isFinite(min) && Number.isFinite(max) && (n < min || n > max)) return { ok: false, message: `Choose a number from ${min} to ${max}.` };
    if (Number.isFinite(min) && n < min) return { ok: false, message: `Choose ${min} or more.` };
    if (Number.isFinite(max) && n > max) return { ok: false, message: `Choose ${max} or less.` };
    return { ok: true, value: n };
  }

  // ---------------------------------------------------------------------------------------
  // Presets
  // ---------------------------------------------------------------------------------------

  /**
   * The preset whose values equal what is set now (for the settings presets touch), or null.
   * @param {Record<string, any>} values effective values
   * @param {{ id: string, values: Record<string, any> }[]} presets
   * @returns {string|null}
   */
  function matchingPresetId(values, presets) {
    const scoped = AP.schema.all().filter((def) => AP.presets.inScope(def));
    for (const preset of presets) {
      const same = scoped.every((def) => {
        const want = Object.hasOwn(preset.values, def.id) ? preset.values[def.id] : def.default;
        return deepEqual(values?.[def.id], want);
      });
      if (same) return preset.id;
    }
    return null;
  }

  // ---------------------------------------------------------------------------------------
  // Usage numbers
  // ---------------------------------------------------------------------------------------

  /**
   * The last `days` calendar days (today last) of one site's usage, with totals. Missing days are
   * zeros. `stats` is the raw or normalized `stats` map.
   * @param {unknown} stats
   * @param {string} [siteKey]
   * @param {number|Date} [now]
   * @param {number} [days]
   */
  function weekStats(stats, siteKey = 'youtube', now = Date.now(), days = 7) {
    const all = AP.state.normalizeStats(stats);
    const today = new Date(now);
    const list = [];
    for (let back = days - 1; back >= 0; back--) {
      // Calendar arithmetic on the local date, so a DST change cannot repeat or skip a day.
      const date = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
      const key = AP.util.dayKey(date);
      const c = all[key]?.[siteKey] ?? AP.state.emptyCounters();
      list.push({
        day: key,
        weekday: date.getDay(),
        label: back === 0 ? 'Today' : WEEKDAYS[date.getDay()],
        isToday: back === 0,
        activeSec: c.activeSec,
        opens: c.opens,
        turnedBack: c.turnedBack,
      });
    }
    const totals = list.reduce(
      (t, d) => ({ activeSec: t.activeSec + d.activeSec, opens: t.opens + d.opens, turnedBack: t.turnedBack + d.turnedBack }),
      { activeSec: 0, opens: 0, turnedBack: 0 },
    );
    return {
      days: list,
      totals,
      maxActiveSec: Math.max(0, ...list.map((d) => d.activeSec)),
      hasData: list.some((d) => d.activeSec > 0 || d.opens > 0 || d.turnedBack > 0),
    };
  }

  /**
   * GET_STATUS-shaped data built from storage alone, for when the background does not answer.
   * @param {ReturnType<typeof AP.state.normalizeState>} state
   * @param {ReturnType<typeof AP.state.normalizeStats>} stats
   * @param {number} [now]
   */
  function statusFromStorage(state, stats, now = Date.now()) {
    const block = state.block && state.block.until > now ? state.block : null;
    const sessions = {};
    for (const [key, until] of Object.entries(state.sessions)) if (until > now) sessions[key] = until;
    return {
      ok: true,
      block,
      sessions,
      scheduleOverride: state.scheduleOverride,
      activeSchedules: [],
      today: stats[AP.util.dayKey(now)] ?? {},
      limit: null,
    };
  }

  // ---------------------------------------------------------------------------------------
  // Import report
  // ---------------------------------------------------------------------------------------

  const KEY_PREVIEW = 4;

  const keyList = (keys) => {
    const shown = keys.slice(0, KEY_PREVIEW).join(', ');
    return keys.length > KEY_PREVIEW ? `${shown} and ${keys.length - KEY_PREVIEW} more` : shown;
  };

  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  /** Groups `[{key, reason}]` by reason: `{ reason, keys[] }[]`. */
  function groupByReason(items) {
    const groups = new Map();
    for (const { key, reason } of items) {
      if (!groups.has(reason)) groups.set(reason, []);
      groups.get(reason).push(key);
    }
    return [...groups].map(([reason, keys]) => ({ reason, keys }));
  }

  /**
   * Plain-language summary of an AP.settings.importAll() report.
   * @param {object} report
   * @returns {{ tone: 'ok'|'warn'|'error', headline: string, lines: string[] }}
   */
  function formatImportReport(report) {
    if (!isPlainObject(report)) return { tone: 'error', headline: 'Nothing was imported.', lines: [] };
    if (!report.ok) {
      const why =
        {
          'invalid-json': 'That file is not valid JSON.',
          'too-large': 'That file is too large to be a settings backup.',
          'not-an-export': 'That file is not an At Peace backup.',
        }[report.error] ?? 'The file could not be read.';
      return { tone: 'error', headline: 'Nothing was imported.', lines: [why] };
    }
    const lines = [];
    const p = report.presets ?? {};
    if (p.added || p.replaced) {
      const parts = [];
      if (p.added) parts.push(`${p.added} added`);
      if (p.replaced) parts.push(`${p.replaced} replaced`);
      lines.push(`Presets: ${parts.join(', ')}.`);
    }
    if (Array.isArray(p.dropped) && p.dropped.length > 0) lines.push(`${plural(p.dropped.length, 'preset')} skipped: ${keyList(p.dropped)}.`);
    for (const { reason, keys } of groupByReason(report.dropped ?? [])) lines.push(`${plural(keys.length, 'setting')} skipped (${reason}): ${keyList(keys)}.`);
    for (const { reason, keys } of groupByReason(report.invalid ?? [])) lines.push(`${plural(keys.length, 'setting')} kept as before (${reason}): ${keyList(keys)}.`);
    if (report.newerThanThisVersion) lines.push('This backup was made by a newer version of At Peace, so some settings may be missing here.');
    const clean = lines.length === 0 || lines.every((l) => l.startsWith('Presets:'));
    return {
      tone: clean ? 'ok' : 'warn',
      headline: `Imported ${plural(report.applied ?? 0, 'setting')}.`,
      lines,
    };
  }

  // ---------------------------------------------------------------------------------------
  // Ending a focus block early
  // ---------------------------------------------------------------------------------------

  /** The sentence typed to end a focus block when `focus.unlockFriction` is "phrase". */
  const FOCUS_PHRASE = 'I am choosing to end my focus session';

  /** Typed text equals the phrase, ignoring case, punctuation and extra spaces. */
  function phraseMatches(typed, phrase = FOCUS_PHRASE) {
    const norm = (s) =>
      fold(s)
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    return norm(typed) !== '' && norm(typed) === norm(phrase);
  }

  Object.assign(ui, {
    BULK_TAGS,
    FOCUS_PHRASE,
    formatDuration,
    formatClock,
    formatTimeOfDay,
    bulkState,
    bulkPatch,
    requiresState,
    requiresHint,
    isStringList,
    quickSettings,
    fold,
    queryTokens,
    matchesQuery,
    checkWordLine,
    parseLines,
    numberCheck,
    matchingPresetId,
    weekStats,
    statusFromStorage,
    formatImportReport,
    phraseMatches,
  });
})();
