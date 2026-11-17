// atpeace.cristianbagrin.com: static pages from ./public, plus two store links and the security headers.
//
//   /firefox   → the addons.mozilla.org listing
//   /chrome    → the Chrome Web Store listing (or home, while CHROME is false)
//
// The Chrome listing lives only here. Set CHROME to false and every page drops its Chrome button
// (the HTML is rewritten on the way out), and /chrome sends people home.
const CHROME = true;
const CHROME_STORE = 'https://chromewebstore.google.com/detail/at-peace/ejplinicdjdifcdagflblibbeldpfoig';
const FIREFOX_STORE = 'https://addons.mozilla.org/firefox/addon/atpeace/';

const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' https://i.ytimg.com",
  "font-src 'self'",
  'frame-src https://www.youtube-nocookie.com',
  "manifest-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const SECURITY = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  // YouTube's player refuses to play without the page's origin in the Referer.
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

function cacheFor(path, type) {
  if (type.includes('text/html')) return 'public, max-age=0, must-revalidate';
  if (/\.(webp|png|svg|woff2|ico)$/.test(path)) return 'public, max-age=604800';
  return 'public, max-age=3600';
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === '/firefox') return Response.redirect(FIREFOX_STORE, 302);
    if (path === '/chrome') return Response.redirect(CHROME ? CHROME_STORE : new URL('/', url).href, 302);

    let response = await env.ASSETS.fetch(request);
    const type = response.headers.get('content-type') || '';

    if (type.includes('text/html')) {
      const rewriter = new HTMLRewriter().on('html', {
        element(el) { el.setAttribute('data-chrome', CHROME ? 'on' : 'off'); },
      });
      if (!CHROME) rewriter.on('[data-store="chrome"]', { element(el) { el.remove(); } });
      response = rewriter.transform(response);
    }

    response = new Response(response.body, response);
    for (const [name, value] of Object.entries(SECURITY)) response.headers.set(name, value);
    if (response.status === 200) response.headers.set('Cache-Control', cacheFor(url.pathname, type));
    return response;
  },
};
