// A full-page note drawn over a site we do not own (PLAN §8.3: "Your 15 minutes are up").
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
// back. The design is the pause page's: linen paper, one persimmon dot on a horizon line.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;

  const HOST_ATTR = 'data-at-peace-overlay';

  const PALETTE_LIGHT = '--paper:#F3EEE3;--paper-2:#EAE2D1;--ink:#1B2050;--ink-2:#5E5A55;--rule:#B9C4D3;--edge:#757A8A;--clay:#8E7266;--seal:#E5600F;';
  const PALETTE_DARK = '--paper:#14162B;--paper-2:#1C1F3A;--ink:#E9E3D6;--ink-2:#A8A3B8;--rule:#33385C;--edge:#6F74A0;--clay:#B79E91;--seal:#F47A2E;';

  const CSS = `
:host { all: initial; }
.scrim {
  ${PALETTE_LIGHT}
  position: fixed; inset: 0; box-sizing: border-box; display: flex; align-items: center;
  padding: 28px 7vw 28px 38vw; background: var(--paper); color: var(--ink);
  font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif;
  -webkit-font-smoothing: antialiased; opacity: 0; transition: opacity 320ms cubic-bezier(0.2, 0.7, 0.2, 1);
}
.scrim.is-in { opacity: 1; }
.scrim[data-theme="dark"] { ${PALETTE_DARK} }
@media (prefers-color-scheme: dark) { .scrim[data-theme="system"] { ${PALETTE_DARK} } }
.sheet { width: min(460px, 100%); }
.brand { position: absolute; top: 28px; left: 7vw; display: flex; align-items: center; gap: 9px; color: var(--ink-2); font: 600 15px/1 "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Charter, Georgia, serif; letter-spacing: 0.02em; }
.dot { width: 10px; height: 10px; border-radius: 50%; background: var(--seal); flex: none; }
.horizon { position: relative; box-sizing: border-box; width: 100vw; height: 101px; margin: 0 0 28px -38vw; padding-left: 38vw; border-bottom: 1px solid var(--rule); }
.horizon .sun { position: absolute; left: 38vw; bottom: -1px; width: 100px; height: 100px; border-radius: 50%; background: var(--seal); }
h2 { margin: 0 0 8px; font: 400 clamp(26px, 3.3vw, 32px)/1.25 "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Charter, Georgia, serif; }
p { margin: 0; color: var(--ink-2); max-width: 36ch; }
.actions { display: flex; flex-wrap: wrap; gap: 14px; margin-top: 28px; }
button {
  font: inherit; font-size: 15px; min-height: 40px; padding: 6px 20px; border-radius: 3px; cursor: pointer;
  border: 1px solid var(--edge); background: transparent; color: var(--ink);
  transition: background-color 200ms cubic-bezier(0.2, 0.7, 0.2, 1), border-color 200ms cubic-bezier(0.2, 0.7, 0.2, 1);
}
button:hover:not(:disabled) { background: var(--paper-2); border-color: var(--ink); }
button.primary { background: var(--ink); border-color: var(--ink); color: var(--paper); }
button.primary:hover:not(:disabled) { background: var(--ink); opacity: 0.88; }
button:disabled { opacity: 0.55; cursor: default; }
button:focus-visible { outline: 2px solid var(--clay); outline-offset: 2px; }
@media (max-width: 720px) { .scrim { padding: 28px 7vw; } .horizon { margin-left: -7vw; padding-left: 7vw; } .horizon .sun { left: 7vw; } }
@media (prefers-reduced-motion: reduce) { .scrim { transition: none; } }
`;

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
   * @param {{ title: string, body?: string, actions?: OverlayAction[], theme?: 'light'|'dark'|'system' }} spec
   * @returns {{ hide: () => void }}
   */
  function show({ title, body = '', actions = [], theme = 'light' }) {
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
    const sheet = el('div', 'sheet');
    sheet.append(titleEl);
    if (bodyEl) sheet.append(bodyEl);
    sheet.append(el('div', 'actions'));
    sheet.lastChild.append(...buttons);
    const horizon = el('div', 'horizon');
    horizon.append(el('span', 'sun'));
    horizon.setAttribute('aria-hidden', 'true');
    sheet.prepend(horizon);

    const brand = el('div', 'brand');
    brand.append(el('span', 'dot'), el('span', '', 'At Peace'));
    const scrim = el('div', 'scrim');
    scrim.dataset.theme = theme === 'dark' || theme === 'system' ? theme : 'light';
    scrim.setAttribute('role', 'alertdialog');
    scrim.setAttribute('aria-modal', 'true');
    scrim.setAttribute('aria-labelledby', 'ap-title');
    if (bodyEl) scrim.setAttribute('aria-describedby', 'ap-body');
    scrim.tabIndex = -1;
    scrim.append(brand, sheet);
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
