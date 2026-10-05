// Custom editor for `advanced.lock`: set up, change or remove the settings lock (Phase 4b).
//
//   not set    two plain choices, a password or a moment of friction, and one button to turn it on
//   set        one line about what holds the settings, with "Change…" and "Remove lock…"
//
// Changing or removing an active lock needs the unlock first (the generic guard would refuse it
// anyway; asking up front is kinder). A new lock holds right away: after saving it the editor asks
// the background to relock. The password is hashed here (PBKDF2, src/shared/lock.js) and only the
// salted hash is saved.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;
  AP.optionsRenderers ??= {};
  const T = AP.msg.TYPES;

  const MODES = Object.freeze([
    { value: 'password', title: 'A password', text: 'You choose it. Only a salted hash is kept on this device, never the password. If you forget it, the only way back in is to reinstall At Peace.' },
    { value: 'friction', title: 'A moment of friction', text: 'No password to remember: you wait a little, then type a calm sentence.' },
  ]);

  const stateLine = (lock) => {
    if (lock.mode === 'password') return 'A password holds these settings.';
    if (lock.mode === 'friction') return `A moment of friction holds these settings: wait ${lock.waitSeconds ?? AP.lock.DEFAULT_WAIT_SECONDS} s, then type a sentence.`;
    return 'No lock is set. Anything can be changed freely.';
  };

  const lockEditor = {
    render(def, value, ctx) {
      const { h } = ctx;
      const root = h('div', { class: 'lock-editor' });
      const view = { lock: AP.schema.validateValue(def, value), editing: false, choice: 'password' };

      const error = h('p', { class: 'field-error', role: 'alert', hidden: true });
      const fail = (message, field) => {
        error.textContent = message;
        error.hidden = false;
        field?.focus();
        return false;
      };

      // ---- set: one line, two quiet actions ------------------------------------------------------
      const drawSummary = () => {
        const change = h(
          'button',
          {
            type: 'button',
            class: 'btn',
            id: ctx.inputId,
            'aria-describedby': ctx.describedBy,
            onClick: async () => {
              if (!(await AP.ui.requestUnlock())) return;
              view.choice = view.lock.mode;
              view.editing = true;
              draw();
            },
          },
          'Change…',
        );
        const remove = h(
          'button',
          {
            type: 'button',
            class: 'btn btn-danger',
            onClick: async () => {
              if (!(await AP.ui.requestUnlock())) return;
              const ok = await ctx.ui.confirm('Anything can be changed freely again. You can set a new lock whenever you like.', {
                title: 'Remove the lock?',
                confirmLabel: 'Remove lock',
                danger: true,
              });
              if (!ok) return;
              try {
                await ctx.save({ mode: 'none' });
              } catch (err) {
                ctx.toast(String(err?.message ?? 'That could not be saved.'));
                return;
              }
              view.lock = { mode: 'none' };
              draw();
              ctx.toast('Lock removed');
            },
          },
          'Remove lock…',
        );
        return [h('p', { class: 'lock-state' }, stateLine(view.lock)), h('div', { class: 'lock-actions' }, change, remove)];
      };

      // ---- not set / change: choose, fill in, turn on ------------------------------------------------
      const drawSetup = () => {
        const pw = h('input', { type: 'password', id: 'lock-password', autocomplete: 'new-password', spellcheck: false, 'aria-describedby': 'lock-pw-hint' });
        const again = h('input', { type: 'password', id: 'lock-password-again', autocomplete: 'new-password', spellcheck: false });
        const wait = h('input', { type: 'number', id: 'lock-wait', min: 10, max: 600, step: 1, inputmode: 'numeric', value: view.lock.waitSeconds ?? AP.lock.DEFAULT_WAIT_SECONDS });
        const turnOn = h('button', { type: 'button', class: 'btn btn-primary' }, view.lock.mode === 'none' ? 'Turn on the lock' : 'Save the new lock');

        const fields = h('div', { class: 'lock-fields' });
        const drawFields = () => {
          error.hidden = true;
          if (view.choice === 'password') {
            fields.replaceChildren(
              h('div', { class: 'lock-field' }, h('label', { for: 'lock-password' }, 'Password'), pw),
              h('div', { class: 'lock-field' }, h('label', { for: 'lock-password-again' }, 'Once more'), again),
              h('p', { class: 'row-hint', id: 'lock-pw-hint' }, `At least ${AP.lock.MIN_PASSWORD_LENGTH} characters.`),
            );
          } else {
            fields.replaceChildren(
              h(
                'div',
                { class: 'lock-field' },
                h('label', { for: 'lock-wait' }, 'Wait before the sentence'),
                h('span', { class: 'number-field' }, wait, h('span', { class: 'unit' }, 'seconds')),
              ),
              h('p', { class: 'row-hint' }, `Between ${AP.lock.MIN_WAIT_SECONDS} and ${AP.lock.MAX_WAIT_SECONDS}. The default is ${AP.lock.DEFAULT_WAIT_SECONDS}.`),
            );
          }
        };

        const choices = h(
          'fieldset',
          { class: 'lock-modes', role: 'radiogroup', 'aria-label': 'How the lock holds you back' },
          MODES.map((mode, index) =>
            h(
              'label',
              { class: 'lock-choice' },
              h('input', {
                type: 'radio',
                name: 'lock-mode',
                value: mode.value,
                id: index === 0 ? ctx.inputId : null,
                checked: view.choice === mode.value,
                onChange: () => {
                  view.choice = mode.value;
                  drawFields();
                },
              }),
              h('span', { class: 'lock-choice-text' }, h('span', { class: 'lock-choice-title' }, mode.title), h('span', { class: 'lock-choice-desc' }, mode.text)),
            ),
          ),
        );
        drawFields();

        turnOn.addEventListener('click', async () => {
          error.hidden = true;
          let lock;
          if (view.choice === 'password') {
            const problem = AP.lock.passwordProblem(pw.value);
            if (problem) return fail(problem, pw);
            if (pw.value !== again.value) return fail('The two passwords are not the same.', again);
            turnOn.disabled = true;
            try {
              lock = await AP.lock.createPasswordLock(pw.value);
            } catch (err) {
              turnOn.disabled = false;
              return fail(String(err?.message ?? 'That password could not be used.'));
            }
          } else {
            const check = AP.ui.numberCheck({ min: AP.lock.MIN_WAIT_SECONDS, max: AP.lock.MAX_WAIT_SECONDS }, wait.value);
            if (!check.ok) return fail(check.message, wait);
            lock = AP.lock.createFrictionLock(check.value);
          }
          try {
            await ctx.save(lock);
          } catch (err) {
            turnOn.disabled = false;
            return fail(String(err?.message ?? 'That could not be saved.'));
          }
          await AP.msg.send(T.LOCK_RELOCK).catch(() => {}); // a new lock holds from this moment on
          view.lock = lock;
          view.editing = false;
          draw();
          ctx.toast('The lock is on');
        });

        const actions = [turnOn];
        if (view.lock.mode !== 'none') {
          actions.push(
            h(
              'button',
              {
                type: 'button',
                class: 'btn btn-quiet',
                onClick: () => {
                  view.editing = false;
                  draw();
                },
              },
              'Cancel',
            ),
          );
        }
        return [h('p', { class: 'lock-state' }, 'How should these settings be held?'), choices, fields, error, h('div', { class: 'lock-actions' }, actions)];
      };

      function draw() {
        root.replaceChildren(...(view.lock.mode === 'none' || view.editing ? drawSetup() : drawSummary()));
      }

      /** The stored lock changed somewhere else (or by us): follow it, but never wipe what is being typed. */
      root.apply = (next) => {
        const lock = AP.schema.validateValue(def, next);
        if (JSON.stringify(lock) === JSON.stringify(view.lock)) return;
        view.lock = lock;
        view.editing = false;
        draw();
      };

      draw();
      return root;
    },

    update(el, value) {
      el.apply?.(value);
      return typeof el.apply === 'function';
    },
  };

  AP.optionsRenderers['advanced.lock'] = lockEditor;
})();
