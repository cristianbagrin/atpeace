// The Presets section of the settings page: the built-in presets, the person's own (apply, update
// from the current settings, rename, delete with an undo) and "New preset from current settings".
// Presets only name a bundle of YouTube settings; applying one goes through the settings lock like
// every other change, so a preset that would show something again asks for the unlock first.
const AP = globalThis.AtPeace;
const { h } = AP.ui;

const UNDO_MS = 8000;
const NAME_MAX = 60;

const settingsText = (preset) => {
  const n = Object.keys(preset.values).length;
  return n === 0 ? 'No settings' : n === 1 ? '1 setting' : `${n} settings`;
};

/**
 * @param {{ onCurrentName?: (name: string|null) => void }} [hooks] told the name of the preset in use
 * @returns {{ el: HTMLElement, refresh: (values: Record<string, any>, custom: object[]) => void }}
 */
export function buildPresets({ onCurrentName } = {}) {
  let values = {};
  let custom = [];
  /** The id of the custom preset being renamed, or 'new' while a new one is being named. */
  let editing = null;
  /** Where the last deleted preset was, for Undo. */
  let removed = null;
  let undoTimer = null;

  const builtInList = h('div', { class: 'panel preset-list' });
  const customList = h('div', { class: 'panel preset-list' });
  const undoBar = h('div', { class: 'undo', role: 'status', hidden: true });
  const problem = h('p', { class: 'field-error', role: 'alert', hidden: true });
  const showProblem = (message) => {
    problem.textContent = message ?? '';
    problem.hidden = !message;
  };

  const everyPreset = () => [...AP.presets.builtIn(), ...custom];

  // --- actions -------------------------------------------------------------------------------

  async function apply(preset) {
    showProblem(null);
    // Replacing a hand-made mix cannot be undone; moving between presets loses nothing.
    if (AP.ui.matchingPresetId(values, everyPreset()) === null) {
      const ok = await AP.ui.confirm('Replaces your YouTube settings.', { title: `Apply ${preset.name}?`, confirmLabel: 'Apply' });
      if (!ok) return;
    }
    let result = await AP.lock.applyPreset(preset.id);
    // A preset that would show something again needs the unlock (one that only hides more never asks).
    if (result.error === 'locked') {
      if (!(await AP.ui.requestUnlock())) {
        AP.ui.toast('Locked.');
        return;
      }
      result = await AP.lock.applyPreset(preset.id);
    }
    if (!result.ok) {
      AP.ui.toast('Preset not found.');
      return;
    }
    AP.ui.lastPreset.set(preset.builtIn ? null : preset.id);
    AP.ui.toast(`${preset.name} applied`);
  }

  async function update(preset) {
    showProblem(null);
    const result = await AP.settings.updateCustomPreset(preset.id);
    if (result.ok) AP.ui.toast(`${preset.name} updated`);
    else showProblem('Preset not found.');
  }

  async function rename(preset, name) {
    const clean = name.trim();
    if (clean === '') return false;
    if (clean !== preset.name) {
      const result = await AP.settings.renameCustomPreset(preset.id, clean);
      if (!result.ok) {
        showProblem('Preset not found.');
        return false;
      }
    }
    return true;
  }

  async function remove(preset) {
    showProblem(null);
    const index = custom.findIndex((p) => p.id === preset.id);
    const result = await AP.settings.deleteCustomPreset(preset.id);
    if (!result.ok) {
      showProblem('Preset not found.');
      return;
    }
    if (AP.ui.lastPreset.get() === preset.id) AP.ui.lastPreset.set(null);
    offerUndo(preset, index);
  }

  function offerUndo(preset, index) {
    removed = { preset, index };
    clearTimeout(undoTimer);
    const undo = h('button', { type: 'button', class: 'btn btn-quiet' }, 'Undo');
    undo.addEventListener('click', async () => {
      const back = removed;
      if (!back) return;
      const result = await AP.settings.restoreCustomPreset(back.preset, back.index);
      if (result.ok) clearUndo();
      else showProblem(result.error === 'too-many-presets' ? 'Too many presets.' : 'Could not restore it.');
    });
    const name = preset.name.length > 48 ? `${preset.name.slice(0, 47)}…` : preset.name;
    undoBar.replaceChildren(`Deleted “${name}”.`, undo);
    undoBar.hidden = false;
    undoTimer = setTimeout(clearUndo, UNDO_MS);
  }

  function clearUndo() {
    clearTimeout(undoTimer);
    removed = null;
    undoBar.hidden = true;
    undoBar.replaceChildren();
  }

  async function saveNew(name) {
    const clean = name.trim();
    if (clean === '') return false;
    const result = await AP.settings.saveCustomPreset(clean);
    if (!result.ok) {
      showProblem(result.error === 'too-many-presets' ? 'Too many presets.' : 'Could not save it.');
      return false;
    }
    AP.ui.lastPreset.set(result.preset.id);
    AP.ui.toast(`Saved “${clean}”`);
    return true;
  }

  // --- rows ----------------------------------------------------------------------------------

  /** One text field with Save and Cancel; Enter saves, Escape cancels. */
  function nameForm({ label, value = '', placeholder, saveLabel, onSave }) {
    const input = h('input', { type: 'text', maxlength: NAME_MAX, autocomplete: 'off', spellcheck: false, placeholder, 'aria-label': label, value });
    const finish = () => {
      editing = null;
      draw();
    };
    const submit = async () => {
      showProblem(null);
      if (input.value.trim() === '') {
        input.focus();
        return;
      }
      if (await onSave(input.value)) {
        custom = await AP.settings.listCustomPresets(); // show it now, not when the storage event arrives
        finish();
      }
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        submit();
      } else if (event.key === 'Escape') {
        event.stopPropagation();
        finish();
      }
    });
    const save = h('button', { type: 'button', class: 'btn btn-primary', onClick: submit }, saveLabel);
    const cancel = h('button', { type: 'button', class: 'btn btn-quiet', onClick: finish }, 'Cancel');
    return { input, el: h('div', { class: 'preset-form' }, input, save, cancel) };
  }

  function row(preset, { isCurrent }) {
    if (!preset.builtIn && editing === preset.id) {
      const form = nameForm({ label: 'Preset name', value: preset.name, saveLabel: 'Save', onSave: (name) => rename(preset, name) });
      queueMicrotask(() => {
        form.input.focus();
        form.input.select();
      });
      return h('div', { class: 'preset is-editing' }, form.el);
    }
    const detail = preset.builtIn ? preset.description : settingsText(preset);
    const button = (label, aria, onClick, className = 'btn btn-quiet', disabled = false) => h('button', { type: 'button', class: className, 'aria-label': aria, disabled, onClick }, label);
    return h(
      'div',
      { class: ['preset', isCurrent && 'is-current'], dataset: { id: preset.id } },
      h(
        'div',
        { class: 'preset-main' },
        h('p', { class: 'preset-name' }, preset.name, isCurrent && h('span', { class: 'caps preset-current' }, 'In use')),
        detail && h('p', { class: 'preset-desc' }, detail),
      ),
      h(
        'div',
        { class: 'preset-actions' },
        button('Apply', `Apply ${preset.name}`, () => apply(preset), 'btn'),
        // Nothing to update while the settings already are this preset.
        !preset.builtIn && button('Update from current', `Update ${preset.name} from the current settings`, () => update(preset), 'btn btn-quiet', isCurrent),
        !preset.builtIn && button('Rename', `Rename ${preset.name}`, () => {
          editing = preset.id;
          draw();
        }),
        !preset.builtIn && button('Delete', `Delete ${preset.name}`, () => remove(preset), 'btn btn-quiet btn-danger'),
      ),
    );
  }

  function draw() {
    const all = everyPreset();
    const currentId = AP.ui.matchingPresetId(values, all);
    onCurrentName?.(all.find((p) => p.id === currentId)?.name ?? null);

    builtInList.replaceChildren(...AP.presets.builtIn().map((p) => row(p, { isCurrent: p.id === currentId })));

    const rows = custom.map((p) => row(p, { isCurrent: p.id === currentId }));
    if (editing === 'new') {
      const form = nameForm({ label: 'Preset name', placeholder: 'Name', saveLabel: 'Save', onSave: saveNew });
      queueMicrotask(() => form.input.focus());
      rows.push(h('div', { class: 'preset is-editing' }, form.el));
    } else {
      const add = h(
        'button',
        {
          type: 'button',
          class: 'btn btn-quiet',
          onClick: () => {
            editing = 'new';
            draw();
          },
        },
        'New preset from current settings',
      );
      rows.push(h('div', { class: 'preset preset-add' }, add));
    }
    customList.replaceChildren(...rows);
  }

  const el = h(
    'div',
    { class: 'presets' },
    h('div', { class: 'group' }, h('h3', { class: 'group-title caps' }, 'Built in'), builtInList),
    h('div', { class: 'group' }, h('h3', { class: 'group-title caps' }, 'Yours'), customList),
    undoBar,
    problem,
  );
  draw();

  return {
    el,
    /** The settings or the saved presets changed: show them. A name being typed is left alone. */
    refresh(nextValues, nextCustom) {
      values = nextValues;
      custom = nextCustom;
      if (editing !== null && el.contains(document.activeElement) && document.activeElement?.matches?.('input[type="text"]')) {
        onCurrentName?.(AP.presets.get(AP.ui.matchingPresetId(values, everyPreset()) ?? '', custom)?.name ?? null);
        return;
      }
      if (editing !== null && editing !== 'new' && !custom.some((p) => p.id === editing)) editing = null; // renamed elsewhere or deleted
      draw();
    },
  };
}
