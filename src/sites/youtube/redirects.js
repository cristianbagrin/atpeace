// YouTube redirect rules (Contract C2, PLAN §8.2). One catalogue of "this URL should go there
// instead" decisions, used twice:
//
//   AP.yt.redirects.dnrRules(settings, { blockedPageUrl })   the background compiles them into
//        declarativeNetRequest rules (ids 300–399) for FULL page loads;
//   AP.yt.redirects.rewrite(url, settings, { blockedPageUrl }) the YouTube content features use
//        the very same decisions for in-app (SPA) navigation, where DNR never sees the request.
//
// Both are pure: settings in, answer out. Loaded in the YouTube content script AND in the
// background, so nothing here may touch the DOM, `window` or an extension API.
//
//   setting                  URL                                    goes to
//   yt.home.feedMode         /                                      /feed/subscriptions | /playlist?list=WL
//     (subscriptions,                                               | /feed/playlists | the custom page
//      watchLater, playlists, custom; `hide` and `show` do not redirect)
//   yt.shorts.mode = watch   /shorts/<id>                           /watch?v=<id>
//   yt.shorts.mode = block   /shorts and /shorts/<id>               blocked.html?reason=shorts#<original url>
//   yt.shorts.mode = watch   /shorts (the feed, no id to open)      blocked.html?reason=shorts#<original url>
//   yt.channel.openVideosTab /@handle, /channel/UC…, /c/x, /user/x  the same + /videos (never a sub-tab)
//
// DNR regexes are RE2: no lookaround, no backreferences. Capture groups (`\1`) in the substitution
// are fine; so are no counted repetitions (`{6,20}` busts Chrome's regex memory limit). They match only main_frame loads of youtube.com, www.youtube.com and m.youtube.com;
// music./studio./tv. are different sites. Redirect targets always point at www.youtube.com.
(() => {
  'use strict';
  const AP = globalThis.AtPeace;
  AP.yt ??= {};

  const ORIGIN = 'https://www.youtube.com';
  const HOSTS = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com']);
  /** Where each redirecting feed mode goes. `custom` comes from `yt.home.redirectUrl`. */
  const FEED_TARGETS = Object.freeze({
    subscriptions: '/feed/subscriptions',
    watchLater: '/playlist?list=WL',
    playlists: '/feed/playlists',
  });
  /**
   * A Short's id: strict about the alphabet, silent about the length (real ids are 11 characters).
   * No length bound because the DNR regex cannot have one: Chrome rejects counted repetitions such as
   * `{11}` there (isRegexSupported → memoryLimitExceeded, measured), and both must agree.
   */
  const VIDEO_ID = /^[A-Za-z0-9_-]+$/;
  const CHANNEL_PREFIXES = new Set(['channel', 'c', 'user']);
  /** The background gives redirects priority 100 unless a rule says otherwise; 101 still sits far below pause (200) and blocks (300). */
  const PRIORITY_ABOVE = 101;

  // ---- DNR regexes (RE2) --------------------------------------------------------------------------
  const HOST = '(?:www\\.|m\\.)?youtube\\.com';
  const REGEX = Object.freeze({
    /** "/" with an optional query and fragment. */
    home: `^https?://${HOST}/?(?:\\?[^#]*)?(?:#.*)?$`,
    /** "/shorts/<id>" followed by nothing, a path, a query or a fragment. */
    shorts: `^https?://${HOST}/shorts/([A-Za-z0-9_-]+)(?:[/?#].*)?$`,
    /** Every Shorts URL, for the "block" page (`\0` = the original URL, hence the trailing `.*`). */
    shortsAny: `^https?://${HOST}/shorts(?:[/?#].*)?$`,
    /** The bare channel root: /@handle, /channel/UC…, /c/name, /user/name (+ optional "/", query, fragment). */
    channelRoot: `^https?://${HOST}/(@[^/?#]+|channel/[^/?#]+|c/[^/?#]+|user/[^/?#]+)/?(?:\\?[^#]*)?(?:#.*)?$`,
  });

  // ---- URL helpers -----------------------------------------------------------------------------------

  /** @returns {URL|null} the parsed URL when it is a youtube.com / www / m page, else null */
  function parse(url) {
    if (typeof url !== 'string' && !(url && typeof url.href === 'string')) return null;
    let parsed;
    try {
      parsed = new URL(typeof url === 'string' ? url : url.href, ORIGIN);
    } catch {
      return null;
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    return HOSTS.has(parsed.hostname) ? parsed : null;
  }

  /**
   * Validates the user's own home page: a path on youtube.com, or a full https://(www.)youtube.com
   * address. Returns the normalised absolute URL (always www), or null for anything else, including
   * the home page itself (a redirect to where you already are would loop).
   * @param {unknown} text
   * @returns {string|null}
   */
  function customTarget(text) {
    if (typeof text !== 'string') return null;
    const value = text.trim();
    // Backslashes are escapes in a DNR substitution, and browsers read "\" as "/" in a URL.
    if (value === '' || value.length > 500 || value.startsWith('//') || value.includes('\\') || [...value].some((c) => c <= ' ' || c === '\u007f')) return null;
    let url;
    try {
      url = value.startsWith('/') ? new URL(value, ORIGIN) : new URL(value);
    } catch {
      return null;
    }
    if (url.protocol !== 'https:' || !HOSTS.has(url.hostname) || url.hostname === 'm.youtube.com') return null;
    if (url.username || url.password || url.port) return null;
    if (url.pathname === '/') return null;
    return `${ORIGIN}${url.pathname}${url.search}${url.hash}`;
  }

  /**
   * Where the home page should go for these settings, or null (feed shown or hidden in place, or a
   * custom address that is not usable: the home placeholder takes over then).
   * @param {Record<string, any>} settings
   * @returns {string|null}
   */
  function homeTarget(settings) {
    const mode = settings?.['yt.home.feedMode'];
    if (typeof mode !== 'string') return null;
    if (mode === 'custom') return customTarget(settings['yt.home.redirectUrl']);
    return Object.hasOwn(FEED_TARGETS, mode) ? `${ORIGIN}${FEED_TARGETS[mode]}` : null;
  }

  /** Is this any /shorts… URL (the feed, a Short, something odd)? */
  const isShortsPath = (parsed) => parsed.pathname.split('/').filter(Boolean)[0]?.toLowerCase() === 'shorts';

  /** The video id of a /shorts/<id> URL; null for the bare /shorts feed and anything malformed. */
  function shortsVideoId(parsed) {
    const segments = parsed.pathname.split('/').filter(Boolean);
    return segments.length >= 2 && VIDEO_ID.test(segments[1]) ? segments[1] : null;
  }

  /** `/@handle`, `/channel/UC…` … when the URL is exactly a channel root (no tab); else null. */
  function channelRootPath(parsed) {
    const segments = parsed.pathname.split('/').filter(Boolean);
    const first = segments[0];
    if (first === undefined) return null;
    if (first.startsWith('@') && first.length > 1 && segments.length === 1) return `/${first}`;
    if (CHANNEL_PREFIXES.has(first.toLowerCase()) && segments.length === 2) return `/${first}/${segments[1]}`;
    return null;
  }

  const isHome = (parsed) => parsed.pathname === '/';

  // ---- rewrite (in-app navigation) ---------------------------------------------------------------------

  const blockedFor = (blockedPageUrl, original) =>
    typeof blockedPageUrl === 'string' && blockedPageUrl !== '' ? `${blockedPageUrl}?reason=shorts#${original}` : null;

  /**
   * Where `url` should go instead, for these settings; null when nothing applies. Idempotent in the
   * sense that matters: following the answer never leads back to the question (no redirect loops).
   * @param {string|URL} url        absolute, or a path such as "/shorts/abc" (resolved against www.youtube.com)
   * @param {Record<string, any>} settings effective settings
   * @param {{ blockedPageUrl?: string }} [options] needed only for Shorts "block" (else that case answers null)
   * @returns {string|null}
   */
  function rewrite(url, settings, { blockedPageUrl } = {}) {
    const parsed = parse(url);
    if (!parsed || !settings) return null;

    if (isHome(parsed)) return homeTarget(settings);

    if (isShortsPath(parsed)) {
      const mode = settings['yt.shorts.mode'];
      if (mode === 'block') return blockedFor(blockedPageUrl, parsed.href);
      if (mode === 'watch') {
        // The feed (and a malformed id) has no video to open: the nearest honest answer is the "Shorts are off" page.
        const id = shortsVideoId(parsed);
        return id ? `${ORIGIN}/watch?v=${id}` : blockedFor(blockedPageUrl, parsed.href);
      }
      return null;
    }

    if (settings['yt.channel.openVideosTab'] === true) {
      const root = channelRootPath(parsed);
      if (root) return `${ORIGIN}${root}/videos`;
    }
    return null;
  }

  // ---- DNR (full page loads) ---------------------------------------------------------------------------

  const condition = (regexFilter) => ({ regexFilter, isUrlFilterCaseSensitive: false, resourceTypes: ['main_frame'] });
  const redirect = (key, regexFilter, substitution) => ({
    key,
    action: { type: 'redirect', redirect: { regexSubstitution: substitution } },
    condition: condition(regexFilter),
  });

  /**
   * DNR rules (no ids; the background assigns 300–399 by sorted `key`) for the settings.
   * @param {Record<string, any>} settings effective settings
   * @param {{ blockedPageUrl?: string }} [options] the blocked page's URL, for Shorts "block"
   * @returns {{ key: string, action: object, condition: object }[]}
   */
  function dnrRules(settings, { blockedPageUrl } = {}) {
    const rules = [];
    if (!settings) return rules;

    const home = homeTarget(settings);
    if (home) rules.push(redirect('home', REGEX.home, home));

    const shorts = settings['yt.shorts.mode'];
    const blocked = typeof blockedPageUrl === 'string' && blockedPageUrl !== '' ? `${blockedPageUrl}?reason=shorts#\\0` : null;
    if (shorts === 'block' && blocked) {
      rules.push(redirect('shorts', REGEX.shortsAny, blocked));
    } else if (shorts === 'watch') {
      // A Short with a valid id opens in the normal player (priority 101); every other /shorts… URL,
      // the feed included, gets the "Shorts are off" page (priority 100): RE2 has no negative lookahead,
      // so "everything except ids" is expressed as two rules of different priority.
      rules.push({ ...redirect('shorts', REGEX.shorts, `${ORIGIN}/watch?v=\\1`), priority: PRIORITY_ABOVE });
      if (blocked) rules.push(redirect('shorts-feed', REGEX.shortsAny, blocked));
    }

    if (settings['yt.channel.openVideosTab'] === true) rules.push(redirect('channel-videos', REGEX.channelRoot, `${ORIGIN}/\\1/videos`));
    return rules;
  }

  AP.yt.redirects = { dnrRules, rewrite, homeTarget, customTarget, REGEX, FEED_TARGETS };
})();
