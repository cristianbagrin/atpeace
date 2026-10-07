// The popup's Focus tab: block YouTube for a while (and end a block early, through the friction
// the person chose), the Mindful Pause switches that matter day to day, schedules and the daily
// limit, and today's three numbers. Everything that can be shown from storage is shown from storage;
// what only the background knows (schedules, the limit) arrives with GET_STATUS and may never come.
import { buildInlineRow, buildEditRow } from './rows.js';

const AP = globalThis.AtPeace;
const { h } = AP.ui;
const T = AP.msg.TYPES;

const SITE = 'youtube';
const FOCUS_CHOICES = [
  { label: '25 min', payload: { minutes: 25 } },
  { label: '1 h', payload: { minutes: 60 } },
  { label: '4 h', payload: { minutes: 240 } },
  { label: 'Rest of day', payload: { untilEndOfDay: true } },
];
const WAIT_SECONDS = 30;
const REASONS = { schedule: 'A scheduled block', limit: 'Daily limit reached' };

/** "25m", "1h 05m", "<1m": the short form for a tile. */
function compactDuration(sec) {
  const s = Math.max(0, Number(sec) || 0);
  if (s === 0) return '0m';
  if (s < 30) return '<1m';
  const minutes = Math.max(1, Math.round(s / 60));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${String(rest).padStart(2, '0')}m`;
}

/**
 * @param {object} ctx popup context (see popup.js): state, track, save, send, askToUnlock, openSettings, shortcutTitle
 * @returns {{ el: HTMLElement, render: () => void, renderToday: () => void }}
 */
export function buildFocusView(ctx) {
  const { state } = ctx;
  /** Set while the person is on the way to ending a block early: { mode, startedAt }. */
  let friction = null;
  let focusNote = null;
  let tickTimer = null;

  const focus = h('section', { class: 'block focus-block', 'aria-label': 'Focus' });
  const today = h('section', { class: 'today-block', 'aria-label': 'Today', hidden: true });

  const activeBlock = () => (state.status.block && state.status.block.until > Date.now() ? state.status.block : null);

  // --- starting and ending a block ------------------------------------------------------------

  async function startFocus(payload) {
    focusNote = null;
    const res = await ctx.send(T.FOCUS_START, payload);
    if (res?.ok) {
      state.status = { ...state.status, block: res.block ?? state.status.block };
      await ctx.refreshStatus({ askBackground: false });
    } else {
      focusNote = 'Could not start the block.';
      render();
    }
  }

  async function sendEnd(payload) {
    const res = await ctx.send(T.FOCUS_END, payload);
    if (res?.ok) {
      friction = null;
      focusNote = null;
      state.status = { ...state.status, block: null };
      render();
      ctx.refreshStatus({ askBackground: false });
      return;
    }
    if (res?.error === 'strict') {
      friction = null;
      focusNote = 'This block cannot be ended early.';
    } else if (res?.error === 'locked') {
      friction = null;
      ctx.askToUnlock('Locked.');
    } else if (res?.error === 'friction-required') {
      const mode = state.values['focus.unlockFriction'];
      friction = { mode: mode === 'phrase' ? 'phrase' : 'wait', startedAt: Date.now() };
    } else {
      focusNote = 'Could not end the block.';
    }
    render();
  }

  function endEarly() {
    focusNote = null;
    if (state.values['focus.strict'] === true) {
      focusNote = 'This block cannot be ended early.';
      render();
      return;
    }
    if (state.lock.locked) {
      ctx.askToUnlock('Locked.');
      return;
    }
    const mode = state.values['focus.unlockFriction'];
    if (mode === 'wait' || mode === 'phrase') {
      friction = { mode, startedAt: Date.now() };
      render();
      focus.querySelector('input, button.btn-primary, button')?.focus();
    } else {
      sendEnd({});
    }
  }

  function frictionView() {
    const cancel = h(
      'button',
      {
        type: 'button',
        class: 'btn btn-quiet',
        onClick: () => {
          friction = null;
          render();
        },
      },
      'Keep going',
    );
    const end = h('button', { type: 'button', class: 'btn', disabled: true, onClick: () => sendEnd({ frictionDone: true }) }, 'End block');
    end.dataset.role = 'end';
    const actions = h('div', { class: 'friction-actions' }, end, cancel);

    if (friction.mode === 'phrase') {
      const input = h('input', { type: 'text', id: 'phrase', autocomplete: 'off', spellcheck: false, 'aria-describedby': 'phrase-help' });
      input.addEventListener('input', () => {
        end.disabled = !AP.ui.phraseMatches(input.value);
      });
      input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !end.disabled) end.click();
      });
      return h('div', { class: 'friction' }, h('label', { class: 'note', for: 'phrase', id: 'phrase-help' }, 'Type this sentence:'), h('p', { class: 'mono' }, AP.ui.FOCUS_PHRASE), input, actions);
    }
    const note = h('p', { class: 'note', 'data-role': 'wait-note' });
    const view = h('div', { class: 'friction' }, note, actions);
    updateWait(note, end);
    return view;
  }

  /** Updates the wait countdown text and enables the End button when it is over. */
  function updateWait(note, end) {
    const left = Math.max(0, WAIT_SECONDS - Math.floor((Date.now() - friction.startedAt) / 1000));
    note.textContent = left > 0 ? `You can end the block in ${left} s.` : 'You can end the block now.';
    end.disabled = left > 0;
  }

  function render() {
    const block = activeBlock();
    const children = [h('h2', { class: 'block-title' }, block ? 'Focus' : 'Block YouTube for')];

    if (!block) {
      friction = null;
      children.push(
        h(
          'div',
          { class: 'focus-buttons' },
          FOCUS_CHOICES.map((choice, i) => {
            const button = h('button', { type: 'button', class: 'btn', onClick: () => startFocus(choice.payload) }, choice.label);
            if (i === 0) ctx.shortcutTitle(button, 'focus-25', choice.label); // the keyboard shortcut starts this one
            return button;
          }),
        ),
      );
      const schedule = state.status.activeSchedules?.[0];
      const line = focusNote ?? (schedule ? `${schedule.name ? `“${schedule.name}”` : 'A schedule'} until ${AP.ui.formatTimeOfDay(schedule.endsAt)}.` : null);
      if (line) children.push(h('p', { class: ['note', focusNote && 'is-error'] }, line));
    } else {
      children.push(
        h(
          'div',
          { class: 'count' },
          h('span', { class: 'count-clock mono', 'data-role': 'clock' }, AP.ui.formatClock((block.until - Date.now()) / 1000)),
          h('span', { class: 'count-until' }, `until ${AP.ui.formatTimeOfDay(block.until)}`),
        ),
      );
      if (block.reason && block.reason !== 'focus') children.push(h('p', { class: 'note' }, REASONS[block.reason] ?? 'Blocked'));
      if (friction) children.push(frictionView());
      else if (state.values['focus.strict'] === true) children.push(h('p', { class: 'note' }, 'No early exit.'));
      else {
        children.push(h('p', null, h('button', { type: 'button', class: 'btn btn-quiet', onClick: endEarly }, 'End early')));
        if (focusNote) children.push(h('p', { class: 'note is-error' }, focusNote));
      }
    }
    focus.replaceChildren(...children);
    ensureTick();
  }

  /** One timer for the countdown, the wait step and the end of the block. */
  function ensureTick() {
    const needed = activeBlock() !== null;
    if (needed && tickTimer === null) tickTimer = setInterval(tick, 1000);
    if (!needed && tickTimer !== null) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
  }

  function tick() {
    const block = activeBlock();
    if (!block) {
      render();
      return;
    }
    const clock = focus.querySelector('[data-role="clock"]');
    if (clock) clock.textContent = AP.ui.formatClock((block.until - Date.now()) / 1000);
    const note = focus.querySelector('[data-role="wait-note"]');
    const end = focus.querySelector('[data-role="end"]');
    if (friction?.mode === 'wait' && note && end) updateWait(note, end);
  }

  // --- today ------------------------------------------------------------------------------------

  function renderToday() {
    const c = state.status.today?.[SITE] ?? {};
    const activeSec = Number(c.activeSec) || 0;
    const opens = Number(c.opens) || 0;
    const turnedBack = Number(c.turnedBack) || 0;
    const limit = state.status.limit;
    const hasLimit = limit && Number(limit.dailyMinutes) > 0;
    today.hidden = !(activeSec > 0 || opens > 0 || turnedBack > 0 || hasLimit);
    if (today.hidden) return;

    const tile = (value, label, positive = false) =>
      h('div', { class: 'stat' }, h('div', { class: ['stat-value', positive && 'is-positive'] }, value), h('div', { class: 'stat-label' }, label));
    today.replaceChildren(
      ...[
        h('div', { class: 'stats', role: 'group', 'aria-label': 'Today' }, tile(compactDuration(activeSec), 'on YouTube'), tile(String(opens), opens === 1 ? 'open' : 'opens'), tile(String(turnedBack), 'turned back', true)),
        hasLimit && h('p', { class: 'note limit-note' }, `${Math.min(Math.round((Number(limit.usedSec) || 0) / 60), 9999)} of ${limit.dailyMinutes} min used`),
      ].filter(Boolean),
    );
  }

  // --- the rows ----------------------------------------------------------------------------------

  const inline = (id, label) => {
    const def = AP.schema.get(id);
    return def ? buildInlineRow(ctx, def, { label }).el : null;
  };
  const edit = (id, label) => {
    const def = AP.schema.get(id);
    return def ? buildEditRow(ctx, { label, target: { setting: id }, def }).el : null;
  };
  const panel = (title, rows) => {
    const made = rows.filter(Boolean);
    return made.length > 0 ? h('section', { class: 'ledger-group' }, h('h3', { class: 'caps ledger-title' }, title), h('div', { class: 'ledger' }, made)) : null;
  };

  const el = h(
    'div',
    { class: 'view focus-view' },
    focus,
    panel('Mindful Pause', [
      inline('pause.enabled', 'Pause before opening'),
      inline('pause.breathSeconds', 'Breath length'),
      inline('pause.sessionMinutes', 'Keep open for'),
      edit('pause.sites', 'Pause sites'),
    ]),
    panel('Limits', [edit('focus.schedules', 'Schedules'), inline('focus.dailyMinutes', 'Daily limit')]),
    today,
  );

  render();
  renderToday();
  ctx.refreshRequires();
  return { el, render, renderToday };
}
