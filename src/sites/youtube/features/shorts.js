// Shorts (yt.shorts.mode): what happens when the user goes to a Short.
//
//   watch   /shorts/<id> opens as /watch?v=<id> in the normal player. Full page loads are redirected
//           by DNR (AP.yt.redirects.dnrRules); this file does the in-app side: every link to a Short
//           gets its href rewritten (so middle-click, "open in new tab" and the status bar show the
//           watch URL), a click on one is intercepted (YouTube's own handler navigates by the link's
//           data, not its href, so rewriting alone is not enough), and any other way into the Shorts
//           player is caught by the Navigation API / after the navigation.
//   block   in-app navigation to Shorts goes to the blocked page: blocked.html?reason=shorts#<url>.
//
// The decisions come from AP.yt.redirects.rewrite, the same function DNR's rules mirror.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;
  const { redirects, shared } = AP.yt;

  const MODE = 'yt.shorts.mode';
  const ORIG = 'data-at-peace-href'; // the href YouTube set
  const SET = 'data-at-peace-href-set'; // the href we put in its place (to notice when YouTube changes it again)
  const LINKS = 'a[href*="/shorts/"]';

  let current = null; // ctx
  const blockedPageUrl = () => AP.api?.runtime?.getURL?.('src/pages/blocked/blocked.html');
  const slice = (settings) => ({ [MODE]: settings?.[MODE] });

  /** The link's original target: what YouTube set, even after we rewrote the attribute. */
  const originalHref = (a) => (a.getAttribute(SET) === a.getAttribute('href') && a.hasAttribute(ORIG) ? a.getAttribute(ORIG) : a.href);

  const redirector = shared.createRedirector({
    target: (url, anchor) => {
      if (!current?.settings) return null;
      return redirects.rewrite(anchor ? originalHref(anchor) : url, slice(current.settings), { blockedPageUrl: blockedPageUrl() });
    },
  });

  /** watch mode: point each Short link at the normal player. */
  function rewriteLinks(root) {
    if (current?.settings?.[MODE] !== 'watch') return;
    const links = [];
    if (root.matches?.(LINKS)) links.push(root);
    if (root.querySelectorAll) links.push(...root.querySelectorAll(LINKS));
    for (const a of links) {
      const href = a.getAttribute('href');
      if (href === a.getAttribute(SET)) continue; // already ours
      const to = redirects.rewrite(href, slice(current.settings));
      if (!to || !to.startsWith('https://www.youtube.com/watch?v=')) continue; // not a Short with an id
      a.setAttribute(ORIG, href);
      const relative = to.slice('https://www.youtube.com'.length);
      a.setAttribute('href', relative);
      a.setAttribute(SET, relative);
    }
  }

  /** Puts every rewritten link back (mode changed, or the feature was switched off). */
  function restoreLinks() {
    for (const a of document.querySelectorAll(`a[${SET}]`)) {
      if (a.getAttribute('href') === a.getAttribute(SET) && a.hasAttribute(ORIG)) a.setAttribute('href', a.getAttribute(ORIG));
      a.removeAttribute(ORIG);
      a.removeAttribute(SET);
    }
  }

  AP.yt.features.push({
    id: 'shorts',
    settings: [MODE],
    observes: true,
    init(ctx) {
      current = ctx;
      redirector.start();
    },
    onNavigate(ctx) {
      current = ctx;
      redirector.check();
      rewriteLinks(document.documentElement);
    },
    onSettings(ctx) {
      current = ctx;
      restoreLinks();
      rewriteLinks(document.documentElement);
      redirector.check();
    },
    onMutations(ctx, roots) {
      current = ctx;
      for (const root of roots) rewriteLinks(root);
    },
    destroy() {
      redirector.stop();
      restoreLinks();
      current = null;
    },
  });
})();
