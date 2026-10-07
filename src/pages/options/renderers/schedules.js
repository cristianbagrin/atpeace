// Custom editor for `focus.schedules`: weekly times when a site is closed, or when a preset is
// applied (Contract C1). Each schedule has a name, days, a start and an end (an end before the
// start runs past midnight), what it does, and an on/off switch.
//
// The editor keeps a draft. Every change is validated first and only a valid list is saved: the
// schema silently drops schedules that cannot work, which would make a half-edited row vanish, so
// a row with a problem shows its problem inline and waits until it is fixed.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;
  AP.optionsRenderers ??= {};

  const ROOT_CLASS = 'schedules';
  /** Monday first, the way a week reads; values are Date#getDay() numbers. */
  const WEEK = Object.freeze([
    { value: 1, short: 'Mon', long: 'Monday' },
    { value: 2, short: 'Tue', long: 'Tuesday' },
    { value: 3, short: 'Wed', long: 'Wednesday' },
    { value: 4, short: 'Thu', long: 'Thursday' },
    { value: 5, short: 'Fri', long: 'Friday' },
    { value: 6, short: 'Sat', long: 'Saturday' },
    { value: 0, short: 'Sun', long: 'Sunday' },
  ]);
  const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
  const MAX_SCHEDULES = 30;

  /**
   * What is wrong with one schedule (as the editor holds it), or null.
   * @param {{ days: number[], start: string, end: string, siteKeys?: string[], action: string }} s
   * @returns {string|null}
   */
  function problemWith(s) {
    if (!Array.isArray(s.days) || s.days.length === 0) return 'Choose at least one day.';
    if (!TIME_RE.test(s.start) || !TIME_RE.test(s.end)) return 'Pick a start and an end time.';
    if (s.start === s.end) return 'The start and the end cannot be the same time.';
    if (s.action === 'block' && Array.isArray(s.siteKeys) && s.siteKeys.length === 0) return 'Choose at least one site to close.';
    return null;
  }

  /** "Closed 09:00 to 17:30 on Mon, Tue, Wed" in words, for the screen-reader label of a row. */
  function summary(s) {
    const days = WEEK.filter((d) => s.days.includes(d.value)).map((d) => d.short);
    const span = s.end < s.start ? `${s.start} to ${s.end} the next morning` : `${s.start} to ${s.end}`;
    return `${span}, ${days.length === 7 ? 'every day' : days.join(', ')}`;
  }

  /** A fresh schedule that is valid as it stands: Mon–Fri, 09:00–17:00, close YouTube. */
  function newSchedule(index) {
    return {
      id: AP.util.uid('sch'),
      name: index === 0 ? 'Work hours' : `Schedule ${index + 1}`,
      days: [1, 2, 3, 4, 5],
      start: '09:00',
      end: '17:00',
      action: 'block',
      siteKeys: ['youtube'],
      enabled: true,
    };
  }

  /** Every preset a schedule can apply: the built-in ones, then the person's own. */
  async function presetChoices() {
    const choices = AP.presets.builtIn().map((p) => ({ id: p.id, name: p.name }));
    try {
      for (const p of await AP.settings.listCustomPresets()) choices.push({ id: p.id, name: p.name });
    } catch {
      /* custom presets unavailable: the built-in ones still work */
    }
    return choices;
  }

  /** The sites a schedule can close: YouTube plus every site on the pause list. */
  async function siteChoices() {
    const sites = [{ siteKey: 'youtube', label: 'YouTube' }];
    try {
      const settings = await AP.settings.effective();
      for (const s of settings['pause.sites'] ?? []) if (s.siteKey !== 'youtube') sites.push({ siteKey: s.siteKey, label: s.domain });
    } catch {
      /* YouTube only */
    }
    return sites;
  }

  const renderer = {
    problemWith,
    summary,
    newSchedule,

    render(def, value, ctx) {
      const { h } = ctx;
      let draft = Array.isArray(value) ? value.map((s) => ({ ...s, days: [...s.days], siteKeys: [...(s.siteKeys ?? ['youtube'])] })) : [];
      let presets = AP.presets.builtIn().map((p) => ({ id: p.id, name: p.name }));
      let sites = [{ siteKey: 'youtube', label: 'YouTube' }];
      let problems = new Map(); // schedule id → text

      const globalError = h('p', { class: 'field-error', role: 'alert', hidden: true });
      const body = h('div', { class: 'sched-list' });
      const addButton = h('button', { type: 'button', class: 'btn add' }, 'Add a schedule');
      // (ctx.inputId is not put on the button: a <label for> would then rename it "Weekly schedules".)
      const root = h('div', { class: ROOT_CLASS, role: 'group', 'aria-label': def.label }, body, addButton, globalError);

      /** What gets stored: only what the schema keeps. */
      const clean = (s) => ({
        id: s.id,
        name: s.name.trim().slice(0, 80),
        days: [...s.days].sort((a, b) => a - b),
        start: s.start,
        end: s.end,
        action: s.action,
        siteKeys: s.siteKeys.length > 0 ? s.siteKeys : ['youtube'],
        enabled: s.enabled !== false,
      });

      /** Validate everything, show problems, save when all is well. */
      const commit = async () => {
        problems = new Map(draft.map((s) => [s.id, problemWith(s)]).filter(([, p]) => p));
        draw();
        if (problems.size > 0) return;
        try {
          await ctx.save(draft.map(clean));
          globalError.hidden = true;
        } catch (err) {
          globalError.textContent = String(err?.message ?? '') || 'Could not save.';
          globalError.hidden = false;
        }
      };

      const actionOptions = (s) => {
        const options = [h('option', { value: 'block' }, 'Close the site')];
        const known = new Set();
        for (const p of presets) {
          known.add(`preset:${p.id}`);
          options.push(h('option', { value: `preset:${p.id}` }, `Apply preset: ${p.name}`));
        }
        // A schedule that points at a preset that is gone still shows what it says.
        if (s.action !== 'block' && !known.has(s.action)) options.push(h('option', { value: s.action }, 'Apply preset: (deleted preset)'));
        return options;
      };

      const card = (s, index) => {
        const label = s.name.trim() || `Schedule ${index + 1}`;
        const name = h('input', { type: 'text', maxlength: 80, value: s.name, placeholder: 'Name', 'aria-label': `Name of schedule ${index + 1}`, autocomplete: 'off' });
        name.addEventListener('input', () => {
          s.name = name.value;
        });
        name.addEventListener('change', commit);

        const enabled = h('input', { type: 'checkbox', class: 'switch', role: 'switch', checked: s.enabled !== false, 'aria-label': `${label} is on` });
        enabled.addEventListener('change', () => {
          s.enabled = enabled.checked;
          commit();
        });

        const remove = h('button', { type: 'button', class: 'btn btn-quiet btn-danger', 'aria-label': `Remove ${label}` }, 'Remove');
        remove.addEventListener('click', () => {
          draft = draft.filter((x) => x.id !== s.id);
          commit();
        });

        const days = h(
          'div',
          { class: 'days', role: 'group', 'aria-label': `Days for ${label}` },
          WEEK.map((d) => {
            const on = s.days.includes(d.value);
            const button = h('button', { type: 'button', class: 'day', 'aria-pressed': String(on), 'aria-label': d.long }, d.short);
            button.addEventListener('click', () => {
              s.days = s.days.includes(d.value) ? s.days.filter((v) => v !== d.value) : [...s.days, d.value];
              commit();
            });
            return button;
          }),
        );

        const time = (field, text) => {
          const input = h('input', { type: 'time', value: s[field], required: true, 'aria-label': `${text} time for ${label}` });
          input.addEventListener('change', () => {
            s[field] = input.value;
            commit();
          });
          return input;
        };

        const action = h('select', { 'aria-label': `What ${label} does`, value: s.action }, actionOptions(s));
        action.addEventListener('change', () => {
          s.action = action.value;
          commit();
        });

        const lines = [
          h('div', { class: 'line' }, h('span', { class: 'caps' }, 'Days'), days),
          h('div', { class: 'line' }, h('span', { class: 'caps' }, 'Time'), time('start', 'Start'), 'to', time('end', 'End'), s.end < s.start && TIME_RE.test(s.end) ? h('span', { class: 'field-help' }, 'until the next morning') : null),
          h('div', { class: 'line' }, h('span', { class: 'caps' }, 'Does'), h('span', { class: 'select' }, action)),
        ];
        if (s.action === 'block' && sites.length > 1) {
          lines.push(
            h(
              'div',
              { class: 'line' },
              h('span', { class: 'caps' }, 'Sites'),
              h(
                'div',
                { class: 'days', role: 'group', 'aria-label': `Sites ${label} closes` },
                sites.map((site) => {
                  const on = s.siteKeys.includes(site.siteKey);
                  const button = h('button', { type: 'button', class: 'day is-site', 'aria-pressed': String(on) }, site.label);
                  button.addEventListener('click', () => {
                    s.siteKeys = on ? s.siteKeys.filter((k) => k !== site.siteKey) : [...s.siteKeys, site.siteKey];
                    commit();
                  });
                  return button;
                }),
              ),
            ),
          );
        }

        const problem = problems.get(s.id);
        return h(
          'section',
          { class: ['sched', s.enabled === false && 'is-off'], 'aria-label': `${label}: ${summary(s)}` },
          h('div', { class: 'sched-head' }, name, enabled, remove),
          h('div', { class: 'sched-body' }, lines),
          problem ? h('p', { class: 'sched-error', role: 'alert' }, `${problem} It will be saved once this is fixed.`) : null,
        );
      };

      function draw() {
        const focused = document.activeElement;
        const path = focused && root.contains(focused) ? focused.getAttribute('aria-label') : null;
        const children = draft.map(card);
        if (draft.length === 0) children.push(h('p', { class: 'empty' }, 'No schedules yet.'));
        body.replaceChildren(...children);
        addButton.disabled = draft.length >= MAX_SCHEDULES;
        // Keep the keyboard where it was after a redraw.
        if (path) [...body.querySelectorAll('[aria-label]')].find((el) => el.getAttribute('aria-label') === path)?.focus();
      }

      addButton.addEventListener('click', () => {
        draft.push(newSchedule(draft.length));
        commit();
        body.querySelector('.sched:last-of-type input[type="text"]')?.focus();
      });

      root.apply = (next) => {
        const incoming = Array.isArray(next) ? next : [];
        // Our own save coming back: leave the editor as it is.
        if (problems.size === 0 && AP.util.deepEqual(draft.map(clean), incoming)) return;
        draft = incoming.map((s) => ({ ...s, days: [...s.days], siteKeys: [...(s.siteKeys ?? ['youtube'])] }));
        problems = new Map();
        draw();
      };

      draw();
      // Preset and site names arrive asynchronously; the rows are redrawn when they do.
      Promise.all([presetChoices(), siteChoices()]).then(([p, s]) => {
        presets = p;
        sites = s;
        draw();
      });
      return root;
    },

    update(el, value) {
      if (typeof el?.apply !== 'function') return false;
      el.apply(value);
      return true;
    },
  };

  AP.optionsRenderers['focus.schedules'] = renderer;
})();
