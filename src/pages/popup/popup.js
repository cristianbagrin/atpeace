// Popup. Everything that can be shown from storage is shown from storage (settings, the focus
// block, today's numbers), so it appears at once; GET_STATUS from the background then adds what
// only it knows (schedules, the daily limit) and may fail without anything breaking.
const AP = globalThis.AtPeace;
const { h } = AP.ui;
const T = AP.msg.TYPES;

performance.mark('ap-popup-start');

const SITE = 'youtube';
/** Bulk chips offered here (the rest live in the settings page). */
const POPUP_CHIPS = ['shorts', 'recommendations', 'comments'];
const FOCUS_CHOICES = [
  { label: '25 min', payload: { minutes: 25 } },
  { label: '1 h', payload: { minutes: 60 } },
  { label: '4 h', payload: { minutes: 240 } },
  { label: 'Rest of day', payload: { untilEndOfDay: true } },
];
const WAIT_SECONDS = 30;
const REASONS = { schedule: 'A scheduled block', limit: 'Daily limit reached' };

const state = {
  /** Stored settings over the defaults. */
  values: {},
  customPresets: [],
  /** GET_STATUS-shaped data. */
  status: AP.ui.statusFromStorage(AP.state.normalizeState(null), {}),
  /** Set while the person is on the way to ending a block early: { mode, startedAt }. */
  friction: null,
  focusNote: null,
  rows: new Map(),
  chips: new Map(),
  /** The settings lock (AP.lock.read()). */
  lock: { mode: 'none', locked: false, unlockedUntil: 0, waitSeconds: 60 },
};

const els = {};
let tickTimer = null;

// ---------------------------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------------------------

const readValues = async () => AP.settings.merge(await AP.settings.load());

/**
 * The settings lock refused a change that would show something again: put the control back and say
 * so, quietly, in the lock bar (which has the Unlock button).
 */
function refuseChange(message = 'Locked. That would show something again.') {
  for (const id of state.rows.keys()) state.rows.get(id).control.set(state.values[id]);
  els.masterControl?.set(state.values[AP.schema.MASTER_ID]);
  els.lockBar.say(message);
}

async function saveSetting(def, value) {
  const result = await AP.lock.save({ [def.id]: value });
  if (!result.ok) {
    refuseChange();
    return;
  }
  const { report } = result;
  if (report.invalid.includes(def.id)) throw new Error('That value is not allowed here.');
  state.values[def.id] = AP.schema.validateValue(def, value);
  afterValuesChanged();
}

function afterValuesChanged() {
  const off = state.values[AP.schema.MASTER_ID] === false;
  document.body.dataset.master = off ? 'off' : 'on'; // dims the quick settings while everything is switched off
  els.masterState.textContent = off ? 'Off' : 'On';
  for (const { def, control } of state.rows.values()) {
    const { enabled } = AP.ui.requiresState(def, state.values);
    control.setDisabled(!enabled);
  }
  refreshChips();
  refreshPresetSelect();
}

async function resync() {
  const next = await readValues();
  const changed = AP.settings.diffIds(state.values, next);
  state.values = next;
  state.customPresets = await AP.settings.listCustomPresets();
  for (const id of changed) {
    if (id === AP.schema.MASTER_ID) els.masterControl.set(next[id]);
    state.rows.get(id)?.control.set(next[id]);
  }
  if (changed.includes('general.theme')) AP.ui.applyTheme(next['general.theme']);
  afterValuesChanged();
  renderFocus(); // friction settings may have changed
}

// ---------------------------------------------------------------------------------------------
// Header, chips, quick rows, preset
// ---------------------------------------------------------------------------------------------

function buildMaster() {
  const def = AP.schema.get(AP.schema.MASTER_ID);
  els.masterControl = AP.ui.settingControl(def, state.values[def.id], (v) => saveSetting(def, v), { id: 'master-switch' });
  els.masterControl.el.classList.add('is-master');
  els.masterControl.el.setAttribute('aria-label', def.label);
  els.masterState = h('span', { class: 'master-state', 'aria-hidden': 'true' });
  els.master.append(els.masterState, els.masterControl.el);
}

