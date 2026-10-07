// Custom editor for `advanced.customRules`: the elements the person hid with the picker (Phase 4a,
// Contract C1; the picker itself is src/content/picker.js). Each rule is one line you can read:
// what you called it, the selector in mono, where it applies, and a delete that can be undone.
// Power users can add a selector by hand; it is held to the same rules the picker follows:
// exactly one valid selector, no text-based tricks, never the page frame, never something so
// generic that it matches half the page.
//
// The editor saves the whole list through ctx.save() (the schema re-validates it). Rows that the
// schema would drop (hand-edited storage, an old version) are not shown and not resurrected.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;
  AP.optionsRenderers ??= {};

  const ROOT_CLASS = 'custom-rules';
  const MAX_RULES = 500;
  const UNDO_MS = 9000;

  /**
   * The YouTube page types a rule can be limited to (the options page does not load the site's
   * page.js, so the list lives here; tests/unit/picker.test.mjs checks it against AP.yt.page.TYPES).
   */
  const PAGES = Object.freeze([
    { value: 'home', label: 'Home page' },
    { value: 'watch', label: 'Watch pages' },
    { value: 'search', label: 'Search results' },
    { value: 'shorts', label: 'Shorts' },
    { value: 'subscriptions', label: 'Subscriptions' },
    { value: 'channel', label: 'Channel pages' },
    { value: 'playlist', label: 'Playlist pages' },
    { value: 'history', label: 'History' },
    { value: 'you', label: 'You (library)' },
    { value: 'hashtag', label: 'Hashtag pages' },
    { value: 'other', label: 'Other pages' },
  ]);

  const pageLabel = (page) => PAGES.find((p) => p.value === page)?.label ?? page;

  // ---------------------------------------------------------------------------------------
  // The rules a typed-in selector must pass. Mirrors AP.picker.selector.refuseSelectorText in
  // src/content/picker.js (that file is a content script and is not loaded here; the unit tests
  // run both against the same list).
  // ---------------------------------------------------------------------------------------

  const PROTECTED_TAGS = new Set(['html', 'body', 'ytd-app', 'ytd-page-manager']);

  /** Last compound of a complex selector ("a > b.c" → "b.c"), ignoring combinators inside () and []. */
  function lastCompound(part) {
    let depth = 0;
    let quote = null;
    let start = 0;
    for (let i = 0; i < part.length; i++) {
      const ch = part[i];
      if (quote) {
        if (ch === '\\') i++;
        else if (ch === quote) quote = null;
        continue;
      }
      if (ch === '\\') {
        i++;
      } else if (ch === '"' || ch === "'") {
        quote = ch;
      } else if (ch === '(' || ch === '[') {
        depth++;
      } else if (ch === ')' || ch === ']') {
        depth = Math.max(0, depth - 1);
      } else if (depth === 0 && (ch === ' ' || ch === '>' || ch === '+' || ch === '~' || ch === '\t' || ch === '\n')) {
        start = i + 1;
      }
    }
    return part.slice(start).trim();
  }

  function refuseSelectorText(selector) {
    const compound = lastCompound(String(selector).trim());
    if (compound === '') return 'That is not a selector.';
    const head = (compound.match(/^(?:\*|[a-zA-Z][a-zA-Z0-9-]*)/)?.[0] ?? '').toLowerCase();
    if (compound.startsWith(':root') || PROTECTED_TAGS.has(head) || /^#(?:content|page-manager)(?![\w-])/.test(compound)) {
      return 'That is the page itself, so it is left alone. Pick something inside it.';
    }
    const withoutArgs = compound.replace(/\([^)]*\)/g, '');
    if (!/[#.[]/.test(withoutArgs) && !head.includes('-')) {
      return 'That would match far too much (every plain element of that kind). Add a class, an id or a component name.';
    }
    return null;
  }

  /**
   * Checks a typed-in selector. `validate` is how the browser decides whether it parses (default:
   * `document.querySelector` in a try/catch, which throws on a bad selector).
   * @param {string} text
   * @param {(selector: string) => void} [probe]
   * @returns {{ ok: true, selector: string } | { ok: false, message: string }}
   */
  function checkSelector(text, probe) {
    const selector = String(text ?? '').trim().replace(/\s+/g, ' ');
    if (selector === '') return { ok: false, message: 'Type a selector first, for example ytd-merch-shelf-renderer.' };
    if (AP.schema.splitSelectorList(selector).length > 1) {
      return { ok: false, message: 'Please add one selector at a time (a comma would make it two).' };
    }
    try {
      (probe ?? ((s) => document.querySelector(s)))(selector);
    } catch {
      return { ok: false, message: 'That is not a valid selector.' };
    }
    if (!AP.schema.isSafeSelector(selector)) return { ok: false, message: 'That selector has characters that cannot be used here (braces, semicolons or comments).' };
    const refusal = refuseSelectorText(selector);
    if (refusal) return { ok: false, message: refusal };
    return { ok: true, selector };
  }

  const dateText = (ms) => {
    if (!Number.isFinite(ms) || ms <= 0) return '';
    try {
      return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  };

  // ---------------------------------------------------------------------------------------
  // The editor
  // ---------------------------------------------------------------------------------------

  const renderer = {
    PAGES,
    checkSelector,
    refuseSelectorText,

    render(def, value, ctx) {
      const { h } = ctx;
      /** @type {object[]} */
      let rules = Array.isArray(value) ? value.map((r) => ({ ...r })) : [];
      /** The last deleted rule and where it was, for Undo. */
      let removed = null;
      let undoTimer = null;

      const list = h('ul', { class: 'rule-list', 'aria-label': def.label });
      const pickerKeys = h('span', { class: 'picker-keys' });
      const empty = h(
        'div',
        { class: 'empty' },
        h('p', null, 'Nothing hidden by hand.'),
        h('p', null, 'On YouTube, choose “Hide an element” in the popup', pickerKeys, '.'),
      );
      // The shortcut as it is assigned in this browser, written for this platform.
      ctx.ui?.loadShortcuts?.().then((shortcuts) => {
        const text = shortcuts.text('open-picker');
        pickerKeys.textContent = text ? `, or press ${text}` : '';
      }, () => {});
      const undoBar = h('div', { class: 'undo', role: 'status', hidden: true });
      const problem = h('p', { class: 'field-error', role: 'alert', hidden: true });
      const showProblem = (message) => {
        problem.textContent = message ?? '';
        problem.hidden = !message;
      };

      // --- saving -----------------------------------------------------------------------
      let saving = Promise.resolve();
      /** Saves `next` as the list; on failure shows why and keeps what is on screen. */
      const commit = (next, { toast, redraw = false } = {}) => {
        const run = async () => {
          try {
            await ctx.save(next);
            rules = next;
            showProblem(null);
            if (toast) ctx.toast(toast);
            if (redraw) draw();
            return true;
          } catch (err) {
            showProblem(err?.message ?? 'Could not save.');
            draw();
            return false;
          }
        };
        saving = saving.then(run, run);
        return saving;
      };

      // --- the rows ---------------------------------------------------------------------
      const scopeSelect = (page, label, onChange) => {
        const select = h('select', { 'aria-label': label });
        select.append(h('option', { value: '' }, 'Everywhere'));
        for (const p of PAGES) select.append(h('option', { value: p.value }, p.label));
        if (page && !PAGES.some((p) => p.value === page)) select.append(h('option', { value: page }, `${page} pages`));
        select.value = page ?? '';
        select.addEventListener('change', () => onChange(select.value === '' ? null : select.value));
        return h('span', { class: 'select' }, select);
      };

      const row = (rule) => {
        const note = h('input', {
          type: 'text',
          class: 'rule-note',
          value: rule.note ?? '',
          maxlength: 200,
          placeholder: 'Add a note so you remember what this was',
          'aria-label': `Note for ${rule.selector}`,
        });
        note.addEventListener('change', () => {
          const text = note.value.trim().slice(0, 200);
          if (text === (rule.note ?? '')) return;
          commit(rules.map((r) => (r.id === rule.id ? { ...r, note: text } : r)));
        });
        const scope = scopeSelect(rule.page ?? null, `Where "${rule.note || rule.selector}" applies`, (page) => {
          commit(rules.map((r) => (r.id === rule.id ? { ...r, page } : r)));
        });
        const del = h('button', { type: 'button', class: 'btn btn-quiet btn-danger rule-delete', 'aria-label': `Remove ${rule.note || rule.selector}` }, 'Remove');
        del.addEventListener('click', async () => {
          const at = rules.findIndex((r) => r.id === rule.id);
          if (at === -1) return;
          if (await commit(rules.filter((r) => r.id !== rule.id), { redraw: true })) offerUndo(rule, at);
        });
        const meta = [rule.page ? pageLabel(rule.page) : 'Everywhere', dateText(rule.createdAt)].filter(Boolean).join(' · ');
        return h(
          'li',
          { class: 'rule', dataset: { id: rule.id } },
          note,
          scope,
          del,
          h('code', { class: 'rule-selector' }, rule.selector),
          h('span', { class: 'rule-meta' }, meta),
        );
      };

      function offerUndo(rule, index) {
        removed = { rule, index };
        clearTimeout(undoTimer);
        const label = rule.note || rule.selector;
        const undo = h('button', { type: 'button', class: 'btn btn-quiet' }, 'Undo');
        undo.addEventListener('click', async () => {
          const back = removed;
          if (!back) return;
          const next = rules.slice();
          next.splice(Math.min(back.index, next.length), 0, back.rule);
          if (await commit(next, { redraw: true })) clearUndo();
        });
        undoBar.replaceChildren(`Removed “${label.length > 48 ? `${label.slice(0, 47)}…` : label}”.`, undo);
        undoBar.hidden = false;
        undoTimer = setTimeout(clearUndo, UNDO_MS);
      }

      function clearUndo() {
        clearTimeout(undoTimer);
        removed = null;
        undoBar.hidden = true;
        undoBar.replaceChildren();
      }

      function draw() {
        list.replaceChildren(...rules.map((rule) => row(rule)));
        list.hidden = rules.length === 0;
        empty.hidden = rules.length > 0;
      }

      // --- add by hand ------------------------------------------------------------------
      const adderSelector = h('input', {
        type: 'text',
        class: 'adder-selector',
        placeholder: 'ytd-merch-shelf-renderer',
        autocomplete: 'off',
        spellcheck: false,
        'aria-label': 'CSS selector to hide',
      });
      const adderNote = h('input', { type: 'text', class: 'adder-note', maxlength: 200, placeholder: 'Note (optional)', 'aria-label': 'Note' });
      let adderPage = null;
      const adderScope = scopeSelect(null, 'Where it applies', (page) => {
        adderPage = page;
      });
      const adderAdd = h('button', { type: 'button', class: 'btn adder-add' }, 'Hide it');
      const onAdd = async () => {
        const checked = checkSelector(adderSelector.value);
        if (!checked.ok) {
          showProblem(checked.message);
          return;
        }
        if (rules.length >= MAX_RULES) {
          showProblem(`You already hide ${MAX_RULES} things. Remove some first.`);
          return;
        }
        if (rules.some((r) => r.selector === checked.selector && (r.page ?? null) === adderPage)) {
          showProblem('That one is already in the list.');
          return;
        }
        const rule = {
          id: AP.util.uid('rule'),
          selector: checked.selector,
          page: adderPage,
          note: adderNote.value.trim().slice(0, 200) || 'Added by hand',
          createdAt: Date.now(),
        };
        clearUndo();
        if (await commit([...rules, rule], { toast: 'Added', redraw: true })) {
          adderSelector.value = '';
          adderNote.value = '';
        }
      };
      adderAdd.addEventListener('click', onAdd);
      adderSelector.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') onAdd();
      });
      adderSelector.addEventListener('input', () => showProblem(null));

      const adder = h(
        'details',
        { class: 'adder' },
        h('summary', null, 'Add a selector by hand'),
        h('div', { class: 'adder-body' }, adderSelector, adderNote, adderScope, adderAdd),
      );

      const root = h('div', { class: ROOT_CLASS, id: ctx.inputId }, empty, list, undoBar, adder, problem);
      root.apply = (next) => {
        rules = Array.isArray(next) ? next.map((r) => ({ ...r })) : [];
        draw();
      };
      draw();
      return root;
    },

    update(el, value) {
      if (typeof el?.apply !== 'function') return false;
      // Do not pull the rug from under a field that is being typed in.
      if (el.contains(document.activeElement) && document.activeElement?.matches?.('input[type="text"]')) return true;
      el.apply(value);
      return true;
    },
  };

  AP.optionsRenderers['advanced.customRules'] = renderer;
})();
