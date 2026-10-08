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

  // ---------------------------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------------------------

  /** The Mac modifier glyphs, in the order macOS writes them: ⌃ ⌥ ⇧ ⌘. */
  const MAC_MODIFIERS = Object.freeze([
    { glyph: '⌃', names: ['macctrl', 'control'] },
    { glyph: '⌥', names: ['alt', 'option'] },
    { glyph: '⇧', names: ['shift'] },
    // In a manifest "Ctrl" is the Command key on a Mac (Firefox and Chrome alike).
    { glyph: '⌘', names: ['command', 'cmd', 'ctrl'] },
  ]);
  /** Elsewhere: Ctrl, Alt, Shift. */
  const PLAIN_MODIFIERS = Object.freeze([
    { label: 'Ctrl', names: ['ctrl', 'control', 'command', 'cmd', 'macctrl'] },
    { label: 'Alt', names: ['alt', 'option'] },
    { label: 'Shift', names: ['shift'] },
  ]);
  const KEY_NAMES = Object.freeze({ comma: ',', period: '.' });
  const MAC_KEY_NAMES = Object.freeze({ up: '↑', down: '↓', left: '←', right: '→' });
  const MAC_GLYPH_RE = /[⌃⌥⇧⌘]/;

  /**
   * The parts of a shortcut as the person should read them: on a Mac the modifier glyphs in macOS
   * order and then the key (["⌥", "⇧", "P"]); elsewhere the words (["Alt", "Shift", "P"]). A shortcut
   * already written with Mac glyphs is split as it is. Empty or unusable input gives [].
   * @param {unknown} shortcut a manifest / commands.getAll() string such as "Alt+Shift+P"
   * @param {string} [os] runtime.getPlatformInfo().os; only 'mac' changes anything
   * @returns {string[]}
   */
  function shortcutKeys(shortcut, os) {
    const text = typeof shortcut === 'string' ? shortcut.trim() : '';
    if (text === '') return [];
    const mac = os === 'mac';
    if (MAC_GLYPH_RE.test(text) && !text.includes('+')) return [...text];
    const parts = text.split('+').map((p) => p.trim()).filter(Boolean);
    if (parts.length === 0) return [];
    const key = parts.at(-1);
    const mods = parts.slice(0, -1).map((m) => m.toLowerCase());
    const keyText = KEY_NAMES[key.toLowerCase()] ?? (mac ? MAC_KEY_NAMES[key.toLowerCase()] : undefined) ?? (key.length === 1 ? key.toUpperCase() : key);
    if (mac) return [...MAC_MODIFIERS.filter((m) => m.names.some((n) => mods.includes(n))).map((m) => m.glyph), keyText];
    return [...PLAIN_MODIFIERS.filter((m) => m.names.some((n) => mods.includes(n))).map((m) => m.label), keyText];
  }

  /**
   * A shortcut for display: "⌥⇧P" on a Mac, "Alt+Shift+P" elsewhere.
   * @param {unknown} shortcut
   * @param {string} [os] runtime.getPlatformInfo().os
   * @returns {string}
   */
  function formatShortcut(shortcut, os) {
    const text = typeof shortcut === 'string' ? shortcut.trim() : '';
    if (MAC_GLYPH_RE.test(text) && !text.includes('+')) return text; // already written the Mac way
    return shortcutKeys(shortcut, os).join(os === 'mac' ? '' : '+');
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
  // The popup: what to show for the page in the active tab, and how to search it
  // ---------------------------------------------------------------------------------------

  /** Hosts At Peace works on (the same as AP.yt.page.detect knows). */
  const YOUTUBE_HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);

  /**
   * Is this tab on YouTube, and which kind of page is it? `page` is an AP.yt.page.TYPES value
   * ('watch', 'home'…) or null off YouTube. An unreadable or missing address counts as off YouTube.
   * @param {unknown} url
   * @returns {{ onYouTube: boolean, page: string|null }}
   */
  function youTubeTab(url) {
    let host;
    try {
      host = new URL(String(url)).hostname;
    } catch {
      return { onYouTube: false, page: null };
    }
    if (!YOUTUBE_HOSTS.has(host)) return { onYouTube: false, page: null };
    return { onYouTube: true, page: AP.yt?.page?.detect?.(String(url)) ?? 'other' };
  }

  /** Sections of the popup's "This page" tab, per page type: the page's own first, then what applies on it. */
  const PAGE_SECTIONS = Object.freeze({
    watch: ['yt.watch', 'yt.player', 'yt.comments', 'yt.general'],
    home: ['yt.home', 'yt.general', 'yt.masthead', 'yt.guide'],
    search: ['yt.search', 'yt.general', 'yt.masthead'],
    shorts: ['yt.shorts', 'yt.comments'],
    channel: ['yt.channel', 'yt.general'],
    subscriptions: ['yt.subs', 'yt.general'],
  });
  /** Playlists, history, hashtags, "You" and anything else. */
  const OTHER_PAGE_SECTIONS = Object.freeze(['yt.general', 'yt.masthead', 'yt.guide']);

  /**
   * The YouTube sections that matter on a page type, in the order the popup shows them. Ids the
   * registry does not hold (a section that was renamed or removed) are left out.
   * @param {string|null|undefined} page an AP.yt.page.TYPES value
   * @param {{ id: string }[]} [sections] defaults to the registry's sections that have settings
   * @returns {{ id: string }[]}
   */
  function pageSections(page, sections = AP.schema.sections().filter((s) => AP.schema.bySection(s.id).length > 0)) {
    const wanted = PAGE_SECTIONS[page] ?? OTHER_PAGE_SECTIONS;
    return wanted.map((id) => sections.find((s) => s.id === id)).filter(Boolean);
  }

  /** Does the popup edit this setting in the row itself (a switch, a choice, a number)? Everything else opens the settings page. */
  const isInlineSetting = (def) => def.type === 'toggle' || def.type === 'select' || def.type === 'number';

  /** Settings of a section grouped by `group`, in order of first appearance: `[{ name, defs }]`. */
  function clusterGroups(defs) {
    const groups = new Map();
    for (const def of defs) {
      const name = def.group ?? '';
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(def);
    }
    return [...groups].map(([name, list]) => ({ name, defs: list }));
  }

  /**
   * Does a setting match what was typed in the popup's search? Every word has to appear in its label,
   * its group's name or its section's title (the headings the person sees); an empty query matches all.
   * @param {import('../../shared/schema-core.js').SettingDef} def
   * @param {string} query
   * @param {{ title?: string }} [section]
   */
  function popupMatches(def, query, section) {
    const tokens = queryTokens(query);
    if (tokens.length === 0) return true;
    const text = fold([def.label, def.group, section?.title].filter(Boolean).join(' '));
    return tokens.every((token) => text.includes(token));
  }

  /**
   * The settings of each section that match a search, for the popup's All tab: sections with no
   * match are left out. `showAdvanced` false hides advanced settings unless a search is on (a
   * search finds everything).
   * @param {{ section: { id: string, title: string }, defs: object[] }[]} groups
   * @param {string} query
   * @param {{ showAdvanced?: boolean }} [options]
   * @returns {{ section: object, defs: object[] }[]}
   */
  function filterPopupGroups(groups, query, { showAdvanced = false } = {}) {
    const searching = queryTokens(query).length > 0;
    return groups
      .map(({ section, defs }) => ({ section, defs: defs.filter((def) => (searching ? popupMatches(def, query, section) : showAdvanced || !def.advanced)) }))
      .filter(({ defs }) => defs.length > 0);
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

  /**
   * The custom preset to offer "Update" for: the one applied or saved last (`lastId`) while the
   * settings have since been changed so that they match no preset at all. Null otherwise.
   * @param {Record<string, any>} values effective values
   * @param {{ id: string, values: Record<string, any> }[]} builtIn
   * @param {{ id: string, values: Record<string, any> }[]} custom
   * @param {string|null} lastId
   * @returns {{ id: string, name: string }|null}
   */
  function presetToUpdate(values, builtIn, custom, lastId) {
    const preset = lastId ? custom.find((p) => p.id === lastId) : undefined;
    if (!preset) return null;
    return matchingPresetId(values, [...builtIn, ...custom]) === null ? preset : null;
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

  // ---------------------------------------------------------------------------------------
  // The dial (pause page, blocked page, welcome): sixty ticks on a 320-unit square
  // ---------------------------------------------------------------------------------------

  const DIAL_CENTER = 160;

  /** One path of 60 ticks, one per minute; every fifth is longer. */
  function dialTicksPath() {
    let d = '';
    for (let i = 0; i < 60; i++) {
      const angle = ((i * 6 - 90) * Math.PI) / 180;
      const inner = i % 5 === 0 ? 140 : 147;
      const [x1, y1] = [DIAL_CENTER + inner * Math.cos(angle), DIAL_CENTER + inner * Math.sin(angle)];
      const [x2, y2] = [DIAL_CENTER + 154 * Math.cos(angle), DIAL_CENTER + 154 * Math.sin(angle)];
      d += `M${x1.toFixed(1)} ${y1.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}`;
    }
    return d;
  }

  /**
   * The amber arc of a block: the fraction of it that is left, drawn clockwise from twelve o'clock.
   * Returns '' when nothing is left. A (nearly) full arc is clamped so the path never degenerates.
   * @param {number} fraction 0..1
   * @returns {string}
   */
  function dialArcPath(fraction) {
    const left = Math.min(0.999, Number.isFinite(fraction) ? fraction : 0);
    if (left <= 0.004) return '';
    const r = 124;
    const end = (left * 360 - 90) * (Math.PI / 180);
    const [x, y] = [DIAL_CENTER + r * Math.cos(end), DIAL_CENTER + r * Math.sin(end)];
    return `M${DIAL_CENTER} ${DIAL_CENTER - r} A${r} ${r} 0 ${left > 0.5 ? 1 : 0} 1 ${x.toFixed(1)} ${y.toFixed(1)}`;
  }

  /**
   * How much of a block is left. `total` is the block's length as first seen; a block that was
   * extended after that (remaining > total) counts as full.
   * @param {number} total ms
   * @param {number} remaining ms
   * @returns {number} 0..1
   */
  function blockFraction(total, remaining) {
    if (!(total > 0) || !(remaining > 0)) return 0;
    return Math.min(1, remaining / total);
  }

  // ---------------------------------------------------------------------------------------
  // Options navigation: how much is "on" in each section
  // ---------------------------------------------------------------------------------------

  /** Settings that hide or change something on a page: switches, choices and word lists. Numbers, free text and "where does it apply" checkboxes only tune. */
  const isCounted = (def) => def.type === 'toggle' || def.type === 'select' || isStringList(def);

  /**
   * Per section of YouTube settings: how many of its settings are doing something (isHidingValue
   * over the stored values) out of how many there are. Mindful Pause reports its own on/off switch.
   * Other sections have no count.
   * @param {Record<string, any>} values stored settings merged over the defaults
   * @param {{ id: string, site?: string }[]} [sections]
   * @returns {Record<string, { on: number, total: number, text: string }>}
   */
  function navCounts(values, sections = AP.schema.sections()) {
    const out = {};
    for (const section of sections) {
      if (section.site === 'youtube') {
        const defs = AP.schema.bySection(section.id).filter(isCounted);
        const on = defs.filter((d) => AP.schema.isHidingValue(d, values?.[d.id])).length;
        out[section.id] = { on, total: defs.length, text: String(on) };
      } else if (section.id === 'pause') {
        const on = values?.['pause.enabled'] === true;
        out[section.id] = { on: on ? 1 : 0, total: 1, text: on ? 'On' : '' };
      }
    }
    return out;
  }

  Object.assign(ui, {
    FOCUS_PHRASE,
    formatDuration,
    formatClock,
    formatTimeOfDay,
    shortcutKeys,
    formatShortcut,
    requiresState,
    requiresHint,
    isStringList,
    youTubeTab,
    pageSections,
    isInlineSetting,
    clusterGroups,
    popupMatches,
    filterPopupGroups,
    fold,
    queryTokens,
    matchesQuery,
    checkWordLine,
    parseLines,
    numberCheck,
    matchingPresetId,
    presetToUpdate,
    weekStats,
    statusFromStorage,
    formatImportReport,
    phraseMatches,
    dialTicksPath,
    dialArcPath,
    blockFraction,
    navCounts,
  });
})();