function buildChips() {
  const chips = AP.ui.BULK_TAGS.filter(([tag]) => POPUP_CHIPS.includes(tag) && Object.keys(AP.schema.bulkTargets(tag)).length > 0).map(([tag, label]) => {
    const button = h('button', { type: 'button', class: 'chip', 'aria-pressed': 'false', onClick: () => toggleBulk(tag) }, label);
    state.chips.set(tag, { button, label });
    return button;
  });
  return chips.length > 0 ? h('div', { class: 'chips', role: 'group', 'aria-label': 'Hide a whole kind of thing at once' }, chips) : null;
}

function refreshChips() {
  for (const [tag, { button, label }] of state.chips) {
    const { state: s, on, total } = AP.ui.bulkState(tag, state.values);
    button.dataset.state = s;
    button.setAttribute('aria-pressed', s === 'all' ? 'true' : s === 'partly' ? 'mixed' : 'false');
    button.setAttribute('aria-label', `${label}: ${s === 'all' ? 'all on' : s === 'partly' ? `${on} of ${total} on` : 'off'}`);
    button.title = s === 'all' ? 'Click to turn them all off' : 'Click to turn them all on';
  }
}

async function toggleBulk(tag) {
  try {
    const patch = AP.ui.bulkPatch(tag, state.values);
    const result = await AP.lock.save(patch);
    if (!result.ok) {
      refuseChange('Locked. Turning these off needs an unlock first.');
      return;
    }
    const { report } = result;
    for (const id of report.changed) {
      state.values[id] = patch[id];
      state.rows.get(id)?.control.set(patch[id]);
    }
    afterValuesChanged();
  } catch (err) {
    AP.warn('bulk change failed', err);
    AP.ui.toast('That could not be saved.');
  }
}

function buildQuickRow(def) {
  const id = `q-${def.id.replace(/[^A-Za-z0-9_-]/g, '-')}`;
  const control = AP.ui.settingControl(def, state.values[def.id], (v) => saveSetting(def, v), { id, shortLabels: true });
  const row = h('div', { class: ['row', def.type === 'toggle' && 'is-toggle'], dataset: { id: def.id } }, h('label', { class: 'row-label', for: id, title: def.description }, def.label), control.el);
  state.rows.set(def.id, { def, control });
  return row;
}

// The preset menu. Choosing one asks first, in the page, because it replaces a lot at once.
function buildPresetRow() {
  els.presetSelect = h('select', { id: 'preset-select', 'aria-label': 'Preset' });
  els.presetSelect.addEventListener('change', onPresetChosen);
  els.presetConfirm = h('div', { class: 'confirm-bar', role: 'group', 'aria-label': 'Apply preset', hidden: true });
  return [
    h('div', { class: 'row' }, h('label', { class: 'row-label', for: 'preset-select' }, 'Preset'), h('span', { class: 'select' }, els.presetSelect)),
    els.presetConfirm,
  ];
}

const allPresets = () => [...AP.presets.builtIn(), ...state.customPresets];

function refreshPresetSelect() {
  if (els.presetConfirm && !els.presetConfirm.hidden) return; // do not pull the menu away from a pending choice
  const presets = allPresets();
  const current = AP.ui.matchingPresetId(state.values, presets);
  els.presetSelect.replaceChildren(
    h('option', { value: '', disabled: true }, 'Your own mix'),
    ...presets.map((p) => h('option', { value: p.id }, p.name)),
  );
  els.presetSelect.value = current ?? '';
  els.presetSelect.dataset.current = current ?? '';
}

