// A full-page note drawn over a site we do not own (PLAN §8.3: "Your 15 minutes are up.").
//
//   AP.overlay.show(spec)  → { hide }   shows it, or re-draws it IN PLACE when it is already up
//   AP.overlay.hide()
//   AP.overlay.isShown()
//   AP.overlay.view()                   'note' | 'breath' | 'choice' | null
//
// spec = {
//   view?: 'note' (default) | 'breath' | 'choice',
//   title, body?, kicker?,
//   actions?: [{ label, primary?, onClick }],      the buttons (onClick may be async: the button waits)
//   hint?: string,                                 a small line under the buttons ("Esc: finish this video")
//   onEscape?: () => void,                         what Escape does; without it Escape does nothing
//   // 'breath': the pause page's breath, in the card: a mint disc in the dial, "Breathe in…" / "…and out"
//   seconds?: number, onBreathDone?: () => void,
//   // 'choice': "Continue for [5 min] [10 min] …" next to the actions
//   minutes?: [{ value, label }], selected?: string, continueLabel?: string, onContinue?: (value) => void|Promise,
//   note?: string,                                 a short problem line (role=status)
//   theme?: string                                 accepted and ignored: the overlay looks the same in both themes
// }
//
// It lives in a CLOSED shadow root under a host element on <html> (a sibling of <body>), so the
// page's CSS cannot reach in and ours cannot leak out. The stylesheet is a constructed one
// (adoptedStyleSheets), which no page CSP can block; a <style> element is the fallback.
//
// It is a modal: the page behind it (<body>) is made `inert`, Tab cycles inside, and keys never reach
// the page's own shortcuts (Space must not start the video). Escape does what `onEscape` says, nothing
// when the caller gave none. If the page removes the host, it comes back. The look is the indigo world
// of the pause page: the page dimmed, one indigo card with a small dial (an amber ring, a mint dot), a
// title and the buttons. Breathing in place uses the pause page's own timing (src/shared/breath.js)
// and the sixty-tick dial; with prefers-reduced-motion the disc only fades and a countdown shows.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;

  const HOST_ATTR = 'data-at-peace-overlay';
  const VIEW_ATTR = 'data-at-peace-view';

  const CSS = `
:host { all: initial; }
.scrim {
  position: fixed; inset: 0; box-sizing: border-box; display: flex; align-items: center; justify-content: center;
  padding: 16px; background: rgb(11 12 58 / 0.72); color: #F2F3FF;
  font: 16px/1.5 system-ui, -apple-system, "Segoe UI", "Noto Sans", sans-serif;
  -webkit-font-smoothing: antialiased; opacity: 0; transition: opacity 320ms cubic-bezier(0.2, 0.7, 0.2, 1);
}
.scrim.is-in { opacity: 1; }
.scrim:focus { outline: none; }
.card { box-sizing: border-box; width: min(680px, 100%); min-height: 200px; display: flex; gap: 24px; align-items: flex-start; padding: 32px; border-radius: 16px; background: #16186F; }
.card.is-breath { align-items: center; }
.glyph { flex: none; width: 72px; height: 72px; }
.dial { flex: none; position: relative; width: 112px; height: 112px; }
.dial svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.ticks { stroke: #7479CC; }
.is-choice .ticks { stroke: #3FF1C0; }
.sun { position: absolute; inset: 12.5%; border-radius: 50%; background: #3FF1C0; transform: scale(0.6); transform-origin: 50% 50%; will-change: transform, opacity; }
.text { min-width: 0; flex: 1 1 auto; }
.kicker { margin: 0 0 8px; color: #9EA3D8; font-size: 12px; font-weight: 600; letter-spacing: 0.08em; text-transform: uppercase; }
h2 { margin: 0; font-size: 26px; font-weight: 700; line-height: 1.2; letter-spacing: -0.01em; }
.guidance { transition: opacity 220ms cubic-bezier(0.2, 0.7, 0.2, 1); }
.guidance.is-fading { opacity: 0; }
p { margin: 8px 0 0; color: #C9CBF2; font-size: 15px; line-height: 1.5; }
.countdown { font-variant-numeric: tabular-nums; font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; }
.actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 18px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 12px; }
.hint { margin-top: 14px; color: #9EA3D8; font-size: 13px; }
.problem { color: #F5B14C; font-size: 14px; }
button {
  font: inherit; font-size: 15px; font-weight: 600; min-height: 44px; padding: 0 16px; border-radius: 10px; cursor: pointer;
  border: 1px solid #4A4EA8; background: transparent; color: #F2F3FF;
  transition: background-color 160ms cubic-bezier(0.2, 0.7, 0.2, 1), border-color 160ms cubic-bezier(0.2, 0.7, 0.2, 1);
}
button:hover:not(:disabled) { background: #22257F; border-color: #7479CC; }
button.primary { padding: 0 18px; border-color: #3FF1C0; background: #3FF1C0; color: #0B0C3A; font-weight: 700; }
button.primary:hover:not(:disabled) { background: #3FF1C0; border-color: #3FF1C0; opacity: 0.9; }
button.chip { min-height: 32px; min-width: 44px; padding: 0 10px; border-color: transparent; color: #9EA3D8; font-size: 13px; font-weight: 500; }
button.chip:hover:not(:disabled) { background: transparent; color: #F2F3FF; }
button.chip[aria-pressed="true"] { border-color: #4A4EA8; background: #22257F; color: #F2F3FF; }
button:disabled { opacity: 0.55; cursor: default; }
button:focus-visible { outline: 2px solid #3FF1C0; outline-offset: 2px; }
@media (max-width: 680px) { .card { flex-direction: column; gap: 16px; padding: 24px; min-height: 0; } }
@media (prefers-reduced-motion: reduce) { .scrim, button, .guidance { transition: none; } }
`;

  const NS = 'http://www.w3.org/2000/svg';
  const svgNode = (tag, attrs) => {
    const n = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    return n;
  };

  /** The dial glyph: a quiet ring, an amber arc nearly all the way round, a mint dot. Built as SVG nodes (no HTML strings). */
  function dialGlyph() {
    const svg = svgNode('svg', { class: 'glyph', viewBox: '0 0 72 72', 'aria-hidden': 'true' });
    svg.append(
      svgNode('circle', { cx: 36, cy: 36, r: 32, fill: 'none', stroke: '#4A4EA8', 'stroke-width': 3 }),
      svgNode('path', { d: 'M36 4 A32 32 0 1 1 35.9 4', fill: 'none', stroke: '#EC921F', 'stroke-width': 3, 'stroke-linecap': 'round' }),
      svgNode('circle', { cx: 36, cy: 36, r: 10, fill: '#3FF1C0' }),
    );
    return svg;
  }

  /** The breathing dial: sixty ticks and the mint disc in the middle. */
  function breathDial() {
    const box = document.createElement('div');
    box.className = 'dial';
    box.setAttribute('aria-hidden', 'true');
    const svg = svgNode('svg', { viewBox: '0 0 320 320', focusable: 'false' });
    svg.append(svgNode('path', { class: 'ticks', d: AP.breath?.ticksPath?.() ?? '', fill: 'none', 'stroke-width': 3, 'stroke-linecap': 'round' }));
    const sun = document.createElement('div');
    sun.className = 'sun';
    box.append(svg, sun);
    return { box, sun };
  }

  /**
   * @typedef {Object} OverlayAction
   * @property {string} label
   * @property {boolean} [primary]
   * @property {() => (void|Promise<void>)} onClick   may be async; the button is disabled meanwhile
   */

  /** @type {{ host: HTMLElement, root: ShadowRoot, scrim: HTMLElement, card: HTMLElement, watch: MutationObserver|null, restore: () => void, spec: object, view: string, stopBreath: () => void } | null} */
  let current = null;

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  function adoptStyles(root) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      root.adoptedStyleSheets = [sheet];
      return;
    } catch {
      /* constructed sheets unavailable: fall through to a <style> element */
    }
    const style = document.createElement('style');
    style.textContent = CSS;
    root.append(style);
  }

  /** The buttons inside the scrim that can take focus right now. */
  const focusables = (scrim) => [...scrim.querySelectorAll('button:not(:disabled)')];

  /** A button that waits for its async action and never throws into the page. */
  function actionButton(action, className = '') {
    const button = el('button', [action.primary ? 'primary' : '', className].filter(Boolean).join(' '), action.label);
    button.type = 'button';
    button.addEventListener('click', async () => {
      button.disabled = true;
      try {
        await action.onClick();
      } catch (err) {
        AP.warn('overlay action failed', err);
      } finally {
        if (button.isConnected) button.disabled = false;
      }
    });
    return button;
  }

  const formatClock = (seconds) => {
    const s = Math.max(0, Math.ceil(seconds));
    return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  };

  // ---------------------------------------------------------------------------------------
  // The breath (same timing and look as the pause page)
  // ---------------------------------------------------------------------------------------

  /**
   * Runs one breath on `sun`, updating `guidance` and, with reduced motion, `countdown`. Breathes only
   * while the page is looked at: a hidden tab waits, and a tab left mid-breath starts over.
   * @returns {() => void} stop
   */
  function runBreath({ seconds, sun, guidance, countdown, onDone }) {
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const total = Math.max(1, seconds) * 1000;
    const { cycles, half } = AP.breath.plan(seconds);
    let animation = null;
    let timers = [];
    let ticker = null;
    let finished = false;

    const clear = () => {
      for (const t of timers) clearTimeout(t);
      timers = [];
      clearInterval(ticker);
      ticker = null;
      animation?.cancel();
      animation = null;
    };

    const setGuidance = (text) => {
      guidance.classList.add('is-fading');
      timers.push(
        setTimeout(() => {
          guidance.textContent = text;
          guidance.classList.remove('is-fading');
        }, 200),
      );
    };

    const begin = () => {
      clear();
      guidance.textContent = AP.breath.guidance(0);
      guidance.classList.remove('is-fading');
      animation = sun.animate(AP.breath.frames(cycles, reduced), { duration: total, fill: 'forwards' });
      for (let i = 1; i < cycles * 2; i++) timers.push(setTimeout(() => setGuidance(AP.breath.guidance(i)), i * half));
      timers.push(
        setTimeout(() => {
          finished = true;
          clearInterval(ticker);
          ticker = null;
          for (const t of timers) clearTimeout(t);
          timers = [];
          countdown.hidden = true;
          off();
          onDone();
        }, total),
      );
      if (reduced) {
        const endsAt = Date.now() + total;
        countdown.hidden = false;
        const tick = () => {
          countdown.textContent = formatClock((endsAt - Date.now()) / 1000);
        };
        tick();
        ticker = setInterval(tick, 250);
      }
    };

    const onVisibility = () => {
      if (finished) return;
      if (document.visibilityState === 'visible') begin();
      else clear();
    };
    const off = () => document.removeEventListener('visibilitychange', onVisibility);
    document.addEventListener('visibilitychange', onVisibility);
    if (document.visibilityState === 'visible') begin();

    return () => {
      finished = true;
      off();
      clear();
    };
  }

  // ---------------------------------------------------------------------------------------
  // Drawing the card
  // ---------------------------------------------------------------------------------------

  /** Fills `card` for `spec`. Returns the buttons, the element that should get the focus and a stop function for anything running. */
  function draw(spec, card, scrim) {
    const view = spec.view === 'breath' || spec.view === 'choice' ? spec.view : 'note';
    card.className = `card is-${view}`;
    const text = el('div', 'text');
    let stopBreath = () => {};

    if (spec.kicker) text.append(el('p', 'kicker', spec.kicker));
    const titleEl = el('h2', view === 'breath' ? 'guidance' : '', spec.title);
    titleEl.id = 'ap-title';
    text.append(titleEl);
    const bodyEl = spec.body ? el('p', '', spec.body) : null;
    if (bodyEl) {
      bodyEl.id = 'ap-body';
      text.append(bodyEl);
    }

    let lead;
    let focusTarget = null;
    if (view === 'breath') {
      const { box, sun } = breathDial();
      lead = box;
      titleEl.setAttribute('aria-live', 'polite');
      const countdown = el('p', 'countdown');
      countdown.hidden = true;
      countdown.setAttribute('aria-hidden', 'true');
      text.append(countdown);
      stopBreath = runBreath({ seconds: spec.seconds ?? 6, sun, guidance: titleEl, countdown, onDone: () => spec.onBreathDone?.() });
    } else if (view === 'choice') {
      const { box, sun } = breathDial();
      sun.style.transform = 'scale(0.6)'; // resting, small, like the pause page after the breath
      lead = box;
    } else {
      lead = dialGlyph();
    }

    const buttons = [];
    if (view !== 'breath') {
      const actionsEl = el('div', 'actions');
      for (const action of spec.actions ?? []) {
        const button = actionButton(action);
        buttons.push(button);
        actionsEl.append(button);
      }
      if (view === 'choice' && typeof spec.onContinue === 'function') {
        const options = spec.minutes ?? [];
        let selected = String(spec.selected ?? options[0]?.value ?? '');
        const chipsEl = el('div', 'chips');
        chipsEl.setAttribute('role', 'group');
        chipsEl.setAttribute('aria-label', 'How long to keep it open');
        const chips = options.map((o) => {
          const chip = el('button', 'chip', o.label);
          chip.type = 'button';
          chip.dataset.value = String(o.value);
          chip.addEventListener('click', () => {
            selected = String(o.value);
            sync();
          });
          return chip;
        });
        const go = actionButton({ label: spec.continueLabel ?? 'Continue for', onClick: () => spec.onContinue(selected) });
        const sync = () => {
          for (const chip of chips) chip.setAttribute('aria-pressed', String(chip.dataset.value === selected));
          const chosen = options.find((o) => String(o.value) === selected);
          if (chosen) go.setAttribute('aria-label', `${spec.continueLabel ?? 'Continue for'} ${chosen.label}`);
        };
        sync();
        actionsEl.append(go);
        buttons.push(go);
        chipsEl.append(...chips);
        buttons.push(...chips);
        text.append(actionsEl, chipsEl);
      } else {
        text.append(actionsEl);
      }
      focusTarget = buttons.find((b) => b.classList.contains('primary')) ?? buttons[0] ?? null;
    }

    if (spec.note) {
      const note = el('p', 'problem', spec.note);
      note.setAttribute('role', 'status');
      text.append(note);
    }
    if (spec.hint) text.append(el('p', 'hint', spec.hint));

    card.replaceChildren(lead, text);
    scrim.setAttribute('aria-labelledby', 'ap-title');
    if (bodyEl) scrim.setAttribute('aria-describedby', 'ap-body');
    else scrim.removeAttribute('aria-describedby');
    return { view, focusTarget: focusTarget ?? scrim, stopBreath };
  }

  /**
   * Shows the overlay, or redraws it in place when one is already up (the page behind stays inert,
   * nothing flickers).
   * @param {Record<string, any>} spec see the header
   * @returns {{ hide: () => void }}
   */
  function show(spec) {
    if (current) {
      current.stopBreath();
      const drawn = draw(spec, current.card, current.scrim);
      current.spec = spec;
      current.view = drawn.view;
      current.stopBreath = drawn.stopBreath;
      current.host.setAttribute(HOST_ATTR, spec.title);
      current.host.setAttribute(VIEW_ATTR, drawn.view);
      drawn.focusTarget.focus({ preventScroll: true });
      return { hide };
    }

    const host = document.createElement('div');
    host.setAttribute(HOST_ATTR, spec.title); // the closed shadow root hides the text; the title is also a handle for tests
    host.setAttribute(VIEW_ATTR, spec.view ?? 'note');
    for (const [prop, value] of [['all', 'initial'], ['position', 'fixed'], ['inset', '0'], ['z-index', '2147483647'], ['display', 'block']]) {
      host.style.setProperty(prop, value, 'important');
    }
    const root = host.attachShadow({ mode: 'closed' });
    adoptStyles(root);

    const scrim = el('div', 'scrim');
    scrim.setAttribute('role', 'alertdialog');
    scrim.setAttribute('aria-modal', 'true');
    scrim.tabIndex = -1;
    const card = el('div', 'card');
    scrim.append(card);
    root.append(scrim);
    const drawn = draw(spec, card, scrim);

    // Keys: never to the page; Tab stays inside; Escape does what the caller said (nothing by default).
    const onKey = (event) => {
      event.stopPropagation();
      if (event.type !== 'keydown') return;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!event.repeat && typeof current?.spec.onEscape === 'function') {
          try {
            current.spec.onEscape();
          } catch (err) {
            AP.warn('overlay Escape failed', err);
          }
        }
      } else if (event.key === 'Tab') {
        const list = focusables(scrim);
        if (list.length === 0) {
          event.preventDefault();
          return;
        }
        const active = root.activeElement;
        const at = list.indexOf(active);
        const next = event.shiftKey ? list[(at <= 0 ? list.length : at) - 1] : list[(at + 1) % list.length];
        event.preventDefault();
        next.focus();
      }
    };
    for (const type of ['keydown', 'keyup', 'keypress']) host.addEventListener(type, onKey);

    // The page behind must not be reachable (or readable as the thing to interact with).
    const body_ = document.body;
    const wasInert = body_ ? body_.inert : false;
    if (body_) body_.inert = true;
    const restore = () => {
      if (body_ && !wasInert) body_.inert = false;
    };

    document.documentElement.append(host);
    // Come back if the page throws us out (SPA frameworks sometimes rebuild <html>'s children).
    let watch = null;
    if (typeof MutationObserver === 'function') {
      watch = new MutationObserver(() => {
        if (current && !current.host.isConnected) document.documentElement.append(current.host);
      });
      watch.observe(document.documentElement, { childList: true });
    }

    current = { host, root, scrim, card, watch, restore, spec, view: drawn.view, stopBreath: drawn.stopBreath };
    // Next frame: transition from transparent, then focus the primary action.
    requestAnimationFrame(() => {
      scrim.classList.add('is-in');
      if (current?.scrim === scrim) drawn.focusTarget.focus({ preventScroll: true });
    });
    return { hide };
  }

  /** Removes the overlay and gives the page back. */
  function hide() {
    if (!current) return;
    const { host, watch, restore, stopBreath } = current;
    current = null;
    stopBreath();
    watch?.disconnect();
    restore();
    host.remove();
  }

  /** @returns {boolean} */
  const isShown = () => current !== null;

  /** @returns {'note'|'breath'|'choice'|null} */
  const view = () => current?.view ?? null;

  AP.overlay = { show, hide, isShown, view };
})();
