// A full-page note drawn over a site we do not own (PLAN §8.3: "Your 15 minutes are up.").
//
//   AP.overlay.show({ title, body, actions: [{ label, primary?, onClick }], theme? })   → { hide }
//   AP.overlay.hide()
//   AP.overlay.isShown()
//
// It lives in a CLOSED shadow root under a host element on <html> (a sibling of <body>), so the
// page's CSS cannot reach in and ours cannot leak out. The stylesheet is a constructed one
// (adoptedStyleSheets), which no page CSP can block; a <style> element is the fallback.
//
// It is a modal: the page behind it (<body>) is made `inert`, Tab cycles inside, keys never reach
// the page's own shortcuts (Space must not start the video), and Escape deliberately does nothing
// — the only ways out are the actions the caller offers. If the page removes the host, it comes
// back. The look is the indigo world of the pause page: the page dimmed, one indigo card with a
// small dial (an amber ring, a mint dot), a title and two buttons (a `body` line is possible; the
// session-expiry overlay uses none). It looks the same in
// both themes, so `theme` is accepted (callers pass it) and not needed.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;

  const HOST_ATTR = 'data-at-peace-overlay';

  const CSS = `
:host { all: initial; }
.scrim {
  position: fixed; inset: 0; box-sizing: border-box; display: flex; align-items: center; justify-content: center;
  padding: 16px; background: rgb(11 12 58 / 0.72); color: #F2F3FF;
  font: 16px/1.5 system-ui, -apple-system, "Segoe UI", "Noto Sans", sans-serif;
  -webkit-font-smoothing: antialiased; opacity: 0; transition: opacity 320ms cubic-bezier(0.2, 0.7, 0.2, 1);
}
.scrim.is-in { opacity: 1; }
.card { box-sizing: border-box; width: min(520px, 100%); display: flex; gap: 24px; align-items: flex-start; padding: 32px; border-radius: 16px; background: #16186F; }
.glyph { flex: none; width: 72px; height: 72px; }
.text { min-width: 0; }
h2 { margin: 0; font-size: 26px; font-weight: 700; line-height: 1.2; letter-spacing: -0.01em; }
p { margin: 8px 0 0; color: #C9CBF2; font-size: 15px; line-height: 1.5; }
.actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; }
button {
  font: inherit; font-size: 15px; font-weight: 600; min-height: 44px; padding: 0 18px; border-radius: 10px; cursor: pointer;
  border: 1px solid #4A4EA8; background: transparent; color: #F2F3FF;
  transition: background-color 160ms cubic-bezier(0.2, 0.7, 0.2, 1), border-color 160ms cubic-bezier(0.2, 0.7, 0.2, 1);
}
button:hover:not(:disabled) { background: #22257F; border-color: #7479CC; }
button.primary { padding: 0 20px; border-color: #3FF1C0; background: #3FF1C0; color: #0B0C3A; font-weight: 700; }
button.primary:hover:not(:disabled) { background: #3FF1C0; border-color: #3FF1C0; opacity: 0.9; }
button:disabled { opacity: 0.55; cursor: default; }
button:focus-visible { outline: 2px solid #3FF1C0; outline-offset: 2px; }
@media (max-width: 520px) { .card { flex-direction: column; gap: 16px; padding: 24px; } }
@media (prefers-reduced-motion: reduce) { .scrim, button { transition: none; } }
`;

  /** The dial glyph: a quiet ring, an amber arc nearly all the way round, a mint dot. Built as SVG nodes (no HTML strings). */
  function dialGlyph() {
    const NS = 'http://www.w3.org/2000/svg';
    const node = (tag, attrs) => {
      const n = document.createElementNS(NS, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      return n;
    };
    const svg = node('svg', { class: 'glyph', viewBox: '0 0 72 72', 'aria-hidden': 'true' });
    svg.append(
      node('circle', { cx: 36, cy: 36, r: 32, fill: 'none', stroke: '#4A4EA8', 'stroke-width': 3 }),
      node('path', { d: 'M36 4 A32 32 0 1 1 35.9 4', fill: 'none', stroke: '#EC921F', 'stroke-width': 3, 'stroke-linecap': 'round' }),
      node('circle', { cx: 36, cy: 36, r: 10, fill: '#3FF1C0' }),
    );
    return svg;
  }

  /** @type {{ host: HTMLElement, root: ShadowRoot, scrim: HTMLElement, watch: MutationObserver|null, restore: () => void } | null} */
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

  /**
   * @typedef {Object} OverlayAction
   * @property {string} label
   * @property {boolean} [primary]
   * @property {() => (void|Promise<void>)} onClick   may be async; the button is disabled meanwhile
   */

  /**
   * Shows the overlay (replacing one that is already up).
   * @param {{ title: string, body?: string, actions?: OverlayAction[], theme?: string }} spec (`theme` is ignored: the overlay is the same in both themes)
   * @returns {{ hide: () => void }}
   */
  function show({ title, body = '', actions = [] }) {
    hide();

    const host = document.createElement('div');
    host.setAttribute(HOST_ATTR, title); // the closed shadow root hides the text; the title is also a handle for tests
    for (const [prop, value] of [['all', 'initial'], ['position', 'fixed'], ['inset', '0'], ['z-index', '2147483647'], ['display', 'block']]) {
      host.style.setProperty(prop, value, 'important');
    }
    const root = host.attachShadow({ mode: 'closed' });
    adoptStyles(root);

    const titleEl = el('h2', '', title);
    titleEl.id = 'ap-title';
    const bodyEl = body ? el('p', '', body) : null;
    if (bodyEl) bodyEl.id = 'ap-body';
    const buttons = actions.map((action) => {
      const button = el('button', action.primary ? 'primary' : '', action.label);
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
    });
    const text = el('div', 'text');
    text.append(titleEl);
    if (bodyEl) text.append(bodyEl);
    const actionsEl = el('div', 'actions');
    actionsEl.append(...buttons);
    text.append(actionsEl);
    const card = el('div', 'card');
    card.append(dialGlyph(), text);

    const scrim = el('div', 'scrim');
    scrim.setAttribute('role', 'alertdialog');
    scrim.setAttribute('aria-modal', 'true');
    scrim.setAttribute('aria-labelledby', 'ap-title');
    if (bodyEl) scrim.setAttribute('aria-describedby', 'ap-body');
    scrim.tabIndex = -1;
    scrim.append(card);
    root.append(scrim);

    // Keys: never to the page; Tab stays inside; Escape is swallowed on purpose.
    const onKey = (event) => {
      event.stopPropagation();
      if (event.type !== 'keydown') return;
      if (event.key === 'Escape') {
        event.preventDefault();
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

    current = { host, root, scrim, watch, restore };
    // Next frame: transition from transparent, then focus the primary action.
    requestAnimationFrame(() => {
      scrim.classList.add('is-in');
      (buttons.find((b) => b.classList.contains('primary')) ?? buttons[0] ?? scrim).focus();
    });
    return { hide };
  }

  /** Removes the overlay and gives the page back. */
  function hide() {
    if (!current) return;
    const { host, watch, restore } = current;
    current = null;
    watch?.disconnect();
    restore();
    host.remove();
  }

  /** @returns {boolean} */
  const isShown = () => current !== null;

  AP.overlay = { show, hide, isShown };
})();