function onPresetChosen() {
  const id = els.presetSelect.value;
  const preset = allPresets().find((p) => p.id === id);
  if (!preset) return;
  const cancel = () => {
    els.presetConfirm.hidden = true;
    els.presetConfirm.replaceChildren();
    refreshPresetSelect();
  };
  const apply = h(
    'button',
    {
      type: 'button',
      class: 'btn btn-primary',
      onClick: async () => {
        const result = await AP.lock.applyPreset(preset.id);
        els.presetConfirm.hidden = true;
        els.presetConfirm.replaceChildren();
        if (result.error === 'locked') els.lockBar.say('Locked. That preset would show something again.');
        else if (!result.ok) AP.ui.toast('That preset is no longer available.');
        await resync();
      },
    },
    'Apply',
  );
  els.presetConfirm.replaceChildren(
    h('p', { class: 'note' }, `Replace your YouTube settings with “${preset.name}”? Appearance, pause details and schedules stay.`),
    h('div', { class: 'friction-actions' }, apply, h('button', { type: 'button', class: 'btn btn-quiet', onClick: cancel }, 'Cancel')),
  );
  els.presetConfirm.hidden = false;
  apply.focus();
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
      AP.ui.toast('Unlocked for 10 minutes');
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

function buildLock() {
  els.lockBar = AP.ui.lockBar({ compact: true, onUnlock: showInlineUnlock });
  els.unlockHost = h('div', { class: 'unlock-inline', hidden: true });
  els.lockBar.update(state.lock);
  return [els.lockBar.el, els.unlockHost];
}

// ---------------------------------------------------------------------------------------------
// Focus
// ---------------------------------------------------------------------------------------------

const activeBlock = () => (state.status.block && state.status.block.until > Date.now() ? state.status.block : null);

/** Sends a message; a failure that is not "nobody is listening" becomes an `{ ok: false }` answer. */
async function send(type, payload) {
  try {
    return await AP.msg.send(type, payload);
  } catch (err) {
    AP.warn(`${type} failed`, err);
    return { ok: false, error: 'failed' };
  }
}

async function startFocus(payload) {
  state.focusNote = null;
  const res = await send(T.FOCUS_START, payload);
  if (res?.ok) {
    state.status = { ...state.status, block: res.block ?? state.status.block };
    await refreshStatus({ askBackground: false });
  } else {
    state.focusNote = 'The block could not be started. Try again in a moment.';
    renderFocus();
  }
}

async function sendEnd(payload) {
  const res = await send(T.FOCUS_END, payload);
  if (res?.ok) {
    state.friction = null;
    state.focusNote = null;
    state.status = { ...state.status, block: null };
    renderFocus();
    refreshStatus({ askBackground: false });
    return;
  }
  if (res?.error === 'strict') {
    state.friction = null;
    state.focusNote = 'This block cannot be ended early.';
  } else if (res?.error === 'locked') {
    state.friction = null;
    askToUnlock('Locked. Ending a block early needs an unlock first.');
  } else if (res?.error === 'friction-required') {
    const mode = state.values['focus.unlockFriction'];
    state.friction = { mode: mode === 'phrase' ? 'phrase' : 'wait', startedAt: Date.now() };
  } else {
    state.focusNote = 'The block could not be ended. Try again in a moment.';
  }
  renderFocus();
}

function endEarly() {
  state.focusNote = null;
  if (state.values['focus.strict'] === true) {
    state.focusNote = 'This block cannot be ended early.';
    renderFocus();
    return;
  }
  if (state.lock.locked) {
    askToUnlock('Locked. Ending a block early needs an unlock first.');
    return;
  }
  const mode = state.values['focus.unlockFriction'];
  if (mode === 'wait' || mode === 'phrase') {
    state.friction = { mode, startedAt: Date.now() };
    renderFocus();
    els.focus.querySelector('input, button.btn-primary, button')?.focus();
  } else {
    sendEnd({});
  }
}

function frictionView() {
  const cancel = h(
    'button',
    {
      type: 'button',
      class: 'btn btn-quiet',
      onClick: () => {
        state.friction = null;
        renderFocus();
      },
    },
    'Keep going',
  );
  const end = h('button', { type: 'button', class: 'btn', disabled: true, onClick: () => sendEnd({ frictionDone: true }) }, 'End block');
  end.dataset.role = 'end';
  const actions = h('div', { class: 'friction-actions' }, end, cancel);

  if (state.friction.mode === 'phrase') {
    const input = h('input', { type: 'text', id: 'phrase', autocomplete: 'off', spellcheck: false, 'aria-describedby': 'phrase-help' });
    input.addEventListener('input', () => {
      end.disabled = !AP.ui.phraseMatches(input.value);
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !end.disabled) end.click();
    });
    return h(
      'div',
      { class: 'friction' },
      h('label', { class: 'note', for: 'phrase', id: 'phrase-help' }, 'To end the block, type this sentence:'),
      h('p', { class: 'mono' }, AP.ui.FOCUS_PHRASE),
      input,
      actions,
    );
  }
  const note = h('p', { class: 'note', 'data-role': 'wait-note' });
  const view = h('div', { class: 'friction' }, note, actions);
  updateWait(note, end);
  return view;
}

