// The presets dialog: apply a built-in or saved preset, save the current settings as a new one,
// rename or delete saved ones. One native modal at a time; actions that need a second question
// (a name, a confirmation) close it, ask, and open it again.
const AP = globalThis.AtPeace;
const { h } = AP.ui;

/** @returns {Promise<{ builtIn: object[], custom: object[], all: object[] }>} */
export async function loadPresets() {
  const custom = await AP.settings.listCustomPresets();
  const builtIn = AP.presets.builtIn();
  return { builtIn, custom, all: [...builtIn, ...custom] };
}

const when = (ms) => (ms > 0 ? new Date(ms).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' }) : '');

function presetItem(preset, isCurrent) {
  const count = Object.keys(preset.values).length;
  const detail = preset.builtIn
    ? preset.description
    : [`${count === 1 ? '1 setting' : `${count} settings`} changed from default`, when(preset.createdAt) && `saved ${when(preset.createdAt)}`].filter(Boolean).join(' · ');
  const close = (value) => (event) => event.currentTarget.closest('dialog').close(value);
  return h(
    'li',
    { class: ['preset', isCurrent && 'is-current'] },
    h(
      'div',
      { class: 'preset-main' },
      h('p', { class: 'preset-name' }, preset.name, isCurrent && h('span', { class: 'caps preset-current' }, 'In use')),
      h('p', { class: 'preset-desc' }, detail),
    ),
    h(
      'div',
      { class: 'preset-actions' },
      h('button', { type: 'button', class: 'btn', onClick: close(`apply:${preset.id}`) }, 'Apply'),
      !preset.builtIn && h('button', { type: 'button', class: 'btn btn-quiet', onClick: close(`rename:${preset.id}`) }, 'Rename'),
      !preset.builtIn && h('button', { type: 'button', class: 'btn btn-quiet btn-danger', onClick: close(`delete:${preset.id}`) }, 'Delete'),
    ),
  );
}

async function showDialog(values) {
  const { builtIn, custom, all } = await loadPresets();
  const current = AP.ui.matchingPresetId(values, all);
  const closeBtn = h('button', { type: 'submit', value: 'close', class: 'btn' }, 'Close');
  const { returnValue } = await AP.ui.openDialog({
    title: 'Presets',
    wide: true,
    body: [
      h('p', { class: 'dialog-text' }, 'A preset sets all your YouTube settings in one go. Your appearance, pause details, schedules and lock are left as they are.'),
      h('ul', { class: 'preset-list' }, builtIn.map((p) => presetItem(p, p.id === current))),
      custom.length > 0 && h('h3', { class: 'caps preset-heading' }, 'Yours'),
      custom.length > 0 && h('ul', { class: 'preset-list' }, custom.map((p) => presetItem(p, p.id === current))),
      h(
        'p',
        { class: 'preset-save' },
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn-quiet',
            onClick: (event) => event.currentTarget.closest('dialog').close('save'),
          },
          'Save my current settings as a preset…',
        ),
      ),
    ],
    actions: [closeBtn],
    initialFocus: closeBtn,
  });
  return { returnValue, all, custom };
}

/**
 * Runs the presets dialog until the person is done.
 * @param {() => Record<string, any>} getValues  current values (read again every time the dialog opens)
 */
export async function managePresets(getValues) {
  for (;;) {
    const { returnValue, all, custom } = await showDialog(getValues());
    const [action, id] = returnValue.split(':');
    const preset = all.find((p) => p.id === id);

    if (action === 'save') {
      const name = await AP.ui.prompt('What should this preset be called?', {
        title: 'Save as a preset',
        confirmLabel: 'Save preset',
        placeholder: 'Evening wind-down',
      });
      if (!name) continue;
      const result = await AP.settings.saveCustomPreset(name);
      AP.ui.toast(result.ok ? `Saved “${name}”` : result.error === 'too-many-presets' ? 'You have as many presets as can be kept.' : 'That preset could not be saved.');
      continue;
    }

    if (action === 'apply' && preset) {
      const ok = await AP.ui.confirm(
        `This replaces your current YouTube settings with “${preset.name}”. Your appearance, pause details, schedules and lock stay as they are.`,
        { title: `Apply ${preset.name}?`, confirmLabel: 'Apply preset' },
      );
      if (!ok) continue;
      let result = await AP.lock.applyPreset(preset.id);
      // A preset that would show something again needs the unlock (one that only hides more never asks).
      if (result.error === 'locked') {
        if (!(await AP.ui.requestUnlock())) {
          AP.ui.toast('Locked: the preset was not applied.');
          return;
        }
        result = await AP.lock.applyPreset(preset.id);
      }
      AP.ui.toast(result.ok ? `${preset.name} applied` : 'That preset is no longer available.');
      return;
    }

    if (action === 'rename' && preset && custom.some((p) => p.id === id)) {
      const name = await AP.ui.prompt('New name for this preset', { title: 'Rename preset', value: preset.name, confirmLabel: 'Rename' });
      if (name) await AP.settings.renameCustomPreset(id, name);
      continue;
    }

    if (action === 'delete' && preset && custom.some((p) => p.id === id)) {
      const ok = await AP.ui.confirm(`“${preset.name}” will be removed. Your current settings stay as they are.`, {
        title: 'Delete this preset?',
        confirmLabel: 'Delete',
        danger: true,
      });
      if (ok) await AP.settings.deleteCustomPreset(id);
      continue;
    }

    return; // Close, Escape, or something that no longer exists
  }
}
