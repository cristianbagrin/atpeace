// Popup: every setting, from the toolbar, over the page it changes. Three tabs:
//   This page   the sections that matter on the page in the active tab
//   All         every YouTube section as a collapsible group, with a search
//   Focus       blocks, Mindful Pause, schedules, the daily limit, today
// The header (master switch), the tabs and the footer (preset, "Hide an element", Settings) stay in
// place; the body scrolls. Settings are written the moment they change, through the lock guard, and
// the YouTube tab follows without a reload. Everything that can be shown from storage is shown from
// storage, so it appears at once; GET_STATUS from the background then adds what only it knows.
import { buildSettingsView } from './settings-view.js';
import { buildFocusView } from './focus-view.js';
import { buildPresetBar } from './presets-bar.js';

const AP = globalThis.AtPeace;
const { h } = AP.ui;
const T = AP.msg.TYPES;

performance.mark('ap-popup-start');

const TABS = [
  { id: 'page', label: 'This page' },
  { id: 'all', label: 'All' },
  { id: 'focus', label: 'Focus' },
];
const PREFS_KEY = 'at-peace-popup';
const ADVANCED_KEY = 'at-peace-show-advanced'; // the same flag as the settings page

/** Page-storage preferences (the last tab per page type, which groups were open). Never needed. */
const prefs = {
  read() {
    try {
      const parsed = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  },
  write(patch) {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ ...prefs.read(), ...patch }));
    } catch {
      /* a convenience only */
    }
  },
  tab(pageKey) {
    const id = prefs.read().tabs?.[pageKey];
    return TABS.some((t) => t.id === id) ? id : null;
  },
  setTab(pageKey, id) {
    prefs.write({ tabs: { ...prefs.read().tabs, [pageKey]: id } });
  },
  openGroups(viewKey) {
    const list = prefs.read().open?.[viewKey];
    return Array.isArray(list) ? list.filter((id) => typeof id === 'string') : null;
  },
  setOpenGroups(viewKey, ids) {
    prefs.write({ open: { ...prefs.read().open, [viewKey]: ids } });
  },
};

const state = {
  /** Stored settings over the defaults. */
  values: {},
  customPresets: [],
  /** GET_STATUS-shaped data. */
  status: AP.ui.statusFromStorage(AP.state.normalizeState(null), {}),
  /** The settings lock (AP.lock.read()). */
  lock: { mode: 'none', locked: false, unlockedUntil: 0, waitSeconds: 60 },
  showAdvanced: false,
  /** The page in the active tab: { onYouTube, page }. */
  tab: { onYouTube: false, page: null },
};

const els = {};
/** @type {Map<string, Set<{ def: object|null, set: (value: any) => void, setEnabled: (enabled: boolean, hint?: string) => void }>>} */
const rowsById = new Map();
const views = {};
let currentTab = 'page';
let shortcuts = null;
const advancedListeners = [];

// ---------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------

const readValues = async () => AP.settings.merge(await AP.settings.load());

/** Every row that shows a setting, so a change made elsewhere reaches all of them. */
function track(row) {
  if (!row.def) return;
  if (!rowsById.has(row.def.id)) rowsById.set(row.def.id, new Set());
  rowsById.get(row.def.id).add(row);
}

/** Greys out what waits for another setting (the breath waits for the pause switch). */
function refreshRequires() {
  for (const set of rowsById.values()) {
    for (const row of set) {
      if (!row.def.requires) continue;
      const { enabled, needs, wants } = AP.ui.requiresState(row.def, state.values);
      row.setEnabled(enabled, enabled ? '' : AP.ui.requiresHint(needs, wants));
    }
  }
}

/** The settings lock refused a change: put the controls back and say so, in the lock bar. */
function refuse() {
  for (const [id, set] of rowsById) for (const row of set) row.set(state.values[id]);
  els.masterControl?.set(state.values[AP.schema.MASTER_ID]);
  els.lockBar.say('Locked.');
}

async function saveSetting(def, value) {
  const result = await AP.lock.save({ [def.id]: value });
  if (!result.ok) {
    refuse();
    return;
  }
  if (result.report.invalid.includes(def.id)) throw new Error('Not allowed.');
  state.values[def.id] = AP.schema.validateValue(def, value);
  afterValuesChanged();
}

