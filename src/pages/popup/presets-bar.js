// The preset menu in the popup's footer: choose a built-in or saved preset, "Save as new preset…"
// (a name field right above the footer, no window.prompt) and, once the settings have drifted from
// the custom preset applied or saved last, "Update “<name>”". Choosing one that would replace a
// hand-made mix asks first, in the page; a popup closes when it loses focus, so nothing opens a dialog.
const AP = globalThis.AtPeace;
const { h } = AP.ui;

const NEW = '::new';
const UPDATE = '::update';
const NAME_MAX = 60;

/**
 * @param {object} ctx popup context: state, els.sheet, askToUnlock, resync
 * @returns {{ el: HTMLElement, refresh: () => void }}
 */
export function buildPresetBar(ctx) {
  const { state } = ctx;
  const select = h('select', { id: 'preset-select', 'aria-label': 'Preset' });
  const el = h('span', { class: 'select preset-menu' }, select);
  let sheetOpen = false;

  const everyPreset = () => [...AP.presets.builtIn(), ...state.customPresets];

  function closeSheet() {
    sheetOpen = false;
    ctx.els.sheet.hidden = true;
    ctx.els.sheet.replaceChildren();
    refresh();
  }

  function openSheet(...children) {
    sheetOpen = true;
    ctx.els.sheet.replaceChildren(...children);
    ctx.els.sheet.hidden = false;
  }

  function refresh() {
    if (sheetOpen) return; // do not pull the menu away from a pending choice
    const builtIn = AP.presets.builtIn();
    const current = AP.ui.matchingPresetId(state.values, [...builtIn, ...state.customPresets]);
    const toUpdate = AP.ui.presetToUpdate(state.values, builtIn, state.customPresets, AP.ui.lastPreset.get());
    select.replaceChildren(
      current === null && h('option', { value: '', disabled: true }, 'Your own mix'),
      h('optgroup', { label: 'Built in' }, builtIn.map((p) => h('option', { value: p.id }, p.name))),
      state.customPresets.length > 0 && h('optgroup', { label: 'Yours' }, state.customPresets.map((p) => h('option', { value: p.id }, p.name))),
      h('option', { value: NEW }, 'Save as new preset…'),
      toUpdate && h('option', { value: UPDATE }, `Update “${toUpdate.name}”`),
    );
    select.value = current ?? '';
    select.dataset.current = current ?? '';
  }

  // --- applying -------------------------------------------------------------------------------

  async function applyNow(preset) {
    const result = await AP.lock.applyPreset(preset.id);
    if (result.error === 'locked') ctx.askToUnlock('Locked.');
    else if (!result.ok) AP.ui.toast('Preset not found.');
    else AP.ui.lastPreset.set(preset.builtIn ? null : preset.id);
    await ctx.resync();
  }

  function choose(preset) {
    // Replacing a hand-made mix cannot be undone; moving between presets loses nothing.
    if (AP.ui.matchingPresetId(state.values, everyPreset()) !== null) {
      applyNow(preset);
      return;
    }
    const apply = h(
      'button',
      {
        type: 'button',
        class: 'btn btn-primary',
        onClick: async () => {
          closeSheet();
          await applyNow(preset);
        },
      },
      'Apply',
    );
    openSheet(
      h('p', { class: 'note' }, `Replace your settings with “${preset.name}”?`),
      h('div', { class: 'sheet-actions' }, apply, h('button', { type: 'button', class: 'btn btn-quiet', onClick: closeSheet }, 'Cancel')),
    );
    apply.focus();
  }

  // --- saving ---------------------------------------------------------------------------------

  function askName() {
    const input = h('input', { type: 'text', maxlength: NAME_MAX, autocomplete: 'off', spellcheck: false, placeholder: 'Name', 'aria-label': 'Preset name' });
    const problem = h('p', { class: 'note is-error', role: 'alert', hidden: true });
    const save = async () => {
      const name = input.value.trim();
      if (name === '') {
        input.focus();
        return;
      }
      const result = await AP.settings.saveCustomPreset(name);
      if (!result.ok) {
        problem.textContent = result.error === 'too-many-presets' ? 'Too many presets.' : 'Could not save it.';
        problem.hidden = false;
        return;
      }
      AP.ui.lastPreset.set(result.preset.id);
      state.customPresets = await AP.settings.listCustomPresets();
      closeSheet();
      AP.ui.toast(`Saved “${name}”`);
    };
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        save();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation(); // a popup would close
        closeSheet();
        select.focus();
      }
    });
    openSheet(
      h('div', { class: 'sheet-form' }, input, h('button', { type: 'button', class: 'btn btn-primary', onClick: save }, 'Save'), h('button', { type: 'button', class: 'btn btn-quiet', onClick: closeSheet }, 'Cancel')),
      problem,
    );
    input.focus();
  }

  async function updateLast() {
    const preset = AP.ui.presetToUpdate(state.values, AP.presets.builtIn(), state.customPresets, AP.ui.lastPreset.get());
    if (!preset) {
      refresh();
      return;
    }
    const result = await AP.settings.updateCustomPreset(preset.id);
    AP.ui.toast(result.ok ? `${preset.name} updated` : 'Preset not found.');
    await ctx.resync();
  }

  select.addEventListener('change', () => {
    const value = select.value;
    if (value === NEW) {
      askName();
      select.value = select.dataset.current;
    } else if (value === UPDATE) {
      select.value = select.dataset.current;
      updateLast();
    } else {
      const preset = everyPreset().find((p) => p.id === value);
      select.value = select.dataset.current; // shows the choice only once it has been applied
      if (preset) choose(preset);
    }
  });

  return { el, refresh };
}
