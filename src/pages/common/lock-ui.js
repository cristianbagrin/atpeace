// The calm face of the settings lock (Phase 4b), shared by the options page, the popup and the
// blocked page. Classic script; adds to AP.ui. Load after components.js. The rules themselves live
// in src/shared/lock.js; the background does the verifying (LOCK_UNLOCK).
//
//   AP.ui.unlockForm(status, { onDone, onCancel })   the unlock steps, to place anywhere (dialog or inline)
//   AP.ui.requestUnlock(status?)                      the same inside a dialog → Promise<boolean>
//   AP.ui.ensureUnlocked()                            true when there is no lock, or it was just opened
//   AP.ui.lockBar({ onUnlock? })                      the quiet line "Locked … [Unlock]" / "Unlocked until … [Lock now]"
//   AP.ui.lockedMessage                               the sentence for a refused change
(() => {
  'use strict';
  const AP = globalThis.AtPeace;
  const ui = (AP.ui ??= {});
  const { h } = ui;
  const T = AP.msg.TYPES;

  const LOCKED_MESSAGE = 'Locked. Showing something again needs an unlock first.';
  let counter = 0;

  const send = async (type, payload) => {
    try {
      return await AP.msg.send(type, payload);
    } catch (err) {
      AP.warn(`${type} failed`, err);
      return { ok: false, error: 'failed' };
    }
  };

  const minutesText = () => `${Math.round(AP.lock.UNLOCK_MS / 60_000)} minutes`;

  /**
   * The steps that open the lock, as pieces the caller places: `body` (text and fields) and
   * `actions` (Cancel, Unlock).
   *   password  one field; the background checks it against the stored hash.
   *   friction  the sentence is shown, but the field only opens after `waitSeconds` of waiting;
   *             then the sentence has to be typed.
   * Resolves through `onDone(response)` (unlocked) or `onCancel()`. `destroy()` stops the timer.
   * @param {{ mode: string, waitSeconds: number }} status
   * @param {{ onDone: (res: object) => void, onCancel: () => void }} handlers
   * @returns {{ body: HTMLElement, actions: HTMLElement[], initial: HTMLElement, focus: () => void, destroy: () => void }}
   */
  function unlockForm(status, { onDone, onCancel }) {
    const id = `unlock-${++counter}`;
    const error = h('p', { class: 'unlock-error', role: 'alert', hidden: true });
    const unlockBtn = h('button', { type: 'button', class: 'btn btn-primary' }, 'Unlock');
    const cancelBtn = h('button', { type: 'button', class: 'btn', onClick: () => onCancel() }, 'Cancel');
    let busy = false;
    let timer = null;
    let field;
    let body;

    const attempt = async (payload, onFail) => {
      if (busy) return;
      busy = true;
      unlockBtn.disabled = true;
      error.hidden = true;
      const res = await send(T.LOCK_UNLOCK, payload);
      busy = false;
      if (res?.ok) {
        onDone(res);
        return;
      }
      unlockBtn.disabled = false;
      error.textContent =
        res?.error === 'wrong-password' ? 'That is not the password.' : 'That did not work. Close this and try again in a moment.';
      error.hidden = false;
      onFail?.(res);
    };

    if (status.mode === 'password') {
      field = h('input', { type: 'password', id: `${id}-field`, autocomplete: 'off', spellcheck: false, 'aria-describedby': `${id}-lead`, 'aria-label': 'Password' });
      const submit = () => {
        if (field.value === '') return;
        attempt({ password: field.value }, () => {
          field.select();
        });
      };
      unlockBtn.addEventListener('click', submit);
      field.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        submit();
      });
      body = h(
        'div',
        { class: 'unlock' },
        h('p', { class: 'unlock-lead', id: `${id}-lead` }, `Enter your password to change settings for the next ${minutesText()}.`),
        h('div', { class: 'unlock-field' }, field),
        error,
      );
      return { body, actions: [cancelBtn, unlockBtn], initial: field, focus: () => field.focus(), destroy: () => {} };
    }

    // Friction: wait, then type the sentence.
    const sentence = AP.lock.pickSentence();
    const waitSeconds = status.waitSeconds ?? AP.lock.DEFAULT_WAIT_SECONDS;
    const startedAt = Date.now();
    const wait = h('p', { class: 'unlock-wait', role: 'timer', 'aria-live': 'off' });
    field = h('input', {
      type: 'text',
      id: `${id}-field`,
      autocomplete: 'off',
      spellcheck: false,
      disabled: true,
      placeholder: 'Type it here',
      'aria-label': 'Type the sentence above',
      'aria-describedby': `${id}-sentence ${id}-wait`,
    });
    wait.id = `${id}-wait`;
    unlockBtn.disabled = true;

    const matches = () => ui.phraseMatches(field.value, sentence);
    const tick = () => {
      const left = Math.max(0, waitSeconds - Math.floor((Date.now() - startedAt) / 1000));
      if (left > 0) {
        wait.textContent = `Take a breath. You can type it in ${left} s.`;
        return;
      }
      clearInterval(timer);
      timer = null;
      wait.textContent = 'Now type the sentence above.';
      field.disabled = false;
      field.focus();
      unlockBtn.disabled = !matches();
    };
    const submit = () => {
      if (!field.disabled && matches()) attempt({ frictionDone: true });
    };
    field.addEventListener('input', () => {
      unlockBtn.disabled = field.disabled || busy || !matches();
    });
    field.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      submit();
    });
    unlockBtn.addEventListener('click', submit);
    tick();
    timer = setInterval(tick, 500);

    body = h(
      'div',
      { class: 'unlock' },
      h('p', { class: 'unlock-lead' }, 'Showing something again is a choice. Take a moment, then type this:'),
      h('p', { class: 'unlock-sentence', id: `${id}-sentence` }, sentence),
      wait,
      h('div', { class: 'unlock-field' }, field),
      error,
    );
    return {
      body,
      actions: [cancelBtn, unlockBtn],
      initial: cancelBtn,
      focus: () => (field.disabled ? cancelBtn : field).focus(),
      destroy: () => clearInterval(timer),
    };
  }

  /**
   * Asks for the unlock in a dialog. Resolves true when the lock is open afterwards (also when it
   * was already open or there is no lock), false when the person cancels.
   * @param {Awaited<ReturnType<typeof AP.lock.read>>} [status] pass what you already know, to skip a read
   * @returns {Promise<boolean>}
   */
  async function requestUnlock(status) {
    const current = status ?? (await AP.lock.read());
    if (!current.locked) return true;
    const close = (value) => form.actions[0].closest('dialog')?.close(value);
    const form = unlockForm(current, { onDone: () => close('unlocked'), onCancel: () => close('cancel') });
    const { returnValue } = await ui.openDialog({ title: 'Unlock settings', body: [form.body], actions: form.actions, initialFocus: form.initial });
    form.destroy(); // Escape closes the dialog too, with nothing to clean up but the timer
    if (returnValue === 'unlocked') ui.toast(`Unlocked for ${minutesText()}`);
    return returnValue === 'unlocked';
  }

  /** True when no lock is holding; otherwise opens the unlock dialog and says whether it worked. */
  async function ensureUnlocked() {
    return requestUnlock();
  }

  /**
   * A quiet line about the lock. Hidden while there is no lock. While locked: what it means and an
   * Unlock button; while unlocked: until when, and a Lock now button. Feed it `update(status)`
   * (from AP.lock.watch). `say(text)` shows a one-off sentence (a refused change) until the next update.
   * @param {{ onUnlock?: () => void, compact?: boolean }} [options] onUnlock replaces the dialog (the popup unlocks inline)
   * @returns {{ el: HTMLElement, update: (status: object) => void, say: (text: string) => void, focusUnlock: () => void }}
   */
  function lockBar({ onUnlock, compact = false } = {}) {
    const text = h('p', { class: 'lock-text' });
    const button = h('button', { type: 'button', class: 'btn btn-quiet lock-button' });
    const el = h('div', { class: ['lock-bar', compact && 'is-compact'], role: 'status', hidden: true }, text, button);
    let current = null;

    const render = (message) => {
      if (!current || current.mode === 'none') {
        el.hidden = true;
        return;
      }
      el.hidden = false;
      el.dataset.state = current.locked ? 'locked' : 'open';
      if (current.locked) {
        text.textContent = message ?? 'Locked. Making YouTube quieter works as usual; showing anything again asks you to unlock first.';
        button.textContent = 'Unlock…';
      } else {
        text.textContent = `Unlocked until ${ui.formatTimeOfDay(current.unlockedUntil)}.`;
        button.textContent = 'Lock now';
      }
    };

    button.addEventListener('click', async () => {
      if (!current) return;
      if (!current.locked) {
        await send(T.LOCK_RELOCK);
        return;
      }
      if (onUnlock) onUnlock();
      else await requestUnlock(current);
    });

    return {
      el,
      update(status) {
        current = status;
        render();
      },
      say(message) {
        render(message);
      },
      focusUnlock: () => button.focus(),
    };
  }

  Object.assign(ui, { unlockForm, requestUnlock, ensureUnlocked, lockBar, lockedMessage: LOCKED_MESSAGE });
})();