function afterValuesChanged() {
  const off = state.values[AP.schema.MASTER_ID] === false;
  document.body.dataset.master = off ? 'off' : 'on'; // dims the settings while everything is switched off
  els.masterState.textContent = off ? 'Off' : 'On';
  refreshRequires();
  for (const view of Object.values(views)) view.refresh?.();
  presetBar.refresh();
}

async function resync() {
  const next = await readValues();
  const changed = AP.settings.diffIds(state.values, next);
  state.values = next;
  state.customPresets = await AP.settings.listCustomPresets();
  for (const id of changed) {
    if (id === AP.schema.MASTER_ID) els.masterControl.set(next[id]);
    for (const row of rowsById.get(id) ?? []) row.set(next[id]);
  }
  if (changed.includes('general.theme')) AP.ui.applyTheme(next['general.theme']);
  afterValuesChanged();
  views.focus?.render(); // friction settings may have changed
}

function setShowAdvanced(on) {
  state.showAdvanced = on;
  try {
    localStorage.setItem(ADVANCED_KEY, on ? '1' : '0');
  } catch {
    /* a convenience only */
  }
  for (const view of Object.values(views)) view.applyFilter?.();
  for (const listener of advancedListeners) listener(on);
}

// ---------------------------------------------------------------------------------------------
// Messages, the settings page, shortcuts
// ---------------------------------------------------------------------------------------------

/** Sends a message; a failure that is not "nobody is listening" becomes an `{ ok: false }` answer. */
async function send(type, payload) {
  try {
    return await AP.msg.send(type, payload);
  } catch (err) {
    AP.warn(`${type} failed`, err);
    return { ok: false, error: 'failed' };
  }
}

/** Opens the settings page at a row or section; the popup gets out of the way. */
async function openSettings(target) {
  try {
    await AP.ui.openSettings(target);
  } catch (err) {
    AP.warn('could not open the settings', err);
    return;
  }
  window.close();
}

/** Puts the keyboard shortcut of a command in a button's tooltip, once it is known. */
function shortcutTitle(button, command, label) {
  button.title = label;
  shortcuts?.then((s) => {
    const text = s.text(command);
    if (text) button.title = `${label} (${text})`;
  });
}

// ---------------------------------------------------------------------------------------------
// The settings lock: a quiet bar, and the unlock steps inline (a popup closes when it loses focus,
// so no dialog here)
// ---------------------------------------------------------------------------------------------

let inlineUnlock = null;

function closeInlineUnlock() {
  inlineUnlock?.destroy();
  inlineUnlock = null;
  els.unlockHost.replaceChildren();
  els.unlockHost.hidden = true;
}

function showInlineUnlock() {
  if (inlineUnlock || !state.lock.locked) return;
  inlineUnlock = AP.ui.unlockForm(state.lock, {
    onDone: () => {
      closeInlineUnlock();
      AP.ui.toast('Unlocked');
    },
    onCancel: closeInlineUnlock,
  });
  els.unlockHost.replaceChildren(inlineUnlock.body, h('div', { class: 'friction-actions' }, inlineUnlock.actions));
  els.unlockHost.hidden = false;
  inlineUnlock.focus();
}

/** Says why something is refused and opens the unlock steps. */
function askToUnlock(message) {
  els.lockBar.say(message);
  showInlineUnlock();
}

// ---------------------------------------------------------------------------------------------
// Status (the focus block, today)
// ---------------------------------------------------------------------------------------------

async function statusFromStorage() {
  const [stored, stats] = await Promise.all([AP.state.getState(), AP.state.getStats()]);
  return AP.ui.statusFromStorage(stored, stats);
}

/** Storage first (instant), then the background's richer answer when it comes. */
async function refreshStatus({ askBackground = true } = {}) {
  const redraw = () => {
    views.focus?.render();
    views.focus?.renderToday();
  };
  try {
    const fromStorage = await statusFromStorage();
    // Keep what only the background reports until it answers again.
    state.status = { ...fromStorage, limit: state.status.limit ?? null, activeSchedules: state.status.activeSchedules ?? [] };
    redraw();
  } catch (err) {
    AP.warn('could not read the focus state', err);
  }
  if (!askBackground) return;
  const res = await send(T.GET_STATUS);
  if (res?.ok) {
    state.status = { ...state.status, ...res, today: res.today ?? state.status.today };
    redraw();
  }
}

