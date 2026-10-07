// The popup's compact rows (28 px): a label and its control on the right. Two kinds:
//   inline   a switch, a choice or a number, edited right here (AP.ui.settingControl)
//   edit     everything with a bigger editor (lists, schedules, the lock…): an "Edit" button that opens
//            the settings page at that row
const AP = globalThis.AtPeace;
const { h } = AP.ui;

const slug = (id) => String(id).replace(/[^A-Za-z0-9_-]/g, '-');

/** What an "Edit" row says about the setting behind it: a count for a list, On / Off for the lock. */
export function editSummary(def, value) {
  if (Array.isArray(value)) return value.length > 0 ? String(value.length) : '';
  if (def.type === 'object') return value?.mode && value.mode !== 'none' ? 'On' : 'Off';
  return '';
}

/**
 * A row for a switch, a choice or a number. The control is registered with `ctx` so a change made
 * elsewhere (another tab, the options page) reaches it.
 * @param {object} ctx popup context (see popup.js)
 * @param {import('../../shared/schema-core.js').SettingDef} def
 * @param {{ label?: string }} [options] `label` replaces the setting's own label here
 */
export function buildInlineRow(ctx, def, { label = def.label } = {}) {
  const id = `q-${slug(def.id)}`;
  const control = AP.ui.settingControl(def, ctx.state.values[def.id], (value) => ctx.save(def, value), { id, shortLabels: true });
  const el = h(
    'div',
    { class: ['row', def.type === 'toggle' && 'is-toggle'], dataset: { id: def.id }, title: def.description ?? null },
    h('label', { class: 'row-label', for: id }, label),
    control.el,
  );
  const row = {
    def,
    el,
    control,
    /** Greyed out while the setting it waits for is off. */
    setEnabled(enabled, hint) {
      control.setDisabled(!enabled);
      el.classList.toggle('is-disabled', !enabled);
      el.title = enabled ? (def.description ?? '') : hint;
    },
    set: (value) => control.set(value),
  };
  ctx.track(row);
  return row;
}

/**
 * A row with an "Edit" button that opens the settings page at `target` ({ setting } or { section }).
 * @param {object} ctx
 * @param {{ label: string, target: { setting?: string, section?: string }, def?: object }} spec `def`: the setting, to show a summary
 */
export function buildEditRow(ctx, { label, target, def }) {
  const summary = h('span', { class: 'row-summary mono' });
  const button = h('button', { type: 'button', class: 'btn btn-quiet edit', 'aria-label': `Edit ${label}`, onClick: () => ctx.openSettings(target) }, 'Edit');
  const el = h('div', { class: 'row is-edit', dataset: { id: target.setting ?? target.section } }, h('span', { class: 'row-label' }, label), summary, button);
  const row = {
    def: def ?? null,
    el,
    set(value) {
      summary.textContent = def ? editSummary(def, value) : '';
    },
    setEnabled() {},
  };
  if (def) {
    row.set(ctx.state.values[def.id]);
    ctx.track(row);
  }
  return row;
}
