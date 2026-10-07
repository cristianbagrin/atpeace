// Options page. Everything on it is generated from the settings registry (AP.schema): sections
// from AP.schema.sections(), one row per setting inside grouped panels, bulk pills from the tags.
// Values are saved the moment they change; nothing here knows a setting id apart from general.theme.
import { buildRow, slug } from './rows.js';
import { buildWeek } from './week.js';
import { buildBackup } from './backup.js';
import { buildPresets } from './presets-section.js';

const AP = globalThis.AtPeace;
const { h } = AP.ui;

const ADVANCED_KEY = 'at-peace-show-advanced';

/** The navigation's groups, in order; a section lands in the first group that claims it. */
const NAV_GROUPS = [
  { id: 'top', label: null, claims: (s) => s.id === 'general' || s.id === 'presets' },
  { id: 'youtube', label: 'YouTube', claims: (s) => s.site === 'youtube' },
  { id: 'calm', label: 'Calm', claims: (s) => ['pause', 'focus', 'week'].includes(s.id) },
  { id: 'more', label: 'More', claims: () => true },
];

/** Sections that are not settings, placed by `order` between the registry's own. */
const EXTRA_SECTIONS = [
  { id: 'presets', title: 'Presets', order: 20 },
  { id: 'week', title: 'Your week', order: 920 },
  { id: 'backup', title: 'Backup & reset', order: 1000 },
];

const state = {
  /** Stored settings merged over the defaults (what the person set, not a schedule's override). */
  values: {},
  /** @type {Map<string, import('./rows.js').Row>} */
  rows: new Map(),
  /** @type {{ id: string, title: string, el: HTMLElement, toc: HTMLElement, link: HTMLElement, count: HTMLElement, headCount: HTMLElement, section?: object, groups?: {el: HTMLElement, rows: object[]}[] }[]} */
  entries: [],
  /** @type {{ el: HTMLElement, entries: object[] }[]} */
  tocGroups: [],
  query: '',
  showAdvanced: false,
  customPresets: [],
  /** @type {Map<string, {button: HTMLElement, tag: string, label: string}>} */
  chips: new Map(),
  /** @type {{ refresh: () => Promise<void> }|null} */
  week: null,
  /** @type {{ el: HTMLElement, refresh: (values: object, custom: object[]) => void }|null} */
  presets: null,
  /** Name of the preset the settings match right now (null: a mix of one's own). */
  presetName: null,
  /** The settings lock as AP.lock.watch() last reported it. */
  lock: { mode: 'none', locked: false, unlockedUntil: 0, waitSeconds: 60 },
};

const els = {};

const reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

// ---------------------------------------------------------------------------------------------
// Storage plumbing
// ---------------------------------------------------------------------------------------------

async function readValues() {
  return AP.settings.merge(await AP.settings.load());
}

let savedTimer = null;
function flashSaved() {
  els.saved.classList.add('is-visible');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => els.saved.classList.remove('is-visible'), 1800);
}

/**
 * Stores one value for a row. Rejects with a readable message when the schema refuses it, and with
 * `code: 'locked'` when the settings lock holds and the change would show something again (the
 * row then puts the old value back and offers the unlock).
 */
async function saveSetting(def, value) {
  const result = await AP.lock.save({ [def.id]: value });
  if (!result.ok) throw Object.assign(new Error(AP.ui.lockedMessage), { code: 'locked' });
  const { report } = result;
  if (report.invalid.includes(def.id)) throw new Error('Not allowed.');
  state.values[def.id] = AP.schema.validateValue(def, value);
  afterValuesChanged([def.id]);
  if (report.changed.length > 0) flashSaved();
}

/** Everything derived from the values: switched-off rows, pill states, counts, theme, preset name. */
function afterValuesChanged(changedIds) {
  refreshRequires();
  refreshChips();
  refreshCounts();
  state.presets?.refresh(state.values, state.customPresets);
  if (changedIds.includes('general.theme')) AP.ui.applyTheme(state.values['general.theme']);
}