// ---------------------------------------------------------------------------------------------
// The context the views are built with
// ---------------------------------------------------------------------------------------------

const ctx = {
  state,
  els,
  prefs,
  track,
  refreshRequires,
  save: saveSetting,
  send,
  askToUnlock,
  openSettings,
  refreshStatus,
  resync,
  shortcutTitle,
  setShowAdvanced,
  onShowAdvanced: (listener) => advancedListeners.push(listener),
};

let presetBar = { refresh() {}, el: null };

// ---------------------------------------------------------------------------------------------
// Header, tabs, footer
// ---------------------------------------------------------------------------------------------

function buildMaster() {
  const def = AP.schema.get(AP.schema.MASTER_ID);
  els.masterControl = AP.ui.settingControl(def, state.values[def.id], (v) => saveSetting(def, v), { id: 'master-switch' });
  els.masterControl.el.classList.add('is-master');
  els.masterControl.el.setAttribute('aria-label', def.label);
  els.masterState = h('span', { class: 'master-state', 'aria-hidden': 'true' });
  els.master.append(els.masterState, els.masterControl.el);
  shortcutTitle(els.masterControl.el, 'toggle-enabled', 'Turn At Peace on or off');
}

/** Rows of the YouTube sections the registry holds, as the groups of a view. */
const groupSpec = (section) => ({ id: section.id, title: section.title, counted: true, defs: AP.schema.bySection(section.id) });

function allGroups() {
  const sections = AP.schema.sections({ site: 'youtube' }).filter((s) => s.site === 'youtube' && AP.schema.bySection(s.id).length > 0);
  // General: the look of At Peace itself, what was picked by hand, the lock, the backup. The master switch lives in the header.
  const general = [...AP.schema.bySection('general'), ...AP.schema.bySection('advanced')].filter((def) => def.id !== AP.schema.MASTER_ID);
  return [...sections.map(groupSpec), { id: 'general', title: 'General', counted: false, defs: general, extra: [{ label: 'Backup & reset', target: { section: 'backup' } }] }];
}

function pageGroups() {
  return AP.ui.pageSections(state.tab.page).map(groupSpec);
}

function viewFor(id) {
  if (views[id]) return views[id];
  if (id === 'focus') {
    views.focus = buildFocusView(ctx);
  } else if (id === 'all') {
    views.all = buildSettingsView(ctx, { key: 'all', groups: allGroups(), search: true, advancedSwitch: true });
  } else if (state.tab.onYouTube) {
    views.page = buildSettingsView(ctx, { key: `page:${state.tab.page}`, groups: pageGroups() });
  } else {
    // Not on YouTube: one line, and everything below it.
    const all = viewFor('all');
    views.page = { el: h('div', { class: 'view' }, h('p', { class: 'note view-note' }, 'Open YouTube to see its settings.'), all.el), refresh: () => {}, applyFilter: () => {} };
  }
  return views[id];
}

function selectTab(id, { focus = false, remember = true } = {}) {
  currentTab = id;
  for (const button of els.tabs.querySelectorAll('[role="tab"]')) {
    const selected = button.dataset.tab === id;
    button.setAttribute('aria-selected', selected ? 'true' : 'false');
    button.tabIndex = selected ? 0 : -1;
    if (selected && focus) button.focus();
  }
  const view = viewFor(id);
  els.content.setAttribute('aria-labelledby', `tab-${id}`);
  els.content.replaceChildren(view.el);
  els.body.scrollTop = 0;
  if (id === 'focus') {
    view.render();
    view.renderToday();
  }
  if (remember) prefs.setTab(pageKey(), id);
}

const pageKey = () => (state.tab.onYouTube ? (state.tab.page ?? 'other') : 'none');

function buildTabs() {
  els.tabs.replaceChildren(
    ...TABS.map(({ id, label }) =>
      h('button', { type: 'button', role: 'tab', class: 'tab', id: `tab-${id}`, 'aria-selected': 'false', 'aria-controls': 'content', tabindex: '-1', dataset: { tab: id }, onClick: () => selectTab(id) }, label),
    ),
  );
  els.tabs.addEventListener('keydown', (event) => {
    const at = TABS.findIndex((t) => t.id === currentTab);
    const to = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: TABS.length - 1 }[event.key];
    if (to === undefined) return;
    event.preventDefault();
    selectTab(TABS[(to + TABS.length) % TABS.length].id, { focus: true });
  });
}

