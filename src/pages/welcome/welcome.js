// Welcome page (Phase 4b): opened once by the background after the first install. Three short
// steps on one calm page, no carousel:
//   01  how much to see      the four built-in presets as rows in a panel (Gentle is already applied)
//   02  a breath before YouTube   Mindful Pause on/off, the length of the breath, the session length
//   03  keep it in reach     pinning the extension, the keyboard shortcuts, the host-access notice
// Choices are saved the moment they are made (through the settings lock, like every page); Finish
// asks the background to set `meta.onboarded` (only the background writes meta).
const AP = globalThis.AtPeace;
const { h } = AP.ui;
const T = AP.msg.TYPES;

const PRESET_ORDER = ['gentle', 'focused', 'deep-work', 'untouched'];
/** One short line each, in the words of this page. */
const PRESET_LINES = {
  gentle: 'Ads, Shorts and AI extras go. Your feeds stay.',
  focused: 'Also no home feed, related videos, comments or autoplay.',
  'deep-work': 'Also your subscriptions only, grey and blurred, no counts, and a pause before opening.',
  untouched: 'Nothing hidden. YouTube exactly as it comes.',
};

/** The pause settings of step 02, with the page's own wording. */
const PAUSE_ROWS = [
  { id: 'pause.enabled', label: 'Pause before opening YouTube', text: 'A breathing screen first, then you decide.' },
  { id: 'pause.breathSeconds', label: 'Length of the breath', text: 'Six seconds is a good start.' },
  { id: 'pause.sessionMinutes', label: 'When I continue, keep it open for', text: 'After that, the breath comes back.' },
];

/** The shortcuts of step 03: manifest command → what it does, in plain words. */
const SHORTCUTS = [
  { name: 'toggle-enabled', text: 'Turn At Peace on or off' },
  { name: 'focus-25', text: 'Block YouTube for 25 minutes' },
  { name: 'open-picker', text: 'Hide an element on the page' },
];

const state = {
  values: {},
  customPresets: [],
  /** @type {Map<string, import('../common/components.js').Control>} */
  controls: new Map(),
  /** @type {Map<string, HTMLInputElement>} */
  radios: new Map(),
  rows: new Map(),
};

const readValues = async () => AP.settings.merge(await AP.settings.load());
const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------------------------
// 01  presets
// ---------------------------------------------------------------------------------------------

const allPresets = () => [...AP.presets.builtIn(), ...state.customPresets];

/**
 * The preset that matches what is set now, or null. The pause switch (step 02) is left out of the
 * comparison: turning it on or off is its own choice and must not make step 01 say "your own mix".
 */
function currentPresetId() {
  const scoped = AP.schema.all().filter((def) => AP.presets.inScope(def) && def.id !== 'pause.enabled');
  const same = (preset) => scoped.every((def) => AP.util.deepEqual(state.values[def.id], Object.hasOwn(preset.values, def.id) ? preset.values[def.id] : def.default));
  return allPresets().find(same)?.id ?? null;
}

function refreshPresets() {
  const current = currentPresetId();
  for (const [id, radio] of state.radios) radio.checked = id === current;
  $('step-1-intro').textContent =
    current === null && state.radios.size > 0
      ? 'Your settings are your own mix right now. Choosing one of these replaces it.'
      : 'Pick a starting point. Every single thing can be tuned afterwards.';
}

async function choosePreset(id) {
  const preset = allPresets().find((p) => p.id === id);
  if (!preset) return;
  const current = currentPresetId();
  if (current === null && !(await AP.ui.confirm(`This replaces your current YouTube settings with “${preset.name}”.`, { title: `Apply ${preset.name}?`, confirmLabel: 'Apply' }))) {
    refreshPresets();
    return;
  }
  const result = await AP.lock.applyPreset(id);
  if (result.error === 'locked') AP.ui.toast('Locked: unlock your settings to choose this.');
  else if (!result.ok) AP.ui.toast('That preset is no longer available.');
  state.values = await readValues();
  refreshPresets();
  refreshPause();
}

function buildPresets() {
  const rows = PRESET_ORDER.map((id) => AP.presets.get(id)).filter(Boolean);
  const current = currentPresetId();
  $('presets').replaceChildren(
    ...rows.map((preset) => {
      const radio = h('input', { type: 'radio', name: 'preset', value: preset.id, checked: preset.id === current, onChange: () => choosePreset(preset.id) });
      state.radios.set(preset.id, radio);
      return h(
        'label',
        { class: 'choice' },
        radio,
        h('span', { class: 'choice-text' }, h('span', { class: 'choice-name' }, preset.name), h('span', { class: 'choice-desc' }, PRESET_LINES[preset.id] ?? preset.description)),
      );
    }),
  );
  refreshPresets();
}

// ---------------------------------------------------------------------------------------------
// 02  the pause
// ---------------------------------------------------------------------------------------------

async function savePause(def, value) {
  const result = await AP.lock.save({ [def.id]: value });
  if (!result.ok) {
    AP.ui.toast('Locked: unlock your settings to change this.');
    state.controls.get(def.id)?.set(state.values[def.id]);
    return;
  }
  if (result.report.invalid.includes(def.id)) throw new Error('That value is not allowed here.');
  state.values[def.id] = AP.schema.validateValue(def, value);
  refreshPause();
}