function refreshRequires() {
  // Several rows in a row waiting for the same setting say why once, not each time.
  let lastNeeds = null;
  for (const row of state.rows.values()) {
    if (!row.def.requires) {
      lastNeeds = null;
      continue;
    }
    const { enabled, needs, wants } = AP.ui.requiresState(row.def, state.values);
    row.setEnabled(enabled, needs, { showHint: !enabled && needs?.id !== lastNeeds, wants });
    lastNeeds = enabled ? null : (needs?.id ?? null);
  }
}

/** Another context (popup, other tab, a preset) changed storage. */
async function resync(info) {
  const next = await readValues();
  const changed = AP.settings.diffIds(state.values, next);
  state.values = next;
  for (const id of changed) state.rows.get(id)?.set(next[id]);
  if (info.keys.includes('customPresets')) state.customPresets = await AP.settings.listCustomPresets();
  afterValuesChanged(changed); // also redraws the presets
  if (info.keys.includes('state')) refreshNotices();
}

// ---------------------------------------------------------------------------------------------
// Sections and rows
// ---------------------------------------------------------------------------------------------

function buildSettingsSection(section) {
  const defs = AP.schema.bySection(section.id);
  const groups = AP.ui.clusterGroups(defs).map(({ name, defs: list }) => {
    const rows = list.map((def) => {
      const row = buildRow(def, state.values[def.id], saveSetting, { onUnlock: () => AP.ui.requestUnlock() });
      state.rows.set(def.id, row);
      return row;
    });
    // A group named like its section ("Comments" in Comments) would only repeat the heading.
    const titled = name !== '' && name.toLowerCase() !== section.title.toLowerCase();
    const el = h('div', { class: 'group' }, titled && h('h3', { class: 'group-title caps' }, name), h('div', { class: 'panel' }, rows.map((r) => r.el)));
    return { el, rows };
  });
  return { groups, body: groups.map((g) => g.el) };
}

function buildSections() {
  const withSettings = AP.schema.sections().filter((s) => AP.schema.bySection(s.id).length > 0);
  const entries = [...withSettings, ...EXTRA_SECTIONS].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  const week = buildWeek();
  const backup = buildBackup();
  const presets = buildPresets({
    onCurrentName: (name) => {
      state.presetName = name;
      refreshPresetLabel();
    },
  });
  state.week = week;
  state.presets = presets;

  for (const section of entries) {
    const domId = `sec-${slug(section.id)}`;
    let built = null;
    let body;
    if (section.id === 'week') body = week.el;
    else if (section.id === 'backup') body = backup.el;
    else if (section.id === 'presets') body = presets.el;
    else {
      built = buildSettingsSection(section);
      body = built.body;
    }

    const headCount = h('span', { class: 'section-count mono' });
    const el = h(
      'section',
      { class: 'section', id: domId, 'aria-labelledby': `${domId}-title`, dataset: { section: section.id } },
      h('header', { class: 'section-head' }, h('h2', { id: `${domId}-title` }, section.title), headCount),
      body,
    );

    const count = h('span', { class: 'toc-count mono' });
    const link = h('a', { href: `#section=${section.id}`, onClick: (event) => { event.preventDefault(); goToSection(section.id); } }, h('span', { class: 'toc-title' }, section.title), count);
    const toc = h('li', null, link);
    state.entries.push({ id: section.id, title: section.title, el, toc, link, count, headCount, section, groups: built?.groups });
  }

  // The navigation: General on its own, then labelled groups (YouTube / Calm / More).
  const claimed = new Set();
  state.tocGroups = NAV_GROUPS.map((group, index) => {
    const mine = state.entries.filter((e) => !claimed.has(e.id) && group.claims(e.section));
    for (const e of mine) claimed.add(e.id);
    const labelId = `toc-group-${group.id}`;
    const el = h(
      'div',
      { class: 'toc-group' },
      group.label && h('p', { class: 'toc-label caps', id: labelId }, group.label),
      h('ol', { 'aria-labelledby': group.label ? labelId : null }, mine.map((e) => e.toc)),
    );
    return { el, entries: mine, index };
  }).filter((g) => g.entries.length > 0);

  els.sections.replaceChildren(...state.entries.map((e) => e.el));
  els.toc.replaceChildren(...state.tocGroups.map((g) => g.el));
}

