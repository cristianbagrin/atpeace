// Home feed (yt.home.feedMode, yt.home.redirectUrl): what the home page does instead of showing the feed.
//
//   hide                                  a calm placeholder takes the feed's place (this file)
//   subscriptions | watchLater | playlists | custom
//                                         the home page redirects. Full page loads are redirected by DNR
//                                         (src/background/rules.js ← AP.yt.redirects.dnrRules); this file
//                                         does the in-app (SPA) side with the same decisions
//                                         (AP.yt.redirects.rewrite): a click on any link to the home page,
//                                         the Navigation API, and a check after each navigation.
//                                         A `custom` address that is empty or invalid does not redirect:
//                                         the placeholder is shown instead (CSS already hides the feed).
//
// CSS (schema/home.js) hides `ytd-browse[page-subtype="home"] #primary` for every mode but `show`;
// the placeholder is its sibling, so it stays visible. No placeholder is drawn while a redirect is
// on its way, only when there is nowhere to go (invalid address, or the loop guard stopped it).
(() => {
  'use strict';
  const AP = globalThis.AtPeace;
  const { redirects, shared } = AP.yt;

  const MODE = 'yt.home.feedMode';
  const URL_ID = 'yt.home.redirectUrl';
  const HOST_ATTR = 'data-at-peace-placeholder';

  /** Only the home settings: this feature redirects the home page and nothing else. */
  const slice = (settings) => ({ [MODE]: settings?.[MODE], [URL_ID]: settings?.[URL_ID] });

  let current = null; // ctx
  const redirector = shared.createRedirector({
    target: (url) => (current?.settings ? redirects.rewrite(url, slice(current.settings)) : null),
  });

  // ---- the placeholder -----------------------------------------------------------------------------------

  const PALETTE_LIGHT = '--ink:#1B2050;--ink-2:#5E5A55;--rule:#B9C4D3;--edge:#757A8A;--clay:#8E7266;--seal:#E5600F;--hover:#EAE2D1;';
  const PALETTE_DARK = '--ink:#E9E3D6;--ink-2:#A8A3B8;--rule:#33385C;--edge:#6F74A0;--clay:#B79E91;--seal:#F47A2E;--hover:#1C1F3A;';
  const CSS = `
:host { all: initial; display: block; }
.page {
  ${PALETTE_LIGHT}
  box-sizing: border-box; min-height: calc(100vh - 56px - 96px); padding: 12vh 7vw 56px clamp(24px, 12vw, 200px);
  color: var(--yt-spec-text-primary, var(--ink)); cursor: text;
  font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, "Noto Sans", sans-serif; -webkit-font-smoothing: antialiased;
}
.page[data-theme="dark"] { ${PALETTE_DARK} }
@media (prefers-color-scheme: dark) { .page[data-theme="system"] { ${PALETTE_DARK} } }
.sheet { width: min(460px, 100%); }
.horizon { position: relative; box-sizing: border-box; height: 61px; margin: 0 0 28px; border-bottom: 1px solid var(--yt-spec-10-percent-layer, var(--rule)); }
.sun { position: absolute; left: 0; bottom: -1px; width: 60px; height: 60px; border-radius: 50%; background: var(--seal); }
h2 { margin: 0 0 8px; font: 400 clamp(26px, 3.3vw, 32px)/1.25 "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Charter, Georgia, serif; }
p { margin: 0; color: var(--yt-spec-text-secondary, var(--ink-2)); max-width: 36ch; }
button {
  margin-top: 28px; font: inherit; font-size: 15px; min-height: 40px; padding: 6px 20px; border-radius: 3px; cursor: pointer;
  border: 1px solid var(--yt-spec-text-secondary, var(--edge)); background: transparent; color: inherit;
  transition: background-color 200ms cubic-bezier(0.2, 0.7, 0.2, 1), border-color 200ms cubic-bezier(0.2, 0.7, 0.2, 1);
}
button:hover { background: var(--yt-spec-badge-chip-background, var(--hover)); border-color: currentColor; }
button:focus-visible { outline: 2px solid var(--clay); outline-offset: 2px; }
@media (max-width: 720px) { .page { padding-left: 7vw; } }
@media (prefers-reduced-motion: reduce) { button { transition: none; } }
`;

  const TITLE = 'Your home feed is hidden.';
  const BODY = 'Nothing here is asking for your attention. Search for what you came to find.';

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  /** Puts the cursor in YouTube's search box (the one a user would use), if there is one. */
  function focusSearch() {
    const box = document.querySelector('ytd-masthead input[name="search_query"], yt-searchbox input[name="search_query"], input[name="search_query"]');
    box?.focus();
  }

  function buildPlaceholder(theme) {
    const host = document.createElement('div');
    host.setAttribute(HOST_ATTR, 'home');
    host.setAttribute('data-at-peace-text', TITLE); // the closed shadow root hides the text; this is a handle for tests
    const root = host.attachShadow({ mode: 'closed' });
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(CSS);
      root.adoptedStyleSheets = [sheet]; // constructed sheets cannot be blocked by a page CSP
    } catch {
      const style = document.createElement('style');
      style.textContent = CSS;
      root.append(style);
    }
    const page = el('div', 'page');
    page.dataset.theme = theme === 'dark' || theme === 'system' ? theme : 'light';
    const horizon = el('div', 'horizon');
    horizon.setAttribute('aria-hidden', 'true');
    horizon.append(el('span', 'sun'));
    const button = el('button', '', 'Search');
    button.type = 'button';
    const sheet = el('div', 'sheet');
    sheet.append(horizon, el('h2', '', TITLE), el('p', '', BODY), button);
    page.append(sheet);
    page.addEventListener('click', focusSearch);
    root.append(page);
    return host;
  }

  let host = null;

  /** Where the placeholder belongs: right before the feed's column, inside the home page element. */
  function homeAnchor() {
    const browse = document.querySelector('ytd-browse[page-subtype="home"]');
    const feed = browse?.querySelector(':scope > ytd-two-column-browse-results-renderer');
    return browse && feed ? { browse, feed } : null;
  }

  /** Is a placeholder what the home page should show right now? */
  function wantsPlaceholder(ctx) {
    const mode = ctx.settings?.[MODE];
    if (mode === 'hide') return true;
    if (mode === undefined || mode === 'show') return false;
    // A redirecting mode: placeholder only when there is nowhere to go, or the loop guard stopped the redirect.
    const to = redirects.homeTarget(slice(ctx.settings));
    return to === null || shared.isLooping(to);
  }

  function removePlaceholder() {
    host?.remove();
    host = null;
  }

  function syncPlaceholder(ctx) {
    if (ctx.page !== 'home' || !wantsPlaceholder(ctx)) {
      removePlaceholder(); // off the home page it would sit in a hidden page: harmless, but never leave a stale one behind
      return;
    }
    const anchor = homeAnchor();
    if (!anchor) return; // the page is still being built: the next mutation batch tries again
    if (host?.isConnected && host.parentNode === anchor.browse) return;
    removePlaceholder();
    host = buildPlaceholder(ctx.settings?.['general.theme']);
    anchor.browse.insertBefore(host, anchor.feed);
  }

  // ---- the feature -----------------------------------------------------------------------------------------

  AP.yt.features.push({
    id: 'home-feed',
    settings: [MODE, URL_ID],
    observes: true,
    isActive: (ctx) => {
      const mode = ctx.settings?.[MODE];
      return typeof mode === 'string' && mode !== 'show';
    },
    init(ctx) {
      current = ctx;
      redirector.start();
    },
    onNavigate(ctx) {
      current = ctx;
      redirector.check();
      syncPlaceholder(ctx);
    },
    onSettings(ctx) {
      removePlaceholder(); // a theme or mode change: build it again from scratch
      syncPlaceholder(ctx);
    },
    onMutations(ctx) {
      if (ctx.page === 'home' && (!host || !host.isConnected)) syncPlaceholder(ctx);
    },
    destroy() {
      redirector.stop();
      removePlaceholder();
      current = null;
    },
  });
})();