/** Shows the stored values in the controls and greys out what waits for the pause switch. */
function refreshPause() {
  for (const { id } of PAUSE_ROWS) {
    const control = state.controls.get(id);
    if (!control) continue;
    control.set(state.values[id]);
    const { enabled } = AP.ui.requiresState(AP.schema.get(id), state.values);
    control.setDisabled(!enabled);
    state.rows.get(id)?.classList.toggle('is-disabled', !enabled);
  }
}

function buildPause() {
  const rows = PAUSE_ROWS.map(({ id, label, text }) => {
    const def = AP.schema.get(id);
    const inputId = `w-${id.replace(/[^A-Za-z0-9_-]/g, '-')}`;
    const error = h('p', { class: 'row-error', role: 'alert', hidden: true });
    const control = AP.ui.settingControl(def, state.values[id], (v) => savePause(def, v), {
      id: inputId,
      describedBy: `${inputId}-desc`,
      onError: (message) => {
        error.textContent = message ?? '';
        error.hidden = !message;
      },
    });
    state.controls.set(id, control);
    const row = h(
      'div',
      { class: ['row', def.type === 'toggle' && 'is-toggle'], dataset: { id } },
      h('div', { class: 'row-text' }, h('label', { class: 'row-label', for: inputId }, label), h('p', { class: 'row-desc', id: `${inputId}-desc` }, text), error),
      h('div', { class: 'row-control' }, control.el),
    );
    state.rows.set(id, row);
    return row;
  });
  $('pause').replaceChildren(...rows);
  refreshPause();
}

// ---------------------------------------------------------------------------------------------
// 03  pinning and shortcuts
// ---------------------------------------------------------------------------------------------

/** The shortcut each command has right now (the person may have changed it), else the manifest's suggestion. */
async function shortcutsByCommand() {
  const manifest = AP.api.runtime.getManifest().commands ?? {};
  const out = {};
  for (const [name, spec] of Object.entries(manifest)) out[name] = spec?.suggested_key?.default ?? '';
  try {
    for (const command of (await AP.api.commands?.getAll?.()) ?? []) if (command.name in out) out[command.name] = command.shortcut ?? '';
  } catch {
    /* the suggestions will do */
  }
  return out;
}

async function buildKeys() {
  const shortcuts = await shortcutsByCommand();
  $('keys').replaceChildren(
    ...SHORTCUTS.map(({ name, text }) => {
      const combo = shortcuts[name];
      const keys = combo
        ? combo
            .split('+')
            .flatMap((key, i) => [i > 0 ? h('span', { class: 'plus', 'aria-hidden': 'true' }, '+') : null, h('kbd', null, key.trim())])
        : [h('span', { class: 'unset' }, 'not assigned')];
      return h('div', { class: 'key-row' }, h('dt', null, keys), h('dd', null, text));
    }),
  );
}

// ---------------------------------------------------------------------------------------------
// Finish
// ---------------------------------------------------------------------------------------------

function renderFinish(done) {
  const finish = $('finish');
  if (done) {
    finish.replaceChildren(
      h('h3', { class: 'done-title' }, 'You are all set.'),
      h('p', { class: 'lede' }, 'At Peace is on. Open YouTube to see how it feels, or look through all the settings first.'),
      h(
        'div',
        { class: 'done-actions' },
        h('a', { class: 'btn btn-primary big', id: 'open-youtube', href: 'https://www.youtube.com/' }, 'Open YouTube'),
        h(
          'button',
          {
            type: 'button',
            class: 'btn big',
            id: 'open-settings',
            onClick: () => {
              AP.api.runtime.openOptionsPage();
            },
          },
          'See all settings',
        ),
      ),
    );
    document.getElementById('open-youtube')?.focus();
    return;
  }
  const note = h('p', { class: 'step-note', role: 'status' }, 'Nothing here is final: the settings are always one click away.');
  const button = h('button', { type: 'button', class: 'btn btn-primary big', id: 'finish-button' }, 'Finish');
  button.addEventListener('click', async () => {
    button.disabled = true;
    const res = await AP.msg.send(T.ONBOARDING_DONE).catch(() => ({ ok: false }));
    if (res?.ok) {
      renderFinish(true);
      return;
    }
    button.disabled = false;
    note.textContent = 'That did not save. Please try once more.';
  });
  finish.replaceChildren(button, note);
}

// ---------------------------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------------------------

async function init() {
  $('dial').prepend(AP.ui.dial().svg);
  const [values, customPresets] = await Promise.all([readValues(), AP.settings.listCustomPresets()]);
  state.values = values;
  state.customPresets = customPresets;
  AP.ui.watchTheme(values);

  buildPresets();
  buildPause();
  $('access').append(AP.ui.hostAccessBanner());
  await buildKeys();
  renderFinish(false);

  // A preset or the pause switch changed in another tab, or by a shortcut: follow it.
  AP.settings.subscribe(async () => {
    state.values = await readValues();
    state.customPresets = await AP.settings.listCustomPresets();
    refreshPresets();
    refreshPause();
  });
  document.body.dataset.ready = 'true';
}

init().catch((err) => {
  AP.warn('welcome page failed to start', err);
  $('steps').replaceChildren(h('p', { class: 'step-note' }, 'This page could not be loaded. Close it and open At Peace’s settings from the toolbar.'));
});