/** "3" beside each YouTube section in the navigation and "3 of 35 hidden" in its heading. */
function refreshCounts() {
  const counts = AP.ui.navCounts(state.values);
  for (const entry of state.entries) {
    const c = counts[entry.id];
    entry.count.textContent = c?.text ?? '';
    entry.headCount.hidden = !c;
    if (!c) continue;
    entry.headCount.textContent = entry.section.site === 'youtube' ? `${c.on} of ${c.total} hidden` : c.on > 0 ? 'On' : 'Off';
  }
}

// ---------------------------------------------------------------------------------------------
// Search and "Show advanced"
// ---------------------------------------------------------------------------------------------

function applyFilters() {
  const query = state.query.trim();
  const searching = AP.ui.queryTokens(query).length > 0;
  let matches = 0;

  for (const entry of state.entries) {
    let any = false;
    if (entry.groups) {
      for (const group of entry.groups) {
        let groupAny = false;
        for (const row of group.rows) {
          const show = searching ? AP.ui.matchesQuery(row.def, entry.section, query) : !row.def.advanced || state.showAdvanced;
          row.setHidden(!show);
          row.showAdvancedTag(searching && show && row.def.advanced === true);
          if (show) groupAny = true;
          if (show && searching) matches++;
        }
        group.el.hidden = !groupAny;
        any ||= groupAny;
      }
    } else {
      any = !searching; // Presets, "Your week" and "Backup" are not searchable
    }
    entry.el.hidden = !any;
    entry.toc.hidden = !any;
  }

  for (const group of state.tocGroups) group.el.hidden = group.entries.every((e) => e.toc.hidden);

  els.results.hidden = !searching;
  if (searching) {
    els.results.textContent =
      matches === 0 ? `Nothing matches “${query}”.` : matches === 1 ? '1 match' : `${matches} matches`;
  }
  els.searchKey.hidden = searching;
  document.body.classList.toggle('is-searching', searching);
  updateCurrentSection();
}

function setQuery(query) {
  const wasSearching = state.query.trim() !== '';
  state.query = query;
  if (els.search.value !== query) els.search.value = query;
  applyFilters();
  if (!wasSearching && query.trim() !== '') window.scrollTo(0, 0); // results start at the top
}

function setShowAdvanced(on, { remember = true } = {}) {
  state.showAdvanced = on;
  els.advanced.checked = on;
  if (remember) {
    try {
      localStorage.setItem(ADVANCED_KEY, on ? '1' : '0');
    } catch {
      /* a convenience only */
    }
  }
  applyFilters();
}

// ---------------------------------------------------------------------------------------------
// Top bar
// ---------------------------------------------------------------------------------------------

function buildTopbar() {
  els.search = h('input', {
    type: 'search',
    id: 'search',
    placeholder: 'Search settings',
    'aria-label': 'Search settings',
    autocomplete: 'off',
    spellcheck: false,
  });
  els.search.addEventListener('input', () => setQuery(els.search.value));
  els.searchKey = h('kbd', { class: 'search-key', 'aria-hidden': 'true' }, '/');

  els.presetsBtn = h('button', { type: 'button', class: 'btn', onClick: () => goToSection('presets') }, 'Presets');
  els.presetName = h('span', { class: 'preset-now' });
  els.presetsBtn.append(els.presetName);

  els.advanced = h('input', { type: 'checkbox', role: 'switch', class: 'switch', id: 'show-advanced' });
  els.advanced.addEventListener('change', () => setShowAdvanced(els.advanced.checked));

  els.saved = h('span', { class: 'saved', role: 'status', 'aria-live': 'polite' }, 'Saved');

  const chips = AP.ui.BULK_TAGS.filter(([tag]) => Object.keys(AP.schema.bulkTargets(tag)).length > 0).map(([tag, label]) => {
    const button = h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', onClick: () => toggleBulk(tag, label) }, label);
    state.chips.set(tag, { button, tag, label });
    return button;
  });

  els.topbar.prepend(
    h(
      'div',
      { class: 'topbar-row' },
      h('div', { class: 'search' }, els.search, els.searchKey),
      els.presetsBtn,
      h('label', { class: 'adv-toggle', for: 'show-advanced' }, els.advanced, 'Show advanced'),
      els.saved,
    ),
    chips.length > 0 && h('div', { class: 'topbar-row chips', role: 'group', 'aria-label': 'Hide a whole kind of thing at once' }, h('span', { class: 'caps' }, 'Hide all'), chips),
  );
}