/** Updates the wait countdown text and enables the End button when it is over. */
function updateWait(note, end) {
  const left = Math.max(0, WAIT_SECONDS - Math.floor((Date.now() - state.friction.startedAt) / 1000));
  note.textContent = left > 0 ? `Take a moment. You can end the block in ${left} s.` : 'You can end the block now.';
  end.disabled = left > 0;
}

function renderFocus() {
  const block = activeBlock();
  const children = [h('h2', { class: 'block-title' }, block ? 'Focus' : 'Block YouTube for')];

  if (!block) {
    state.friction = null;
    children.push(
      h(
        'div',
        { class: 'focus-buttons' },
        FOCUS_CHOICES.map((choice) => h('button', { type: 'button', class: 'btn', onClick: () => startFocus(choice.payload) }, choice.label)),
      ),
    );
    const schedule = state.status.activeSchedules?.[0];
    const line = state.focusNote ?? (schedule ? `${schedule.name ? `“${schedule.name}”` : 'A schedule'} is on until ${AP.ui.formatTimeOfDay(schedule.endsAt)}.` : null);
    if (line) children.push(h('p', { class: ['note', state.focusNote && 'is-error'] }, line));
  } else {
    children.push(
      h(
        'div',
        { class: 'count' },
        h('span', { class: 'count-clock mono', 'data-role': 'clock' }, AP.ui.formatClock((block.until - Date.now()) / 1000)),
        h('span', { class: 'count-until' }, `until ${AP.ui.formatTimeOfDay(block.until)}`),
      ),
    );
    if (block.reason && block.reason !== 'focus') children.push(h('p', { class: 'note' }, REASONS[block.reason] ?? 'Blocked'));
    if (state.friction) children.push(frictionView());
    else if (state.values['focus.strict'] === true) children.push(h('p', { class: 'note' }, 'No early exit: this block runs until the time is up.'));
    else {
      children.push(h('p', null, h('button', { type: 'button', class: 'btn btn-quiet', onClick: endEarly }, 'End early')));
      if (state.focusNote) children.push(h('p', { class: 'note is-error' }, state.focusNote));
    }
  }
  els.focus.replaceChildren(...children);
  ensureTick();
}

/** One timer for the countdown, the wait step and the end of the block. */
function ensureTick() {
  const needed = activeBlock() !== null;
  if (needed && tickTimer === null) tickTimer = setInterval(tick, 1000);
  if (!needed && tickTimer !== null) {
    clearInterval(tickTimer);
    tickTimer = null;
  }
}

function tick() {
  const block = activeBlock();
  if (!block) {
    renderFocus();
    return;
  }
  const clock = els.focus.querySelector('[data-role="clock"]');
  if (clock) clock.textContent = AP.ui.formatClock((block.until - Date.now()) / 1000);
  const note = els.focus.querySelector('[data-role="wait-note"]');
  const end = els.focus.querySelector('[data-role="end"]');
  if (state.friction?.mode === 'wait' && note && end) updateWait(note, end);
}

// ---------------------------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------------------------

function renderToday() {
  const c = state.status.today?.[SITE] ?? {};
  const activeSec = Number(c.activeSec) || 0;
  const opens = Number(c.opens) || 0;
  const turnedBack = Number(c.turnedBack) || 0;
  const limit = state.status.limit;
  const hasLimit = limit && Number(limit.dailyMinutes) > 0;
  els.today.hidden = !(activeSec > 0 || opens > 0 || turnedBack > 0 || hasLimit);
  if (els.today.hidden) return;

  const num = (value) => h('span', { class: 'mono' }, String(value));
  const tile = (value, label, positive = false) =>
    h('div', { class: 'stat' }, h('div', { class: ['stat-value', positive && 'is-positive'] }, value), h('div', { class: 'stat-label' }, label));
  els.today.replaceChildren(
    ...[
      // Three tiles for the eye; the sentence below is what a screen reader reads (and what tests look for).
      h('div', { class: 'stats', 'aria-hidden': 'true' }, tile(compactDuration(activeSec), 'on YouTube'), tile(String(opens), opens === 1 ? 'open' : 'opens'), tile(String(turnedBack), 'turned back', true)),
      h(
        'p',
        { class: 'today visually-hidden' },
        h('span', null, 'Today'),
        ' ',
        h('span', { class: 'mono' }, AP.ui.formatDuration(activeSec)),
        ' on YouTube, opened ',
        num(opens),
        opens === 1 ? ' time' : ' times',
        ', turned back ',
        num(turnedBack),
        turnedBack === 1 ? ' time.' : ' times.',
      ),
      hasLimit && h('p', { class: 'note' }, `Daily limit: ${Math.min(Math.round((Number(limit.usedSec) || 0) / 60), 9999)} of ${limit.dailyMinutes} min used.`),
    ].filter(Boolean),
  );
}

