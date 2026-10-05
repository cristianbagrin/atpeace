// One ledger row of the options page: label and one-line description on the left, the control on
// the right (or full width underneath for lists and custom editors). Built from a SettingDef, so
// every setting in the registry gets a row without the page knowing its id.
const AP = globalThis.AtPeace;
const { h } = AP.ui;

/** Id-safe form of a setting or section id ('yt.home.hideChips' → 'yt-home-hideChips'). */
export const slug = (id) => String(id).replace(/[^A-Za-z0-9_-]/g, '-');

/** Types whose editor needs the whole row width. */
const WIDE_TYPES = new Set(['list', 'object', 'textarea', 'text']);

/**
 * @typedef {Object} Row
 * @property {import('../../shared/schema-core.js').SettingDef} def
 * @property {HTMLElement} el
 * @property {(value: any) => void} set        show a value that changed elsewhere
 * @property {(enabled: boolean, needs: object|null, options?: { showHint?: boolean, wants?: object }) => void} setEnabled
 * @property {(hidden: boolean) => void} setHidden
 * @property {(show: boolean) => void} showAdvancedTag
 * @property {() => void} clearLocked     take the "Locked" note away (the lock opened)
 * @property {() => void} focus
 * @property {() => void} highlight
 */

/**
 * @param {import('../../shared/schema-core.js').SettingDef} def
 * @param {any} initialValue
 * @param {(def: object, value: any) => Promise<void>} save  stores the value; rejects with a readable Error. An Error
 *   with `code: 'locked'` (the settings lock refused a loosening) is not shown as an error: the row puts the old value
 *   back and says, calmly, that it is locked.
 * @param {{ onUnlock?: () => void }} [hooks] onUnlock: the "Unlock…" button of that note
 * @returns {Row}
 */
export function buildRow(def, initialValue, save, { onUnlock } = {}) {
  const key = slug(def.id);
  const inputId = `in-${key}`;
  const descId = `d-${key}`;
  const hintId = `h-${key}`;
  const labelId = `l-${key}`;
  const renderer = AP.optionsRendererFor(def);
  const describedBy = [def.description ? descId : null, hintId].filter(Boolean).join(' ');

  const errorEl = h('p', { class: 'row-error', role: 'alert', hidden: true });
  const hintEl = h('p', { class: 'row-hint', id: hintId, hidden: true });
  const advancedTag = h('span', { class: 'row-tag caps', hidden: true }, 'Advanced');
  // The settings lock refused a loosening: say so quietly, with the way out right there.
  const lockEl = h(
    'p',
    { class: 'row-lock', role: 'status', hidden: true },
    h('span', null, 'Locked. Showing something again needs an unlock first.'),
    ' ',
    h('button', { type: 'button', class: 'btn btn-quiet', onClick: () => onUnlock?.() }, 'Unlock…'),
  );

  /** The value the field should show: what is stored. */
  let stored = initialValue;
  let enabledNow = true;
  const persist = async (value) => {
    try {
      await save(def, value);
      stored = value;
      lockEl.hidden = true;
    } catch (err) {
      if (err?.code !== 'locked') throw err;
      refuse();
    }
  };

  /** @type {HTMLElement|null} */
  let custom = null;
  let control = null;

  const renderCustom = (value) => {
    if (!renderer) return null;
    try {
      const ctx = { save: persist, api: AP.api, h, toast: AP.ui.toast, ui: AP.ui, def, inputId, labelId, describedBy };
      const el = renderer.render(def, value, ctx);
      if (el instanceof HTMLElement) return el;
      AP.warn(`custom editor for ${def.id} returned no element; using the generic one`);
    } catch (err) {
      AP.warn(`custom editor for ${def.id} failed; using the generic one`, err);
    }
    return null;
  };

  const makeControl = (value) =>
    AP.ui.settingControl(def, value, persist, {
      id: inputId,
      labelledBy: labelId,
      describedBy,
      onError: (message) => {
        errorEl.textContent = message ?? '';
        errorEl.hidden = !message;
      },
    });

  custom = renderCustom(initialValue);
  if (!custom) control = makeControl(initialValue);

  const kind = AP.ui.controlKind(def);
  const wide = custom !== null || WIDE_TYPES.has(def.type) || kind === 'checks' || kind === 'json';
  const host = h('div', { class: 'row-control' }, custom ?? control.el);

  /** Puts the stored value back into a fresh editor (the typed one is simply replaced) and keeps the keyboard where it was. */
  function refuse() {
    const hadFocus = host.contains(document.activeElement);
    errorEl.hidden = true;
    lockEl.hidden = false;
    if (custom) {
      const fresh = renderCustom(stored);
      if (fresh) {
        custom.replaceWith(fresh);
        custom = fresh;
        custom.inert = !enabledNow;
      }
    } else {
      control = makeControl(stored);
      control.setDisabled(!enabledNow);
      host.replaceChildren(control.el);
    }
    if (hadFocus) row.focus();
  }

  const el = h(
    'div',
    { class: ['row', wide && 'is-wide', def.type === 'toggle' && 'is-toggle'], dataset: { id: def.id } },
    h(
      'div',
      { class: 'row-text' },
      h('label', { class: 'row-label', id: labelId, for: inputId }, def.label, advancedTag),
      def.description && h('p', { class: 'row-desc', id: descId }, def.description),
      hintEl,
      errorEl,
      lockEl,
    ),
    host,
  );

  let highlightTimer = null;

  const row = {
    def,
    el,

    set(value) {
      stored = value;
      if (control) {
        control.set(value);
        return;
      }
      if (renderer?.update?.(custom, value) === true) return;
      const fresh = renderCustom(value);
      if (!fresh) return;
      custom.replaceWith(fresh);
      custom = fresh;
    },

    setEnabled(enabled, needs, { showHint = true, wants } = {}) {
      enabledNow = enabled;
      el.classList.toggle('is-disabled', !enabled);
      // The text stays in the DOM (it is part of the field's description); it is only not repeated on screen.
      hintEl.textContent = enabled ? '' : AP.ui.requiresHint(needs, wants);
      hintEl.hidden = enabled || !showHint;
      control?.setDisabled(!enabled);
      if (custom) custom.inert = !enabled;
    },

    setHidden(hidden) {
      el.hidden = hidden;
    },

    showAdvancedTag(show) {
      advancedTag.hidden = !show;
    },

    clearLocked() {
      lockEl.hidden = true;
    },

    focus() {
      if (control) control.focus();
      else custom?.querySelector('input, select, textarea, button')?.focus();
    },

    highlight() {
      el.classList.remove('is-target');
      void el.offsetWidth; // restart the animation if it is already running
      el.classList.add('is-target');
      clearTimeout(highlightTimer);
      highlightTimer = setTimeout(() => el.classList.remove('is-target'), 2600);
    },
  };
  return row;
}