function refreshChips() {
  for (const { button, tag, label } of state.chips.values()) {
    const { state: s, on, total } = AP.ui.bulkState(tag, state.values);
    button.dataset.state = s;
    button.setAttribute('aria-pressed', s === 'all' ? 'true' : s === 'partly' ? 'mixed' : 'false');
    button.title = s === 'all' ? `All ${total} are on. Click to turn them off.` : `${on} of ${total} are on. Click to turn them all on.`;
    button.setAttribute('aria-label', `${label}: ${s === 'all' ? 'all on' : s === 'partly' ? `${on} of ${total} on` : 'off'}`);
  }
}

async function toggleBulk(tag, label) {
  try {
    await applyBulk(tag, label);
  } catch (err) {
    AP.warn('bulk change failed', err);
    AP.ui.toast('Could not save.');
  }
}

async function applyBulk(tag, label) {
  const patch = AP.ui.bulkPatch(tag, state.values);
  let result = await AP.lock.save(patch);
  // Switching a whole kind off shows things again: ask for the unlock, then do it.
  if (!result.ok && (await AP.ui.requestUnlock())) result = await AP.lock.save(patch);
  if (!result.ok) {
    AP.ui.toast('Locked.');
    return;
  }
  const { report } = result;
  for (const id of report.changed) {
    state.values[id] = patch[id];
    state.rows.get(id)?.set(patch[id]);
  }
  afterValuesChanged(report.changed);
  if (report.changed.length > 0) flashSaved();
  AP.ui.toast(`${label}: ${AP.ui.bulkState(tag, state.values).state === 'all' ? 'all on' : 'all off'}`);
}