/** "25m", "1h 05m", "<1m": the short form for a tile. */
function compactDuration(sec) {
  const s = Math.max(0, Number(sec) || 0);
  if (s === 0) return '0m';
  if (s < 30) return '<1m';
  const minutes = Math.max(1, Math.round(s / 60));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${String(rest).padStart(2, '0')}m`;
}

// ---------------------------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------------------------

async function statusFromStorage() {
  const [stored, stats] = await Promise.all([AP.state.getState(), AP.state.getStats()]);
  return AP.ui.statusFromStorage(stored, stats);
}

/** Storage first (instant), then the background's richer answer when it comes. */
async function refreshStatus({ askBackground = true } = {}) {
  try {
    const fromStorage = await statusFromStorage();
    // Keep what only the background reports until it answers again.
    state.status = { ...fromStorage, limit: state.status.limit ?? null, activeSchedules: state.status.activeSchedules ?? [] };
    renderFocus();
    renderToday();
  } catch (err) {
    AP.warn('could not read the focus state', err);
  }
  if (!askBackground) return;
  const res = await send(T.GET_STATUS);
  if (res?.ok) {
    state.status = { ...state.status, ...res, today: res.today ?? state.status.today };
    renderFocus();
    renderToday();
  }
}

// ---------------------------------------------------------------------------------------------
// Footer
// ---------------------------------------------------------------------------------------------

function buildFooter() {
  els.footNote = h('p', { class: 'note', role: 'status' });
  els.foot.append(
    h(
      'button',
      {
        type: 'button',
        class: 'btn btn-quiet',
        onClick: async () => {
          const res = await send(T.START_PICKER);
          if (res?.ok) window.close();
          else {
            // No picker in the active tab: it is not a YouTube page, or the picker is not available yet.
            els.footNote.textContent = 'Open a YouTube page in this tab first, then try again.';
            setTimeout(() => (els.footNote.textContent = ''), 3000);
          }
        },
      },
      'Hide an element',
    ),
    h(
      'button',
      {
        type: 'button',
        class: 'btn btn-quiet',
        onClick: async () => {
          await AP.api.runtime.openOptionsPage();
          window.close();
        },
      },
      'All settings',
    ),
  );
  els.foot.after(els.footNote);
}

// ---------------------------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------------------------

async function init() {
  els.master = document.getElementById('master');
  els.content = document.getElementById('content');
  els.foot = document.getElementById('foot');

  const [values, customPresets, status, lock] = await Promise.all([
    readValues(),
    AP.settings.listCustomPresets(),
    statusFromStorage().catch(() => state.status),
    AP.lock.read().catch(() => state.lock),
  ]);
  state.values = values;
  state.customPresets = customPresets;
  state.status = status;
  state.lock = lock;
  AP.ui.applyTheme(values['general.theme']);

  buildMaster();
  document.getElementById('banner').append(...buildLock());
  els.focus = h('section', { class: 'block focus-block', 'aria-label': 'Focus' });
  els.today = h('section', { class: 'block today-block', 'aria-label': 'Today', hidden: true });
  els.content.replaceChildren(
    ...[buildChips(), h('div', { class: 'ledger' }, buildPresetRow(), AP.ui.quickSettings().map(buildQuickRow)), els.focus, els.today].filter(Boolean),
  );
  buildFooter();
  afterValuesChanged();
  renderFocus();
  renderToday();
  els.content.removeAttribute('aria-busy');
  performance.mark('ap-popup-ready');
  performance.measure('ap-popup-render', 'ap-popup-start', 'ap-popup-ready');

  // Later, off the critical path.
  document.getElementById('banner').append(AP.ui.hostAccessBanner());
  AP.lock.watch((next) => {
    state.lock = next;
    els.lockBar.update(next);
    if (!next.locked) closeInlineUnlock();
    renderFocus();
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
  document.getElementById('content').replaceChildren(h('p', { class: 'note' }, 'Something went wrong. Close this and open it again.'));
});
