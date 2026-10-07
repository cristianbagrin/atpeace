// DOM helpers shared by the popup, the options page and (later) welcome/pause/blocked.
// Classic script; adds to AP.ui next to the pure helpers of logic.js (load logic.js first).
//
//   AP.ui.h(tag, attrs, ...children)      build DOM without innerHTML
//   AP.ui.dial({ arc })                   the sixty-tick dial as inline SVG (pause, blocked, welcome)
//   AP.ui.applyTheme(theme)               'light' | 'dark' | 'system' → <html data-theme>
//   AP.ui.watchTheme([effective])         apply now and whenever general.theme changes
//   AP.ui.toast(message)                  a quiet line at the bottom of the page
//   AP.ui.confirm(text, options)          native <dialog>; resolves true/false
//   AP.ui.prompt(text, options)           native <dialog> with one text field; resolves string|null
//   AP.ui.settingControl(def, value, onChange, options)   generic editor for one setting
//   AP.ui.hostAccessBanner()              "grant access to youtube.com" banner (permission risk R2)
//   AP.ui.loadShortcuts()                 the keyboard shortcuts as assigned now, in the platform's notation
//   AP.ui.openSettings({ setting })       the settings page, at a row (or { section }); reuses an open tab
//   AP.ui.lastPreset.get() / .set(id)     the custom preset applied or saved last (for "Update")
(() => {
  'use strict';
  const AP = globalThis.AtPeace;
  const ui = (AP.ui ??= {});
  const { deepEqual } = AP.util;

  // ---------------------------------------------------------------------------------------
  // h()
  // ---------------------------------------------------------------------------------------

  /** Attributes that must be set as properties to reflect live state. */
  const PROPERTIES = new Set(['checked', 'disabled', 'hidden', 'selected', 'indeterminate', 'readOnly', 'multiple', 'open']);

  function appendChildren(el, children) {
    for (const child of children) {
      if (child === null || child === undefined || child === false || child === true) continue;
      if (Array.isArray(child)) appendChildren(el, child);
      else if (child instanceof Node) el.append(child);
      else el.append(document.createTextNode(String(child)));
    }
  }

  /**
   * Creates an element. `attrs` may be omitted (`h('p', 'text')`).
   *   class      string or array (falsy entries skipped)
   *   dataset    object of data-* values
   *   style      object (custom properties allowed) or string
   *   onClick…   any `on<Event>` function becomes an event listener (`onKeydown`, `onInput`…)
   *   true       boolean attribute present; false/null/undefined: left out
   *   value      applied after the children, so <select value> finds its options
   * Never parses HTML: strings always become text.
   * @param {string} tag
   * @param {Record<string, any>|string|Node|any[]|null} [attrs]
   * @param {...any} children
   * @returns {HTMLElement}
   */
  function h(tag, attrs, ...children) {
    if (attrs !== null && attrs !== undefined && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
      children.unshift(attrs);
      attrs = null;
    }
    const el = document.createElement(tag);
    let value;
    for (const [key, v] of Object.entries(attrs ?? {})) {
      if (v === null || v === undefined || v === false) continue;
      if (key === 'class') {
        const names = Array.isArray(v) ? v.filter(Boolean).join(' ') : String(v);
        if (names) el.className = names;
      } else if (key === 'dataset') {
        Object.assign(el.dataset, v);
      } else if (key === 'style') {
        if (typeof v === 'string') el.style.cssText = v;
        else for (const [prop, val] of Object.entries(v)) el.style.setProperty(prop.startsWith('--') ? prop : prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`), String(val));
      } else if (key.length > 2 && key.startsWith('on') && typeof v === 'function') {
        el.addEventListener(key.slice(2).toLowerCase(), v);
      } else if (key === 'value') {
        value = v;
      } else if (PROPERTIES.has(key)) {
        el[key] = true;
      } else {
        el.setAttribute(key, v === true ? '' : String(v));
      }
    }
    appendChildren(el, children);
    if (value !== undefined) el.value = String(value);
    return el;
  }

  // ---------------------------------------------------------------------------------------
  // The dial
  // ---------------------------------------------------------------------------------------

  const SVG_NS = 'http://www.w3.org/2000/svg';

  function svgEl(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    return node;
  }

  /**
   * An SVG dial: sixty ticks (every fifth longer) and, optionally, the amber arc of a block.
   * Colours come from CSS (`.dial-ticks`, `.dial-arc`), so the page decides them.
   * @param {{ arc?: boolean }} [options]
   * @returns {{ svg: SVGSVGElement, ticks: SVGPathElement, setArc: (fraction: number) => void }}
   */
  function dial({ arc = false } = {}) {
    const svg = svgEl('svg', { viewBox: '0 0 320 320', class: 'dial-svg', 'aria-hidden': 'true', focusable: 'false' });
    const ticks = svgEl('path', { class: 'dial-ticks', d: ui.dialTicksPath(), fill: 'none', 'stroke-width': 2, 'stroke-linecap': 'round' });
    svg.append(ticks);
    const arcEl = arc ? svgEl('path', { class: 'dial-arc', fill: 'none', 'stroke-width': 8, 'stroke-linecap': 'round' }) : null;
    if (arcEl) svg.append(arcEl);
    return {
      svg,
      ticks,
      setArc(fraction) {
        if (!arcEl) return;
        const d = ui.dialArcPath(fraction);
        arcEl.setAttribute('d', d);
        arcEl.style.display = d === '' ? 'none' : '';
      },
    };
  }

  // ---------------------------------------------------------------------------------------
  // Theme
  // ---------------------------------------------------------------------------------------

  /** @param {string} theme 'light' | 'dark' | 'system' (anything else is light) */
  function applyTheme(theme) {
    const t = theme === 'dark' || theme === 'system' ? theme : 'light';
    document.documentElement.dataset.theme = t;
    try {
      localStorage.setItem('at-peace-theme', t); // read by theme-boot.js on the next page load
    } catch {
      /* storage unavailable: the page still looks right now */
    }
  }

  /**
   * Applies the stored theme and follows later changes (another tab, the popup).
   * @param {Record<string, any>} [effective] settings already in hand, to skip a read
   * @returns {() => void} stop watching
   */
  function watchTheme(effective) {
    if (effective) applyTheme(effective['general.theme']);
    else AP.settings.effective().then((eff) => applyTheme(eff['general.theme']), () => {});
    return AP.settings.subscribe((eff) => applyTheme(eff['general.theme']), effective);
  }

  // ---------------------------------------------------------------------------------------
  // Toast
  // ---------------------------------------------------------------------------------------

  let toastEl = null;
  let toastTimer = null;

  /** @param {string} message */
  function toast(message) {
    if (!toastEl || !toastEl.isConnected) {
      toastEl = h('div', { class: 'toast', role: 'status', 'aria-live': 'polite' });
      document.body.append(toastEl);
    }
    toastEl.textContent = message;
    // Force a style flush so a second toast restarts the transition.
    void toastEl.offsetWidth;
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl?.classList.remove('is-visible'), 2600);
  }

  // ---------------------------------------------------------------------------------------
  // Dialogs
  // ---------------------------------------------------------------------------------------

  let dialogCount = 0;

  /**
   * Opens a native modal dialog around `body` and resolves with its `returnValue` once closed.
   * @param {{ title?: string, body: (Node|string)[], actions: HTMLElement[], initialFocus?: HTMLElement, wide?: boolean }} spec
   * @returns {Promise<{ returnValue: string, dialog: HTMLDialogElement }>}
   */
  function openDialog({ title, body, actions, initialFocus, wide = false }) {
    const titleId = `dlg-title-${++dialogCount}`;
    const dialog = h(
      'dialog',
      { class: ['dialog', wide && 'is-wide'], 'aria-labelledby': title ? titleId : null },
      h('form', { method: 'dialog' }, title && h('h2', { class: 'dialog-title', id: titleId }, title), body, h('div', { class: 'dialog-actions' }, actions)),
    );
    return new Promise((resolve) => {
      dialog.addEventListener('close', () => {
        const returnValue = dialog.returnValue;
        dialog.remove();
        resolve({ returnValue, dialog });
      });
      document.body.append(dialog);
      dialog.showModal();
      initialFocus?.focus();
    });
  }

  /**
   * Asks a yes/no question in an accessible native dialog. Escape or Cancel resolve false.
   * @param {string} text
   * @param {{ title?: string, confirmLabel?: string, cancelLabel?: string, danger?: boolean }} [options]
   * @returns {Promise<boolean>}
   */
  async function confirm(text, { title, confirmLabel = 'Continue', cancelLabel = 'Cancel', danger = false } = {}) {
    const ok = h('button', { type: 'submit', value: 'confirm', class: ['btn', danger ? 'btn-danger' : 'btn-primary'] }, confirmLabel);
    const cancel = h('button', { type: 'submit', value: 'cancel', class: 'btn', formnovalidate: true }, cancelLabel);
    const { returnValue } = await openDialog({
      title,
      body: [h('p', { class: 'dialog-text' }, text)],
      actions: [cancel, ok],
      initialFocus: danger ? cancel : ok, // a destructive action is never the Enter default
    });
    return returnValue === 'confirm';
  }

  /**
   * Asks for one line of text. Resolves the trimmed text, or null when cancelled.
   * @param {string} text what is being asked
   * @param {{ title?: string, value?: string, confirmLabel?: string, maxLength?: number, placeholder?: string }} [options]
   * @returns {Promise<string|null>}
   */
  async function prompt(text, { title, value = '', confirmLabel = 'Save', maxLength = 60, placeholder } = {}) {
    const fieldId = `dlg-field-${++dialogCount}`;
    const input = h('input', { type: 'text', id: fieldId, maxlength: maxLength, required: true, autocomplete: 'off', spellcheck: false, placeholder, value });
    input.required = true;
    const ok = h('button', { type: 'submit', value: 'confirm', class: 'btn btn-primary' }, confirmLabel);
    const cancel = h('button', { type: 'submit', value: 'cancel', class: 'btn', formnovalidate: true }, 'Cancel');
    const { returnValue } = await openDialog({
      title,
      body: [h('label', { class: 'dialog-text', for: fieldId }, text), h('div', { class: 'dialog-field' }, input)],
      actions: [cancel, ok],
      initialFocus: input,
    });
    const answer = input.value.trim();
    return returnValue === 'confirm' && answer !== '' ? answer : null;
  }

  // ---------------------------------------------------------------------------------------
  // settingControl()
  // ---------------------------------------------------------------------------------------

  /**
   * @typedef {Object} Control
   * @property {HTMLElement} el          put this in the page
   * @property {() => any} get           the value as it stands in the field
   * @property {(value: any) => void} set  show a value that changed elsewhere (never fires onChange)
   * @property {(disabled: boolean) => void} setDisabled
   * @property {() => void} focus
   */

  /**
   * @typedef {Object} ControlOptions
   * @property {string} [id]           id for the main input (so a <label for> can point at it)
   * @property {string} [describedBy]  id of the element describing it
   * @property {string} [labelledBy]   id of the element naming it (needed for checkbox groups, which a <label for> cannot name)
   * @property {(message: string|null) => void} [onError]  inline problem text (null clears it)
   * @property {(items: string[]) => {line:number, message:string}[]} [validateLines]  list editors only
   * @property {boolean} [regexLines]  list editors: check /regex/flags lines
   * @property {string} [placeholder]  list editors: hint shown while the field is empty
   * @property {boolean} [shortLabels]   selects: show each option's `short` label (tight spaces such as the popup)
   */

  const DEBOUNCE_MS = { number: 400, text: 600, textarea: 700, list: 600, json: 900 };

  /**
   * Generic editor for one setting, picked by its type: toggle → switch, select, number (with
   * unit), text, textarea, list → one entry per line (or checkboxes when the list has `options`);
   * object and lists of objects get a JSON editor until a custom renderer exists.
   *
   * `onChange(value)` runs only with values that pass the field's own checks. It may return a
   * promise; resolving to a string (or rejecting) shows that text through `options.onError`.
   * @param {import('../../shared/schema-core.js').SettingDef} def
   * @param {any} value
   * @param {(value: any) => void | string | Promise<void | string>} onChange
   * @param {ControlOptions} [options]
   * @returns {Control}
   */
  function settingControl(def, value, onChange, options = {}) {
    const { id = `ctl-${def.id}`, describedBy = null } = options;
    const report = (message) => options.onError?.(message ?? null);

    const commit = async (next) => {
      try {
        const message = await onChange(next);
        report(typeof message === 'string' ? message : null);
      } catch (err) {
        report(String(err?.message ?? '') || 'That could not be saved.');
      }
    };
    const kind = controlKind(def);
    const later = AP.util.debounce(commit, DEBOUNCE_MS[kind] ?? 500);
    const ctx = { id, describedBy, labelledBy: options.labelledBy ?? null, commit, later, report, options };
    switch (kind) {
      case 'toggle':
        return toggleControl(def, value, ctx);
      case 'select':
        return selectControl(def, value, ctx);
      case 'number':
        return numberControl(def, value, ctx);
      case 'text':
      case 'textarea':
        return textControl(def, value, ctx, kind);
      case 'checks':
        return checksControl(def, value, ctx);
      case 'list':
        return listControl(def, value, ctx);
      default:
        return jsonControl(def, value, ctx);
    }
  }

  function controlKind(def) {
    if (def.type === 'list') return def.options ? 'checks' : AP.ui.isStringList(def) ? 'list' : 'json';
    if (['toggle', 'select', 'number', 'text', 'textarea'].includes(def.type)) return def.type;
    return 'json';
  }

  function toggleControl(def, value, { id, describedBy, commit }) {
    const input = h('input', { type: 'checkbox', role: 'switch', class: 'switch', id, 'aria-describedby': describedBy, checked: value === true });
    input.addEventListener('change', () => commit(input.checked));
    return {
      el: input,
      get: () => input.checked,
      set: (v) => {
        input.checked = v === true;
      },
      setDisabled: (disabled) => {
        input.disabled = disabled;
      },
      focus: () => input.focus(),
    };
  }

  function selectControl(def, value, { id, describedBy, commit, options }) {
    // `shortLabels` (the popup): options may carry a brief `short` text; the full label stays as the tooltip.
    const short = options.shortLabels === true;
    const select = h(
      'select',
      { id, 'aria-describedby': describedBy, value },
      def.options.map((o) => h('option', { value: o.value, title: short && o.short ? o.label : null }, short ? (o.short ?? o.label) : o.label)),
    );
    select.addEventListener('change', () => commit(select.value));
    return {
      el: h('span', { class: 'select' }, select),
      get: () => select.value,
      set: (v) => {
        select.value = String(v);
      },
      setDisabled: (disabled) => {
        select.disabled = disabled;
      },
      focus: () => select.focus(),
    };
  }

  function numberControl(def, value, { id, describedBy, commit, later, report }) {
    const unitId = `${id}-unit`;
    const input = h('input', {
      type: 'number',
      id,
      inputmode: 'numeric',
      min: def.min,
      max: def.max,
      step: def.step,
      'aria-describedby': [describedBy, def.unit ? unitId : null].filter(Boolean).join(' ') || null,
      value,
    });
    const flag = (invalid) => input.setAttribute('aria-invalid', invalid ? 'true' : 'false');
    // While typing, only a valid number is saved (after a pause); a problem is spoken about once
    // the person leaves the field, so "1" on the way to "10" is not scolded.
    input.addEventListener('input', () => {
      const result = AP.ui.numberCheck(def, input.value);
      if (result.ok) {
        flag(false);
        report(null);
        later(result.value);
      } else {
        later.cancel();
      }
    });
    input.addEventListener('change', () => {
      later.cancel();
      const result = AP.ui.numberCheck(def, input.value);
      flag(!result.ok);
      if (result.ok) commit(result.value);
      else report(result.message);
    });
    const unit = def.unit ? h('span', { class: 'unit', id: unitId }, def.unit) : null;
    return {
      el: h('span', { class: 'number-field' }, input, unit),
      get: () => Number(input.value),
      set: (v) => {
        if (document.activeElement === input && input.value !== '') return; // do not fight the typist
        input.value = String(v);
        flag(false);
        report(null);
      },
      setDisabled: (disabled) => {
        input.disabled = disabled;
      },
      focus: () => input.focus(),
    };
  }

  function textControl(def, value, { id, describedBy, commit, later, report }, kind) {
    const maxLength = def.maxLength ?? (kind === 'text' ? 1000 : 20_000);
    const field =
      kind === 'text'
        ? h('input', { type: 'text', id, maxlength: maxLength, spellcheck: false, autocomplete: 'off', 'aria-describedby': describedBy, value })
        : h('textarea', { id, rows: 8, maxlength: maxLength, spellcheck: false, class: 'is-mono', 'aria-describedby': describedBy, value });
    field.addEventListener('input', () => {
      report(null);
      field.setAttribute('aria-invalid', 'false');
      later(field.value);
    });
    field.addEventListener('change', () => {
      later.cancel();
      commit(field.value);
    });
    return {
      el: field,
      get: () => field.value,
      set: (v) => {
        if (document.activeElement === field) return;
        field.value = String(v);
        report(null);
      },
      setDisabled: (disabled) => {
        field.disabled = disabled;
      },
      focus: () => field.focus(),
    };
  }

  function listControl(def, value, { id, describedBy, commit, later, report, options }) {
    const area = h('textarea', {
      id,
      rows: 7,
      spellcheck: false,
      class: 'is-mono',
      placeholder: options.placeholder,
      'aria-describedby': describedBy,
      value: (value ?? []).join('\n'),
    });
    const parse = () => AP.ui.parseLines(area.value, { regex: options.regexLines === true });
    // Returns the items when the text is good to save, otherwise shows what is wrong and returns null.
    const check = () => {
      const { items, errors } = parse();
      const problems = [...errors, ...(options.validateLines?.(items) ?? [])];
      area.setAttribute('aria-invalid', problems.length > 0 ? 'true' : 'false');
      if (problems.length === 0) {
        report(null);
        return items;
      }
      report(problems.map((p) => `Line ${p.line}: ${p.message}`).join('\n'));
      return null;
    };
    area.addEventListener('input', () => {
      const items = check();
      if (items) later(items);
      else later.cancel();
    });
    area.addEventListener('change', () => {
      later.cancel();
      const items = check();
      if (items) commit(items);
    });
    return {
      el: area,
      get: () => parse().items,
      set: (v) => {
        if (deepEqual(parse().items, v ?? [])) return; // our own save coming back: leave the text as typed
        if (document.activeElement === area) return;
        area.value = (v ?? []).join('\n');
        check();
      },
      setDisabled: (disabled) => {
        area.disabled = disabled;
      },
      focus: () => area.focus(),
    };
  }

  function checksControl(def, value, { id, describedBy, labelledBy, commit }) {
    const boxes = def.options.map((o) => h('input', { type: 'checkbox', value: o.value, checked: (value ?? []).includes(o.value) }));
    const selected = () => def.options.filter((o, i) => boxes[i].checked).map((o) => o.value);
    for (const box of boxes) box.addEventListener('change', () => commit(selected()));
    const el = h(
      'fieldset',
      { class: 'checks', id, role: 'group', 'aria-labelledby': labelledBy, 'aria-describedby': describedBy },
      def.options.map((o, i) => h('label', { class: 'check' }, boxes[i], h('span', null, o.label))),
    );
    return {
      el,
      get: selected,
      set: (v) => boxes.forEach((box) => (box.checked = (v ?? []).includes(box.value))),
      setDisabled: (disabled) => boxes.forEach((box) => (box.disabled = disabled)),
      focus: () => boxes[0]?.focus(),
    };
  }

  /** Objects and lists of objects: raw JSON. A stopgap that keeps every setting reachable. */
  function jsonControl(def, value, { id, describedBy, commit, later, report }) {
    const area = h('textarea', { id, rows: 9, spellcheck: false, class: 'is-mono', 'aria-describedby': describedBy });
    const text = (v) => JSON.stringify(v, null, 2);
    area.value = text(value);
    const parse = () => {
      try {
        return { ok: true, value: JSON.parse(area.value) };
      } catch (err) {
        return { ok: false, message: `Not valid JSON: ${String(err?.message ?? err)}` };
      }
    };
    area.addEventListener('input', () => {
      const result = parse();
      if (result.ok) {
        area.setAttribute('aria-invalid', 'false');
        report(null);
        later(result.value);
      } else {
        later.cancel();
      }
    });
    area.addEventListener('change', () => {
      later.cancel();
      const result = parse();
      area.setAttribute('aria-invalid', result.ok ? 'false' : 'true');
      if (result.ok) commit(result.value);
      else report(result.message);
    });
    return {
      el: area,
      get: () => parse().value,
      set: (v) => {
        const current = parse();
        if (current.ok && deepEqual(current.value, v)) return;
        if (document.activeElement === area) return;
        area.value = text(v);
        report(null);
      },
      setDisabled: (disabled) => {
        area.disabled = disabled;
      },
      focus: () => area.focus(),
    };
  }

  // ---------------------------------------------------------------------------------------
  // Host access banner (PLAN risk R2)
  // ---------------------------------------------------------------------------------------

  /**
   * A banner that shows itself only while the browser has not granted access to the sites At
   * Peace works on (users can revoke it in about:addons). The button asks for it; permissions.request
   * has to be called straight from the click handler, which is why there is no await before it.
   * @returns {HTMLElement}
   */
  function hostAccessBanner() {
    const origins = AP.api.runtime.getManifest().host_permissions ?? [];
    const refresh = async () => {
      try {
        banner.hidden = origins.length === 0 || (await AP.api.permissions.contains({ origins }));
      } catch {
        banner.hidden = true;
      }
    };
    const banner = h(
      'div',
      { class: 'banner', role: 'region', 'aria-label': 'Access to YouTube', hidden: true },
      h('p', null, 'At Peace needs access to youtube.com.'),
      h(
        'button',
        {
          type: 'button',
          class: 'btn',
          onClick: () => {
            AP.api.permissions.request({ origins }).then(refresh, refresh);
          },
        },
        'Grant access',
      ),
    );
    refresh();
    for (const event of [AP.api.permissions.onAdded, AP.api.permissions.onRemoved]) event?.addListener(refresh);
    return banner;
  }

  // ---------------------------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------------------------

  /** The shortcut a manifest command suggests on this platform. */
  function suggestedKey(spec, os) {
    const keys = spec?.suggested_key ?? {};
    const byOs = { mac: keys.mac, win: keys.windows, linux: keys.linux, cros: keys.chromeos, android: keys.android };
    return byOs[os] ?? keys.default ?? '';
  }

  let shortcutsPromise = null;

  /**
   * The extension's keyboard shortcuts as they are assigned right now (commands.getAll(): the person
   * may have changed or cleared one; the manifest's suggestion for this platform when that cannot be
   * read), written for the platform: "⌥⇧P" on a Mac, "Alt+Shift+P" elsewhere. Read once per page.
   * @returns {Promise<{ os: string, raw: (name: string) => string, text: (name: string) => string, keys: (name: string) => string[] }>}
   */
  function loadShortcuts() {
    shortcutsPromise ??= (async () => {
      let os = 'other';
      try {
        os = (await AP.api.runtime.getPlatformInfo())?.os ?? os;
      } catch {
        /* notation falls back to the plain one */
      }
      const assigned = {};
      for (const [name, spec] of Object.entries(AP.api.runtime.getManifest().commands ?? {})) assigned[name] = suggestedKey(spec, os);
      try {
        for (const command of (await AP.api.commands?.getAll?.()) ?? []) if (command.name in assigned) assigned[command.name] = command.shortcut ?? '';
      } catch {
        /* the suggestions will do */
      }
      return {
        os,
        raw: (name) => assigned[name] ?? '',
        text: (name) => ui.formatShortcut(assigned[name], os),
        keys: (name) => ui.shortcutKeys(assigned[name], os),
      };
    })();
    return shortcutsPromise;
  }

  /** Where the person changes shortcuts, in one line (shown wherever shortcuts are listed). */
  const SHORTCUTS_HELP = 'Change shortcuts: about:addons → ⚙ → Manage Extension Shortcuts';

  // ---------------------------------------------------------------------------------------
  // The preset applied or saved last (so "Update" can be offered once settings drift from it)
  // ---------------------------------------------------------------------------------------

  const LAST_PRESET_KEY = 'at-peace-last-preset';

  /** Remembered in this browser's page storage, which every extension page shares. A convenience only. */
  const lastPreset = {
    get() {
      try {
        return localStorage.getItem(LAST_PRESET_KEY) || null;
      } catch {
        return null;
      }
    },
    set(id) {
      try {
        if (id) localStorage.setItem(LAST_PRESET_KEY, id);
        else localStorage.removeItem(LAST_PRESET_KEY);
      } catch {
        /* the offer simply does not appear */
      }
    },
  };

  // ---------------------------------------------------------------------------------------
  // Opening the settings page
  // ---------------------------------------------------------------------------------------

  /**
   * Opens the settings page, at one row (`{ setting: id }`) or one section (`{ section: id }`). A
   * settings tab that is already open is reused: its address gets the new #hash, which the page
   * follows, and the tab and its window come forward (where the browser lets an extension see its
   * own tabs' addresses, as Firefox does; elsewhere a new tab opens). Without a target it is
   * runtime.openOptionsPage().
   * @param {{ setting?: string, section?: string }} [target]
   */
  async function openSettings(target = {}) {
    const hash = target.setting ? `#setting=${encodeURIComponent(target.setting)}` : target.section ? `#section=${encodeURIComponent(target.section)}` : '';
    if (hash === '') {
      await AP.api.runtime.openOptionsPage();
      return;
    }
    const base = AP.api.runtime.getURL(AP.api.runtime.getManifest().options_ui?.page ?? 'src/pages/options/options.html');
    try {
      // Firefox shows the address of the extension's own tabs; a browser that hides it finds none and gets a new tab.
      const [open] = await AP.api.tabs.query({ url: `${base}*` });
      if (open) {
        await AP.api.tabs.update(open.id, { url: base + hash, active: true });
        await AP.api.windows?.update?.(open.windowId, { focused: true });
      } else {
        await AP.api.tabs.create({ url: base + hash });
      }
    } catch (err) {
      AP.warn('could not open the settings at a row; opening them plainly', err);
      await AP.api.runtime.openOptionsPage();
    }
  }

  Object.assign(ui, { h, dial, applyTheme, watchTheme, toast, openDialog, confirm, prompt, settingControl, controlKind, hostAccessBanner, loadShortcuts, SHORTCUTS_HELP, openSettings, lastPreset });
})();