function refreshPresetLabel() {
  els.presetName.textContent = state.presetName ? ` · ${state.presetName}` : '';
  if (state.presets) {
    const entry = state.entries.find((e) => e.id === 'presets');
    if (entry) {
      entry.headCount.hidden = !state.presetName;
      entry.headCount.textContent = state.presetName ?? '';
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Notices (host access, schedule override)
// ---------------------------------------------------------------------------------------------

async function refreshNotices() {
  let override = null;
  try {
    override = (await AP.state.getState()).scheduleOverride;
  } catch {
    /* no notice */
  }
  const preset = override ? AP.presets.get(override, state.customPresets) : null;
  els.scheduleNote.hidden = !override;
  if (override) {
    els.scheduleNote.textContent = `A schedule is applying ${preset ? `“${preset.name}”` : 'a preset'}. These are your own settings.`;
  }
}

// ---------------------------------------------------------------------------------------------
// Navigation: table of contents, deep links, keyboard
// ---------------------------------------------------------------------------------------------

function topOffset() {
  return els.topbar.getBoundingClientRect().height + 14;
}

let currentId = null;
function setCurrent(id) {
  if (id === currentId) return;
  currentId = id;
  for (const entry of state.entries) {
    if (entry.id === id) entry.link.setAttribute('aria-current', 'location');
    else entry.link.removeAttribute('aria-current');
  }
}

/** The section whose top has passed just under the sticky bar is the one being read. */
function updateCurrentSection() {
  const line = topOffset() + 21;
  let found = null;
  for (const entry of state.entries) {
    if (entry.el.hidden) continue;
    if (entry.el.getBoundingClientRect().top <= line) found = entry;
    else break;
  }
  const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4;
  if (atBottom) found = [...state.entries].reverse().find((e) => !e.el.hidden) ?? found;
  setCurrent((found ?? state.entries.find((e) => !e.el.hidden))?.id ?? null);
}

function scrollTo(el, smooth) {
  el.scrollIntoView({ behavior: smooth && !reducedMotion() ? 'smooth' : 'auto', block: 'start' });
}

function goToSection(id, { updateHash = true, smooth = true } = {}) {
  const entry = state.entries.find((e) => e.id === id);
  if (!entry) return;
  if (state.query) setQuery('');
  if (updateHash) history.replaceState(null, '', `#section=${id}`);
  setCurrent(id);
  scrollTo(entry.el, smooth);
}

function goToSetting(id, { smooth = true } = {}) {
  const row = state.rows.get(id);
  if (!row) return;
  if (state.query) setQuery('');
  if (row.def.advanced && !state.showAdvanced) setShowAdvanced(true, { remember: false });
  scrollTo(row.el, smooth);
  row.highlight();
}

/** A deep link on page load jumps straight there; one followed while the page is open scrolls. */
function handleHash({ smooth = true } = {}) {
  const params = new URLSearchParams(location.hash.slice(1));
  if (params.has('setting')) goToSetting(params.get('setting'), { smooth });
  else if (params.has('section')) goToSection(params.get('section'), { updateHash: false, smooth });
}

function installKeyboard() {
  document.addEventListener('keydown', (event) => {
    const typing = event.target instanceof HTMLElement && event.target.matches('input, textarea, select, [contenteditable]');
    if (event.key === '/' && !typing && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault();
      els.search.focus();
      els.search.select();
    } else if (event.key === 'Escape' && (state.query || document.activeElement === els.search) && !document.querySelector('dialog[open]')) {
      setQuery('');
      if (document.activeElement === els.search) els.search.blur();
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------------------------

function buildAbout() {
  els.about.replaceChildren(
    h('p', { class: 'about-version mono' }, `Version ${AP.api.runtime.getManifest().version}`),
  );
}

async function init() {
  els.toc = document.getElementById('toc');
  els.about = document.getElementById('about');
  els.topbar = document.getElementById('topbar');
  els.sections = document.getElementById('sections');
  els.results = document.getElementById('results-note');

  const [values, customPresets] = await Promise.all([readValues(), AP.settings.listCustomPresets()]);
  state.values = values;
  state.customPresets = customPresets;
  AP.ui.applyTheme(values['general.theme']);

  buildTopbar();
  els.scheduleNote = h('p', { class: 'banner', hidden: true });
  els.lockBar = AP.ui.lockBar();
  document.getElementById('notices').append(els.lockBar.el, AP.ui.hostAccessBanner(), els.scheduleNote);
  buildSections();
  buildAbout();

  refreshRequires();
  refreshChips();
  refreshCounts();
  state.presets.refresh(state.values, state.customPresets);
  refreshNotices();

  let remembered = false;
  try {
    remembered = localStorage.getItem(ADVANCED_KEY) === '1';
  } catch {
    /* default: off */
  }
  setShowAdvanced(remembered, { remember: false });

  document.documentElement.style.setProperty('--topbar-h', `${Math.ceil(els.topbar.getBoundingClientRect().height)}px`);
  new ResizeObserver(() => document.documentElement.style.setProperty('--topbar-h', `${Math.ceil(els.topbar.getBoundingClientRect().height)}px`)).observe(els.topbar);

  AP.settings.subscribe((_effective, _changed, info) => resync(info).catch((err) => AP.warn('options sync failed', err)));
  // The lock: the quiet bar at the top, and the "Locked" notes on rows go away when it opens.
  AP.lock.watch((status) => {
    state.lock = status;
    els.lockBar.update(status);
    if (!status.locked) for (const row of state.rows.values()) row.clearLocked();
  });
  AP.api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && 'stats' in changes) state.week.refresh();
  });

  window.addEventListener('scroll', AP.util.rafThrottle(updateCurrentSection), { passive: true });
  window.addEventListener('resize', AP.util.rafThrottle(updateCurrentSection));
  window.addEventListener('hashchange', () => handleHash());
  installKeyboard();

  handleHash({ smooth: false });
  updateCurrentSection();
  document.body.dataset.ready = 'true';
  performance.mark('ap-options-ready');
}

init().catch((err) => {
  AP.warn('options page failed to start', err);
  document.getElementById('sections').replaceChildren(h('p', { class: 'empty' }, 'Could not load settings.'));
});
