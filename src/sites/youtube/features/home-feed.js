// Home feed (yt.home.feedMode, yt.home.redirectUrl): what the home page does instead of showing the feed.
//
//   hide                                  a placeholder takes the feed's place: a glyph and "Your home is hidden." (this file)
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

  // The tools' Dial tokens, light and dark. Which one is used follows YouTube's own theme (<html dark>),
  // not the extension's setting: the card sits on YouTube's page, so it has to look right there.
  const PALETTE_LIGHT = '--panel:#FFFFFF;--line:#DCE1EA;--text:#10123F;--mint:#0CE3A1;';
  const PALETTE_DARK = '--panel:#171A45;--line:#262A5C;--text:#E8EAF6;--mint:#3FF1C0;';
  const CSS = `
:host { all: initial; display: block; }
.page {
  ${PALETTE_LIGHT}
  box-sizing: border-box; display: flex; align-items: center; justify-content: center;
  min-height: calc(100vh - 56px - 96px); padding: 24px;
  font: 14px/1.5 system-ui, -apple-system, "Segoe UI", "Noto Sans", sans-serif; -webkit-font-smoothing: antialiased;
}
.page[data-theme="dark"] { ${PALETTE_DARK} }
.card { box-sizing: border-box; width: min(400px, 100%); padding: 28px; border: 1px solid var(--line); border-radius: 12px; background: var(--panel); color: var(--text); }
.glyph { position: relative; display: block; box-sizing: border-box; width: 28px; height: 28px; margin: 0 0 16px; border: 2px solid var(--text); border-radius: 50%; }
.glyph::after { content: ""; position: absolute; left: 50%; top: 50%; width: 10px; height: 10px; margin: -5px 0 0 -5px; border-radius: 50%; background: var(--mint); }
h2 { margin: 0; font-size: 20px; font-weight: 700; line-height: 1.25; letter-spacing: -0.015em; }
`;

  const TITLE = 'Your home is hidden.';

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  const isYouTubeDark = () => document.documentElement.hasAttribute('dark');

  let themeWatch = null;

  function buildPlaceholder() {
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
    const paint = () => {
      page.dataset.theme = isYouTubeDark() ? 'dark' : 'light';
    };
    paint();
    // YouTube flips <html dark> when its theme changes; follow it without rebuilding.
    themeWatch?.disconnect();
    themeWatch = typeof MutationObserver === 'function' ? new MutationObserver(paint) : null;
    themeWatch?.observe(document.documentElement, { attributes: true, attributeFilter: ['dark'] });
    const glyph = el('span', 'glyph');
    glyph.setAttribute('aria-hidden', 'true');
    const card = el('div', 'card');
    card.append(glyph, el('h2', '', TITLE));
    page.append(card);
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
    themeWatch?.disconnect();
    themeWatch = null;
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
    host = buildPlaceholder();
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