function buildFooter() {
  presetBar = buildPresetBar(ctx);
  els.footNote = h('p', { class: 'note', role: 'status' });
  const hide = h(
    'button',
    {
      type: 'button',
      class: 'btn btn-quiet',
      onClick: async () => {
        const res = await send(T.START_PICKER);
        if (res?.ok) window.close();
        else {
          // No picker in the active tab: it is not a YouTube page, or the picker is not available yet.
          els.footNote.textContent = 'Open a YouTube page first.';
          setTimeout(() => (els.footNote.textContent = ''), 3000);
        }
      },
    },
    'Hide an element',
  );
  shortcutTitle(hide, 'open-picker', 'Hide an element');
  const settings = h(
    'button',
    {
      type: 'button',
      class: 'btn btn-quiet',
      onClick: async () => {
        try {
          await AP.ui.openSettings();
        } catch (err) {
          AP.warn('could not open the settings', err);
          return;
        }
        window.close();
      },
    },
    'Settings',
  );
  els.foot.append(presetBar.el, hide, settings);
  els.foot.after(els.footNote);
}

// ---------------------------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------------------------

/** The page in the active tab. Anything that goes wrong means "not on YouTube". */
async function readActiveTab() {
  try {
    const [tab] = await AP.api.tabs.query({ active: true, currentWindow: true });
    return AP.ui.youTubeTab(tab?.url);
  } catch {
    return { onYouTube: false, page: null };
  }
}

async function init() {
  els.master = document.getElementById('master');
  els.tabs = document.getElementById('tabs');
  els.body = document.getElementById('body');
  els.content = document.getElementById('content');
  els.sheet = document.getElementById('sheet');
  els.foot = document.getElementById('foot');

  const [values, customPresets, status, lock, tab] = await Promise.all([
    readValues(),
    AP.settings.listCustomPresets(),
    statusFromStorage().catch(() => state.status),
    AP.lock.read().catch(() => state.lock),
    readActiveTab(),
  ]);
  state.values = values;
  state.customPresets = customPresets;
  state.status = status;
  state.lock = lock;
  state.tab = tab;
  try {
    state.showAdvanced = localStorage.getItem(ADVANCED_KEY) === '1';
  } catch {
    /* default: off */
  }
  AP.ui.applyTheme(values['general.theme']);
  shortcuts = AP.ui.loadShortcuts().catch(() => null);

  buildMaster();
  els.lockBar = AP.ui.lockBar({ compact: true, onUnlock: showInlineUnlock });
  els.unlockHost = h('div', { class: 'unlock-inline', hidden: true });
  els.lockBar.update(state.lock);
  document.getElementById('banner').append(els.lockBar.el, els.unlockHost);
  buildTabs();
  buildFooter();
  afterValuesChanged();
  // The last tab used on this kind of page; "This page" the first time (off YouTube it would only repeat All).
  selectTab(prefs.tab(pageKey()) ?? (tab.onYouTube ? 'page' : 'all'), { remember: false });
  els.content.removeAttribute('aria-busy');
  performance.mark('ap-popup-ready');
  performance.measure('ap-popup-render', 'ap-popup-start', 'ap-popup-ready');

  // Later, off the critical path.
  document.getElementById('banner').append(AP.ui.hostAccessBanner());
  AP.lock.watch((next) => {
    state.lock = next;
    els.lockBar.update(next);
    if (!next.locked) closeInlineUnlock();
    views.focus?.render();
  });
  AP.settings.subscribe(() => resync().catch((err) => AP.warn('popup sync failed', err)));
  const refresh = AP.util.debounce(() => refreshStatus(), 250);
  AP.api.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && ('state' in changes || 'stats' in changes)) refresh();
  });
  refreshStatus();
}

init().catch((err) => {
  AP.warn('popup failed to start', err);
  document.getElementById('content').replaceChildren(h('p', { class: 'note' }, 'Could not start. Close this and open it again.'));
});
